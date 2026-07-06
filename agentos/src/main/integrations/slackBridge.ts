import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { open } from 'fs/promises';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type {
  AppSettings,
  Message,
  SlackChannelOption,
  ThreadStatusEvent,
  ThreadPostUpdatedEvent,
} from '../../shared/types';
import { DEFAULT_SLACK_SETTINGS, parseAutopilotDecision } from '../../shared/types';
import { getStore, setSettings } from '../store/index';
import { BaseBridge } from './BaseBridge';
import { eventLogger } from '../utils/eventLog';
import { SlackWorkspaceManager } from './slackWorkspaces';
import { registerMediumPoster, getMediumPoster, type EchoTarget } from './mediumPosters';
import {
  reconcileReaction,
  TERMINAL_THREAD_REACTION_EMOJI,
  THREAD_STATUS_SLACK_EMOJI,
} from '../../shared/threadStatusLifecycle';
import { clampSlackText, convertMarkdownToMrkdwn } from './slackFormatting';
import { DedupCache } from './DedupCache';
import { SlackFileService } from './slackFileService';
import { SlackCatchupService, type SlackInboundEvent } from './slackCatchupService';
import { SlackRoutingService } from './slackRoutingService';
import { SlackThreadResolver } from './slackThreadResolver';
import { getProject } from '../threads/db';
import { getThread } from '../threads/threadStore';

/** Sanitizes user-provided strings for safe inclusion in Slack mrkdwn. */
function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[*_`~]/g, '');
}

export function resolveSlackChannelForProject(projectId: string): string | null {
  const slack = getStore().get('settings').slack;
  if (!slack?.enabled) return null;
  const map = slack.channelWorkspaceMap ?? {};
  const project = getProject(projectId);
  for (const [channelId, mapping] of Object.entries(map)) {
    if (mapping === `project:${projectId}`) return channelId;
    if (project && mapping === project.path) return channelId;
  }
  return null;
}
type SlackBridgeDeps = {
  createThread: (req: { name: string; workingDirectory: string }) => Promise<{ id: string; workingDirectory: string }>;
  sendInput: (
    threadId: string,
    input: string,
    source: 'user',
    options?: { systemPromptSuffix?: string }
  ) => Promise<void>;
  getThreadName: (threadId: string) => string | null;
  getThreadWorkingDirectory: (threadId: string) => string | null;
  setSlackContext: (threadId: string, ctx: { channelId: string; threadTs: string | null }) => void;
  /** Optional: enable autopilot on newly created threads. */
  setAutopilot?: (threadId: string, enabled: boolean, options?: { triggerAfterTurn?: boolean }) => void;
};

type SlackSocketEnvelope = {
  type?: string;
  body?: { event?: SlackInboundEvent };
  ack?: () => Promise<unknown>;
};

const AUTOPILOT_STATUS_PREFIX = '🤖';

const MAX_ECHO_UPLOAD_BYTES = 100 * 1024 * 1024;

const PERIODIC_CATCHUP_MS = 10 * 60 * 1000;

const TRANSIENT_THREAD_REACTION_EMOJI = new Set([
  THREAD_STATUS_SLACK_EMOJI.working,
  THREAD_STATUS_SLACK_EMOJI.autopilot,
  THREAD_STATUS_SLACK_EMOJI.council,
]);

class SlackBridge extends BaseBridge<SlackBridgeDeps> {
  private socketClient: SocketModeClient | null = null;
  private socketEventHandler: ((envelope: unknown) => void) | null = null;
  private webClient: WebClient | null = null;
  private startedBotToken: string | null = null;
  private startedSocketConfigKey: string | null = null;
  private processedMessageKeys = new DedupCache();
  private catchingUp = false;
  private periodicCatchupTimer: NodeJS.Timeout | null = null;
  private workspaceManager = new SlackWorkspaceManager();
  private fileService = new SlackFileService(() => this.webClient);
  private threadResolver = new SlackThreadResolver(() => this.webClient);
  private catchupService = new SlackCatchupService(
    () => this.webClient,
    async (event) => this.dispatchInboundSlackEvent(event)
  );
  /** The reaction currently shown for each binding (bindingKey → {messageTs, emoji}). Lets a status
   * change remove the prior reaction before adding the new one, and clear a superseded message's
   * stale transient. Slack is a pure echo of the thread status; this is just the applied-state cache. */
  private currentReactions = new Map<string, { messageTs: string; emoji: string }>();
  /** Deduplicates concurrent createThread calls for the same Slack thread binding. */
  private pendingThreadCreations = new Map<string, Promise<{ id: string; workingDirectory: string }>>();
  /** Channels whose auto-mapping has already been persisted this process — guards the
   * read-modify-write in persistChannelMapping against concurrent first inbound events. */
  private persistedChannelMappings = new Set<string>();
  private routingService = new SlackRoutingService({
    workspaceManager: this.workspaceManager,
    fileService: this.fileService,
    catchupService: this.catchupService,
    processedMessageKeys: this.processedMessageKeys,
    pendingThreadCreations: this.pendingThreadCreations,
    getDeps: () => this.deps,
    getBotToken: () => this.readSlackSettings().botToken?.trim(),
    postMessage: async (channelId, text, threadTs) => this.postMessage(channelId, text, threadTs),
    // A hard delivery failure (e.g. the thread vanished before its turn ran) never produces a thread
    // status event, so the status echo can't mark it. Surface ❌ directly — best-effort, terminal.
    reportDeliveryFailure: (channelId, messageTs) =>
      void this.addReaction(channelId, messageTs, THREAD_STATUS_SLACK_EMOJI.error),
  });

  applySettings(settings: AppSettings): void {
    const slack = { ...DEFAULT_SLACK_SETTINGS, ...(settings.slack ?? {}) };
    const botToken = slack.botToken?.trim() ?? '';
    const hasBotAccess = slack.enabled && Boolean(botToken);
    const hasSocketMode = hasBotAccess && Boolean(slack.appToken?.trim()) && slack.watchedChannelIds.length > 0;

    if (!hasBotAccess) {
      this.stop();
      return;
    }

    // Initialize webClient and MCP server whenever we have a bot token.
    if (this.startedBotToken !== botToken) {
      this.stopSocketMode();
      this.webClient = new WebClient(botToken);
      this.workspaceManager.setWebClient(this.webClient);
      this.registerSlackPoster();
      this.startedBotToken = botToken;
    }

    if (!hasSocketMode) {
      this.stopSocketMode();
      return;
    }

    const sortedWatchedIds = [...slack.watchedChannelIds].map((id) => id.trim().toUpperCase()).sort();
    // channelWorkspaceMap is intentionally excluded: it only affects per-event routing
    // (read fresh on each inbound message), not the socket connection or catch-up. Including
    // it would restart the socket every time we auto-persist a new channel→workspace mapping.
    const socketConfigKey = JSON.stringify({
      botToken,
      appToken: slack.appToken,
      watchedChannelIds: sortedWatchedIds,
      defaultWorkingDirectory: slack.defaultWorkingDirectory,
    });

    if (this.startedSocketConfigKey === socketConfigKey && this.socketClient) return;

    this.stopSocketMode();
    this.startedSocketConfigKey = socketConfigKey;
    this.socketClient = new SocketModeClient({
      appToken: slack.appToken!,
      autoReconnectEnabled: true,
    });

    this.socketEventHandler = (envelopeUnknown: unknown) => {
      void this.handleSocketEnvelope(envelopeUnknown);
    };
    this.socketClient.on('slack_event', this.socketEventHandler);
    // Silent SDK reconnects (network blip, OS sleep, etc.) re-emit 'connected'
    // without a fresh start().then(...). Trigger catchUp on every connect so a
    // transient failure during the disconnect window is retried immediately
    // instead of waiting up to PERIODIC_CATCHUP_MS. catchUp() guards reentrancy.
    this.socketClient.on('connected', () => this.catchUp());

    this.socketClient
      .start()
      .then(() => {
        void this.logSlackAuthDiagnostics(slack.watchedChannelIds.length, slack.watchedChannelIds);
        this.catchUp();
        this.startPeriodicCatchup();
      })
      .catch((error: unknown) => {
        eventLogger.error('slack', 'Slack socket mode start failed', { error: getErrorMessage(error) });
      });
  }

  private startPeriodicCatchup(): void {
    if (this.periodicCatchupTimer) return;
    // Backstop for the gap between socket reconnects. Catches messages whose original
    // processing failed (their channel cursor is held by the pending set) without
    // waiting for a socket drop + reconnect to trigger catchUp().
    this.periodicCatchupTimer = setInterval(() => this.catchUp(), PERIODIC_CATCHUP_MS);
  }

  private stopPeriodicCatchup(): void {
    if (!this.periodicCatchupTimer) return;
    clearInterval(this.periodicCatchupTimer);
    this.periodicCatchupTimer = null;
  }

  /**
   * Pure echo of the thread-view status lifecycle: every status event re-projects the canonical
   * status (👀 / 🤖 / 🏛️ / ✅ / ❌, or none) onto the bound inbound message's reaction. The decision
   * of what icon to show is made once in broadcastStatus (payload.reaction) — Slack just mirrors it.
   */
  onThreadStatus(payload: ThreadStatusEvent): void {
    if (!this.readSlackSettings().enabled) return;
    // Terminal reactions (✅/❌) are driven by onThreadPostUpdated from the post's persisted status — the
    // same source of truth the thread view renders — so here we only project the transient indicator
    // (👀/🤖/🏛️) or clear it. Skipping terminal events keeps Slack from independently re-deriving the
    // settled icon; the in-flight transient stays until the post resolves and onThreadPostUpdated lands ✅.
    const emoji = payload.reaction ? THREAD_STATUS_SLACK_EMOJI[payload.reaction] : null;
    if (emoji && TERMINAL_THREAD_REACTION_EMOJI.has(emoji)) return;
    for (const binding of this.workspaceManager.bindingsForThread(payload.threadId)) {
      if (!binding.lastInboundTs) continue;
      this.projectReaction(binding.key, binding.channelId, binding.lastInboundTs, emoji);
    }
  }

  /**
   * Terminal reactions (✅ done / ❌ error) mirror the thread-view prompt post's persisted status — the
   * single source of truth — rather than being re-derived from status events. Fired whenever a prompt
   * post resolves (threadPostsStore.setStatus → broadcastThreadPostUpdated).
   */
  onThreadPostUpdated(payload: ThreadPostUpdatedEvent): void {
    if (!this.readSlackSettings().enabled) return;
    const { threadId, post } = payload;
    if (post.kind !== 'prompt' || !post.status) return;
    const emoji = THREAD_STATUS_SLACK_EMOJI[post.status];
    for (const binding of this.workspaceManager.bindingsForThread(threadId)) {
      if (!binding.lastInboundTs) continue;
      this.projectReaction(binding.key, binding.channelId, binding.lastInboundTs, emoji);
    }
  }

  /** Projects the desired lifecycle reaction onto a binding's current inbound message, diffing against
   *  what's already shown so only the delta hits Slack. */
  private projectReaction(bindingKey: string, channelId: string, messageTs: string, emoji: string | null): void {
    const current = this.currentReactions.get(bindingKey);

    // A newer inbound message superseded the one we last reacted on: clear its stale transient mark
    // (a settled ✅/❌ stays — that turn really finished), then drop it as the tracked message.
    if (current && current.messageTs !== messageTs) {
      if (!TERMINAL_THREAD_REACTION_EMOJI.has(current.emoji)) {
        void this.removeReaction(channelId, current.messageTs, current.emoji);
      }
      this.currentReactions.delete(bindingKey);
    }

    const prev = this.currentReactions.get(bindingKey)?.emoji;
    const { remove, add } = reconcileReaction(prev, emoji);
    if (remove) void this.removeReaction(channelId, messageTs, remove);
    if (add) {
      if (TERMINAL_THREAD_REACTION_EMOJI.has(add)) {
        for (const stale of TRANSIENT_THREAD_REACTION_EMOJI) {
          if (stale !== remove) void this.removeReactionIfPresent(channelId, messageTs, stale);
        }
      }
      void this.addReaction(channelId, messageTs, add);
      this.currentReactions.set(bindingKey, { messageTs, emoji: add });
      // Evict the oldest binding entry if the cache grows too large (best-effort projection state).
      if (this.currentReactions.size > 500) {
        const firstKey = this.currentReactions.keys().next().value;
        if (firstKey !== undefined && firstKey !== bindingKey) this.currentReactions.delete(firstKey);
      }
    } else if (remove) {
      this.currentReactions.delete(bindingKey);
    }
  }

  onMessageAppended(params: { threadId: string; message: Message }): void {
    // Assistant replies go through MCP post_update. Autopilot user-behalf messages and
    // autopilot decisions (reasoning) are forwarded here since they never go through MCP.
    let text: string | null = null;
    if (params.message.source === 'autopilot-decision') {
      const { action, reason } = parseAutopilotDecision(params.message.content);
      const actionLabel = action === 'send_message' ? 'reasoning' : action;
      text = reason ? `${AUTOPILOT_STATUS_PREFIX} _[${actionLabel}]_ ${reason}` : null;
    } else if (params.message.source === 'autopilot') {
      const raw = params.message.content.trim();
      text = raw ? `${AUTOPILOT_STATUS_PREFIX} ${raw}` : null;
    } else {
      return;
    }
    if (!text) return;
    for (const binding of this.workspaceManager.bindingsForThread(params.threadId)) {
      getMediumPoster(binding.medium)?.post({ channelId: binding.channelId, threadTs: binding.threadTs }, text);
    }
  }

  /**
   * Echo an agent thread post (update / clarification) to Slack as a reply to every channel thread
   * bound to this AgentOS thread. No-op when Slack is disconnected or the thread has no binding —
   * the thread view is the source of truth; Slack is a best-effort mirror.
   */
  echoThreadPost(threadId: string, text: string): void {
    if (!text.trim()) return;
    for (const binding of this.workspaceManager.bindingsForThread(threadId)) {
      getMediumPoster(binding.medium)?.post({ channelId: binding.channelId, threadTs: binding.threadTs }, text);
    }
  }

  /** Echo an uploaded file to every medium bound to this thread. No-op when disconnected/unbound. */
  async echoUploadFile(threadId: string, hostPath: string, filename: string, comment?: string): Promise<void> {
    for (const binding of this.workspaceManager.bindingsForThread(threadId)) {
      await getMediumPoster(binding.medium)?.upload(
        { channelId: binding.channelId, threadTs: binding.threadTs },
        hostPath,
        filename,
        comment
      );
    }
  }

  /**
   * The Slack implementation of the MediumPoster seam, registered once a bot token is present. Posts
   * land top-level when `target.threadTs` is absent (channel-scoped binding). The Thread view is the
   * source of truth, so every call here is best-effort and silently no-ops when disconnected.
   */
  private registerSlackPoster(): void {
    registerMediumPoster({
      medium: 'slack',
      post: (target, text) => {
        void this.postMessage(target.channelId, text, target.threadTs);
      },
      upload: (target, hostPath, filename, comment) => this.slackUpload(target, hostPath, filename, comment),
    });
  }

  private async slackUpload(target: EchoTarget, hostPath: string, filename: string, comment?: string): Promise<void> {
    if (!this.webClient) return;

    const fd = await open(hostPath, 'r');
    let file: Buffer;
    try {
      const stats = await fd.stat();
      if (!stats.isFile()) throw new Error(`Not a regular file: ${hostPath}`);
      if (stats.size > MAX_ECHO_UPLOAD_BYTES) {
        // The thread post is already recorded (source of truth); skip the best-effort Slack echo
        // rather than reading a huge file into the main process.
        eventLogger.warn('slack', 'Skipping Slack echo upload — file exceeds size limit', {
          hostPath,
          size: stats.size,
        });
        return;
      }
      file = await fd.readFile();
    } finally {
      await fd.close();
    }

    const initial = comment ? { initial_comment: clampSlackText(convertMarkdownToMrkdwn(comment)) } : {};
    // The SDK's upload args require thread_ts when present rather than accepting undefined, so branch
    // on it: omit entirely for channel-scoped (top-level) uploads.
    const args =
      target.threadTs === undefined
        ? { channel_id: target.channelId, file, filename, ...initial }
        : { channel_id: target.channelId, thread_ts: target.threadTs, file, filename, ...initial };
    await this.safeSlackCall('Slack uploadFile failed', () => this.webClient!.files.uploadV2(args), {
      channelId: target.channelId,
    });
  }

  async listDiscoverableChannels(): Promise<SlackChannelOption[]> {
    const settings = this.readSlackSettings();
    const token = settings.botToken?.trim();
    if (!token) return [];
    const client = this.webClient ?? new WebClient(token);
    const channels: SlackChannelOption[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      for (const channel of response.channels ?? []) {
        const id = channel.id?.trim();
        if (!id) continue;
        channels.push({
          id,
          name: channel.name ?? id,
          isPrivate: Boolean(channel.is_private),
          isMember: Boolean(channel.is_member),
        });
      }
      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return channels.filter((channel) => channel.isMember).sort((a, b) => a.name.localeCompare(b.name));
  }

  async openTaskThread(projectId: string, taskTitle: string): Promise<{ channelId: string; threadTs: string } | null> {
    const channelId = resolveSlackChannelForProject(projectId);
    if (!channelId || !this.webClient) return null;
    try {
      const result = await this.webClient.chat.postMessage({
        channel: channelId,
        text: `🎯 Task: *${escapeMrkdwn(taskTitle)}*`,
      });
      const ts = result.ts;
      if (!ts) return null;
      return { channelId, threadTs: ts };
    } catch (error) {
      eventLogger.warn('slack', 'Failed to open kanban task Slack thread', {
        error: getErrorMessage(error),
        channelId,
      });
      return null;
    }
  }

  /**
   * Persist a Slack thread binding for a bot-initiated thread (kanban main thread,
   * automation run). `setSlackContext` only records the channel/ts in-memory, but
   * inbound replies are routed solely via SlackBinding rows — so without this the
   * first reply finds no binding and spawns a brand-new thread.
   *
   * Won't steal a binding that already points to a still-running thread (e.g. a
   * user's own Slack-initiated thread). Reconcile is unaffected: the dead main
   * thread's binding is reclaimable because that thread is no longer running.
   *
   * Omit `threadTs` for a channel-scoped binding (automation summaries with no reply anchor) —
   * its echoes post as new top-level channel messages.
   */
  bindThreadToSlackThread(threadId: string, channelId: string, threadTs?: string): void {
    const binding = this.workspaceManager.resolveOrCreateBinding(channelId, threadTs);
    if (binding.threadId && binding.threadId !== threadId && getThread(binding.threadId)?.status === 'running') {
      return;
    }
    this.workspaceManager.updateBinding(binding.key, { threadId });
  }

  isConnected(): boolean {
    return !!(this.socketClient && this.webClient);
  }

  catchUp(): void {
    if (!this.socketClient || !this.webClient || this.catchingUp) return;
    this.catchingUp = true;
    const settings = this.readSlackSettings();
    void this.catchupService.catchUpMissedMessages(settings.watchedChannelIds).finally(() => {
      this.catchingUp = false;
    });
  }

  // Force-restart the socket after a system sleep/resume cycle. The OS tears down the WebSocket
  // on sleep; auto-reconnect only handles transient drops, not clean OS-level closes.
  // applySettings() already triggers a catch-up sweep on socket start, so no separate catchUp needed.
  reconnect(): void {
    if (!this.webClient) return;
    this.startedSocketConfigKey = null;
    this.applySettings(getStore().get('settings'));
  }

  async sendChannelNotification(channelId: string, text: string, threadTs?: string): Promise<string | null> {
    if (!this.webClient) return null;
    try {
      const result = await this.webClient.chat.postMessage({
        channel: channelId,
        text: clampSlackText(text),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return (result.ts as string | undefined) ?? null;
    } catch (err) {
      eventLogger.warn('slack', 'Slack notification failed', { channelId, error: String(err) });
      return null;
    }
  }

  stop(): void {
    // Don't unregister the settings listener — applySettings() must still fire after stop()
    // so Slack can recover when re-enabled without an app restart.
    this.stopPeriodicCatchup();
    this.stopSocketMode();
    this.startedBotToken = null;
    this.processedMessageKeys.clear();
    this.currentReactions.clear();
    // catchupService lives across stop()/applySettings cycles — clear its in-memory
    // pending and notification state so a re-enabled bridge doesn't inherit phantom
    // entries that would pin the cursor or suppress error notices forever.
    this.catchupService.clear();
    this.workspaceManager.setWebClient(null);
    this.webClient = null;
  }

  dispose(): void {
    this.unregisterSettingsListener();
    this.stop();
  }

  private stopSocketMode(): void {
    this.stopPeriodicCatchup();
    this.startedSocketConfigKey = null;
    const socket = this.socketClient;
    const handler = this.socketEventHandler;
    this.socketClient = null;
    this.socketEventHandler = null;
    if (socket) {
      if (handler) socket.off('slack_event', handler);
      socket.disconnect().catch((err) => {
        eventLogger.warn('slack', 'socket disconnect failed', { error: String(err) });
      });
    }
  }

  private async dispatchInboundSlackEvent(event: SlackInboundEvent): Promise<void> {
    if (!event.channel || !event.ts) return;
    const settings = this.readSlackSettings();
    if (!settings.enabled) return;

    const channelId = event.channel;
    const watchedSet = new Set(settings.watchedChannelIds.map((id) => id.trim().toUpperCase()));
    if (!watchedSet.has(channelId.trim().toUpperCase())) return;

    // Cheap pre-filter before expensive mkdir/API calls.
    if ((event.subtype && event.subtype !== 'file_share') || event.bot_id || !event.user) return;
    const hasFiles = (event.files?.length ?? 0) > 0;
    if (!event.text && !hasFiles) return;

    // Mark pending BEFORE the resolveChannelWorkspace/resolveRootThreadTs awaits —
    // otherwise two concurrent inbound events can race so that a newer-ts success
    // advances the cursor past an older-ts message that hasn't yet reached
    // routingService's markPending call.
    this.catchupService.markPending(channelId, event.ts);

    const normalizedChannelId = channelId.trim().toUpperCase();
    const alreadyMapped = Boolean(
      (settings.channelWorkspaceMap[normalizedChannelId] ?? settings.channelWorkspaceMap[channelId.trim()] ?? '').trim()
    );
    const defaultWorkingDirectory = await this.workspaceManager.resolveChannelWorkspace(
      channelId,
      settings.channelWorkspaceMap,
      settings.defaultWorkingDirectory
    );
    // Persist the resolved workspace as an explicit mapping the first time we see a channel,
    // so it shows as mapped in Settings and resolves to the same folder going forward.
    if (defaultWorkingDirectory && !alreadyMapped) {
      this.persistChannelMapping(normalizedChannelId, defaultWorkingDirectory);
    }
    const rootThreadTs = await this.threadResolver.resolveRootThreadTs(channelId, event.ts, event.thread_ts);
    await this.routingService.processInboundMessage({
      channelId,
      message: {
        ts: event.ts,
        text: event.text,
        user: event.user,
        bot_id: event.bot_id,
        subtype: event.subtype,
        files: event.files,
      },
      rootThreadTs,
      defaultWorkingDirectory,
      requireMention: settings.requireMention,
    });
  }

  private async handleSocketEnvelope(envelopeUnknown: unknown): Promise<void> {
    const envelope = envelopeUnknown as SlackSocketEnvelope;
    if (typeof envelope?.ack === 'function') {
      try {
        await envelope.ack();
      } catch {
        /* noop */
      }
    }
    if (envelope?.type !== 'events_api') return;
    const event = envelope.body?.event;
    if (!event || (event.type !== 'message' && event.type !== 'app_mention')) return;
    await this.dispatchInboundSlackEvent(event);
  }

  private async addReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.webClient) return;
    await this.safeSlackCall(
      'Slack addReaction failed',
      () => this.webClient!.reactions.add({ channel: channelId, timestamp: messageTs, name: emoji }),
      { channelId, emoji }
    );
  }

  private async removeReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.webClient) return;
    await this.safeSlackCall(
      'Slack removeReaction failed',
      () => this.webClient!.reactions.remove({ channel: channelId, timestamp: messageTs, name: emoji }),
      { channelId, emoji }
    );
  }

  private async removeReactionIfPresent(channelId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.webClient) return;
    try {
      await this.webClient.reactions.remove({ channel: channelId, timestamp: messageTs, name: emoji });
    } catch (error) {
      const code = this.getSlackErrorCode(error);
      if (code === 'no_reaction' || code === 'not_reacted' || code === 'message_not_found') return;
      eventLogger.warn('slack', 'Slack removeReaction failed', {
        error: getErrorMessage(error),
        channelId,
        emoji,
      });
    }
  }

  private async postMessage(channelId: string, text: string, threadTs?: string): Promise<void> {
    if (!this.webClient) return;
    await this.safeSlackCall(
      'Slack postMessage failed',
      () =>
        this.webClient!.chat.postMessage({
          channel: channelId,
          text: clampSlackText(convertMarkdownToMrkdwn(text)),
          ...(threadTs ? { thread_ts: threadTs } : {}),
        }),
      { channelId }
    );
  }

  private async safeSlackCall(
    label: string,
    fn: () => Promise<unknown>,
    context?: Record<string, unknown>
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      eventLogger.warn('slack', label, { error: getErrorMessage(error), ...context });
    }
  }

  private getSlackErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const data = (error as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return undefined;
    const code = (data as { error?: unknown }).error;
    return typeof code === 'string' ? code : undefined;
  }

  private readSlackSettings() {
    const current = getStore().get('settings');
    return { ...DEFAULT_SLACK_SETTINGS, ...(current.slack ?? {}) };
  }

  private persistChannelMapping(channelId: string, workspacePath: string): void {
    // Synchronous claim before the read-modify-write below. JS is single-threaded, so the
    // first concurrent first-message to reach here wins and the rest no-op — preventing two
    // events from persisting divergent paths (e.g. when conversations.info is flaky).
    if (this.persistedChannelMappings.has(channelId)) return;
    const slack = this.readSlackSettings();
    const map = { ...(slack.channelWorkspaceMap ?? {}) };
    if ((map[channelId] ?? '').trim()) {
      this.persistedChannelMappings.add(channelId);
      return; // already mapped
    }
    map[channelId] = workspacePath;
    this.persistedChannelMappings.add(channelId);
    setSettings({ slack: { ...slack, channelWorkspaceMap: map } });
    eventLogger.info('slack', 'Persisted Slack channel workspace mapping', { channelId, workspacePath });
  }

  private async logSlackAuthDiagnostics(watchedChannelCount: number, watchedChannelIds: string[]): Promise<void> {
    if (!this.webClient) return;
    try {
      const auth = await this.webClient.auth.test();
      eventLogger.info('slack', 'Slack socket mode connected', {
        watchedChannelCount,
        team: auth.team ?? null,
        botUserId: auth.user_id ?? null,
      });
      await this.logWatchedChannelDiagnostics(watchedChannelIds);
    } catch (error) {
      eventLogger.warn('slack', 'Slack auth.test failed after socket connect', { error: getErrorMessage(error) });
      eventLogger.info('slack', 'Slack socket mode connected', { watchedChannelCount });
    }
  }

  private async logWatchedChannelDiagnostics(watchedChannelIds: string[]): Promise<void> {
    if (!this.webClient) return;
    for (const rawChannelId of watchedChannelIds) {
      const channelId = rawChannelId.trim();
      if (!channelId) continue;
      try {
        const response = await this.webClient.conversations.info({ channel: channelId });
        eventLogger.info('slack', 'Slack watched channel ready', {
          channelId,
          channelName: response.channel?.name ?? null,
          isMember: response.channel?.is_member ?? null,
          isPrivate: response.channel?.is_private ?? null,
        });
      } catch (error) {
        eventLogger.warn('slack', 'Slack watched channel not accessible', { channelId, error: getErrorMessage(error) });
      }
    }
  }
}

export const slackBridge = new SlackBridge();
