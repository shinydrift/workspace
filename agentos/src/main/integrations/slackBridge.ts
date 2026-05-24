import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type { AppSettings, Message, SlackChannelOption, ThreadStatusEvent } from '../../shared/types';
import { DEFAULT_SLACK_SETTINGS, parseAutopilotDecision } from '../../shared/types';
import { getStore } from '../store/index';
import { BaseBridge } from './BaseBridge';
import { eventLogger } from '../utils/eventLog';
import { slackMcpServer } from './slackMcpServer';
import { SlackWorkspaceManager } from './slackWorkspaces';
import { clampSlackText, convertMarkdownToMrkdwn } from './slackFormatting';
import { DedupCache } from './DedupCache';
import { SlackFileService } from './slackFileService';
import { SlackCatchupService, type SlackInboundEvent } from './slackCatchupService';
import { SlackRoutingService } from './slackRoutingService';
import { SlackThreadResolver } from './slackThreadResolver';
import { getProject } from '../threads/db';

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

const PERIODIC_CATCHUP_MS = 10 * 60 * 1000;

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
  /** Tracks Slack messages until autopilot reaches a terminal state and Slack can post ✅ or ❌. */
  private pendingAutopilotChecks = new Map<string, Array<{ channelId: string; messageTs: string }>>();
  /** Deduplicates concurrent createThread calls for the same Slack thread binding. */
  private pendingThreadCreations = new Map<string, Promise<{ id: string; workingDirectory: string }>>();
  private routingService = new SlackRoutingService({
    workspaceManager: this.workspaceManager,
    fileService: this.fileService,
    catchupService: this.catchupService,
    processedMessageKeys: this.processedMessageKeys,
    pendingThreadCreations: this.pendingThreadCreations,
    getDeps: () => this.deps,
    getBotToken: () => this.readSlackSettings().botToken?.trim(),
    postMessage: async (channelId, text, threadTs) => this.postMessage(channelId, text, threadTs),
    addReaction: async (channelId, messageTs, emoji) => this.addReaction(channelId, messageTs, emoji),
    removeReaction: async (channelId, messageTs, emoji) => this.removeReaction(channelId, messageTs, emoji),
    onAutopilotPending: (threadId, check) => {
      const existing = this.pendingAutopilotChecks.get(threadId) ?? [];
      existing.push(check);
      this.pendingAutopilotChecks.set(threadId, existing);
      // Evict oldest thread entry when map grows too large.
      if (this.pendingAutopilotChecks.size > 500) {
        const firstKey = this.pendingAutopilotChecks.keys().next().value;
        if (firstKey !== undefined) this.pendingAutopilotChecks.delete(firstKey);
      }
    },
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
      slackMcpServer.init(this.webClient);
      slackMcpServer.start();
      this.startedBotToken = botToken;
    }

    if (!hasSocketMode) {
      this.stopSocketMode();
      return;
    }

    const sortedWatchedIds = [...slack.watchedChannelIds].map((id) => id.trim().toUpperCase()).sort();
    const channelMapSorted = Object.fromEntries(
      Object.entries(slack.channelWorkspaceMap ?? {}).sort(([a], [b]) => a.localeCompare(b))
    );
    const socketConfigKey = JSON.stringify({
      botToken,
      appToken: slack.appToken,
      watchedChannelIds: sortedWatchedIds,
      channelWorkspaceMap: channelMapSorted,
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

  onThreadStatus(payload: ThreadStatusEvent): void {
    const settings = this.readSlackSettings();
    if (!settings.enabled) return;

    // Deferred autopilot check: when autopilot reaches a terminal state, post ✅ or ❌.
    const pendingChecks = this.pendingAutopilotChecks.get(payload.threadId);
    if (pendingChecks) {
      const isError = payload.status === 'error';
      const autopilotDone = payload.autopilotState === 'stopped' || payload.autopilotState === 'blocked';
      if (isError || autopilotDone) {
        this.pendingAutopilotChecks.delete(payload.threadId);
        const doneEmoji = isError ? 'x' : 'white_check_mark';
        for (const check of pendingChecks) {
          void this.removeReaction(check.channelId, check.messageTs, 'robot_face');
          void this.addReaction(check.channelId, check.messageTs, doneEmoji);
        }
      }
      return;
    }

    // Backward-compat only: update reactions for old stored bindings that still carry
    // a lastInboundTs (written before per-message reaction tracking was introduced).
    const isError = payload.status === 'error';
    const isTurnComplete = payload.status === 'running' && (payload.queueDepth ?? 0) === 0;
    if (!isError && !isTurnComplete) return;

    const bindings = this.workspaceManager.bindingsForThread(payload.threadId);
    if (bindings.length === 0) return;

    const doneEmoji = isError ? 'x' : 'white_check_mark';
    for (const binding of bindings) {
      if (binding.lastInboundTs) {
        void this.removeReaction(binding.channelId, binding.lastInboundTs, 'eyes');
        void this.addReaction(binding.channelId, binding.lastInboundTs, doneEmoji);
      }
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
    const bindings = this.workspaceManager.bindingsForThread(params.threadId);
    for (const binding of bindings) {
      void this.postMessage(binding.channelId, text, binding.threadTs);
    }
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

  async startAutomationThread(
    channelId: string,
    jobName: string
  ): Promise<{ channelId: string; threadTs: string } | null> {
    if (!this.webClient) return null;
    try {
      const result = await this.webClient.chat.postMessage({
        channel: channelId,
        text: `⚡ Automation: *${escapeMrkdwn(jobName)}* is running...`,
      });
      const ts = result.ts;
      if (!ts) return null;
      return { channelId, threadTs: ts };
    } catch (error) {
      eventLogger.warn('slack', 'Failed to start automation Slack thread', {
        error: getErrorMessage(error),
        channelId,
      });
      return null;
    }
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
    this.pendingAutopilotChecks.clear();
    // catchupService lives across stop()/applySettings cycles — clear its in-memory
    // pending and notification state so a re-enabled bridge doesn't inherit phantom
    // entries that would pin the cursor or suppress error notices forever.
    this.catchupService.clear();
    this.workspaceManager.setWebClient(null);
    this.webClient = null;
    slackMcpServer.stop();
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

    const defaultWorkingDirectory = await this.workspaceManager.resolveChannelWorkspace(
      channelId,
      settings.channelWorkspaceMap,
      settings.defaultWorkingDirectory
    );
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

  private async postMessage(channelId: string, text: string, threadTs: string): Promise<void> {
    if (!this.webClient) return;
    await this.safeSlackCall(
      'Slack postMessage failed',
      () =>
        this.webClient!.chat.postMessage({
          channel: channelId,
          text: clampSlackText(convertMarkdownToMrkdwn(text)),
          thread_ts: threadTs,
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

  private readSlackSettings() {
    const current = getStore().get('settings');
    return { ...DEFAULT_SLACK_SETTINGS, ...(current.slack ?? {}) };
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
