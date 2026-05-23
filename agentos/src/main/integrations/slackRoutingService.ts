import path from 'path';
import { deriveThreadTitleFromMessage } from '../../shared/threadTitle';
import { getStore } from '../store/index';
import { audioService } from '../audio/audioService';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { eventLogger } from '../utils/eventLog';
import type { DedupCache } from './DedupCache';
import type { SlackBinding, SlackWorkspaceManager } from './slackWorkspaces';
import type { SlackCatchupService } from './slackCatchupService';
import type { SlackFile, SlackFileService } from './slackFileService';

type SlackBridgeDeps = {
  createThread: (req: { name: string; workingDirectory: string }) => Promise<{ id: string; workingDirectory: string }>;
  sendInput: (
    threadId: string,
    input: string,
    source: 'user',
    options?: { systemPromptSuffix?: string }
  ) => Promise<void>;
  getThreadWorkingDirectory: (threadId: string) => string | null;
  setSlackContext: (threadId: string, ctx: { channelId: string; threadTs: string | null }) => void;
  setAutopilot?: (threadId: string, enabled: boolean, options?: { triggerAfterTurn?: boolean }) => void;
};

export class SlackRoutingService {
  constructor(
    private readonly args: {
      workspaceManager: SlackWorkspaceManager;
      fileService: SlackFileService;
      catchupService: SlackCatchupService;
      processedMessageKeys: DedupCache;
      pendingThreadCreations: Map<string, Promise<{ id: string; workingDirectory: string }>>;
      getDeps: () => SlackBridgeDeps | null;
      getBotToken: () => string | undefined;
      postMessage: (channelId: string, text: string, threadTs: string) => Promise<void>;
      addReaction: (channelId: string, messageTs: string, emoji: string) => Promise<void>;
      removeReaction: (channelId: string, messageTs: string, emoji: string) => Promise<void>;
      onAutopilotPending: (threadId: string, check: { channelId: string; messageTs: string }) => void;
    }
  ) {}

  async processInboundMessage(params: {
    channelId: string;
    rootThreadTs: string;
    defaultWorkingDirectory: string | null;
    requireMention: boolean;
    message: { ts: string; text?: string; user?: string; bot_id?: string; subtype?: string; files?: SlackFile[] };
  }): Promise<void> {
    const { message } = params;
    if ((message.subtype && message.subtype !== 'file_share') || message.bot_id || !message.user) return;
    const hasFiles = (message.files?.length ?? 0) > 0;
    if (!message.text && !hasFiles) return;

    const messageKey = `${params.channelId}:${message.ts}`;
    if (this.args.processedMessageKeys.has(messageKey)) return;

    const task = (message.text ?? '')
      .trim()
      .replace(/^<@[A-Z0-9]+>\s*/i, '')
      .trim();

    // When requireMention is on, ignore root thread messages that don't @ mention the bot.
    // Replies in existing threads always pass through.
    if (params.requireMention && message.ts === params.rootThreadTs) {
      if (!/<@[A-Z0-9]+>/.test(message.text ?? '')) {
        this.args.processedMessageKeys.add(messageKey);
        this.args.catchupService.updateChannelCursor(params.channelId, message.ts);
        return;
      }
    }

    if (!task && !hasFiles) {
      this.args.processedMessageKeys.add(messageKey);
      this.args.catchupService.updateChannelCursor(params.channelId, message.ts);
      return;
    }

    if (!params.defaultWorkingDirectory) {
      await this.args.postMessage(
        params.channelId,
        'AgentOS: set Slack default working directory in Settings before sending tasks.',
        params.rootThreadTs
      );
      this.args.processedMessageKeys.add(messageKey);
      this.args.catchupService.updateChannelCursor(params.channelId, message.ts);
      return;
    }

    const binding = this.args.workspaceManager.resolveOrCreateBinding(
      params.channelId,
      params.rootThreadTs,
      params.defaultWorkingDirectory
    );
    // Mark as processed BEFORE awaiting executeTask so a catchup sweep that fires
    // during a long-running turn doesn't re-enqueue the same message. Without this,
    // slow providers (claude-interactive's first turn can take 60-90s) racked up
    // duplicate user inputs from each catchup sweep that ran mid-turn.
    this.args.processedMessageKeys.add(messageKey);
    try {
      const threadId = await this.executeTask(binding, params, task, message.ts, message.files);
      this.args.catchupService.updateChannelCursor(params.channelId, message.ts);
      eventLogger.info('slack', 'Slack task queued', {
        channelId: params.channelId,
        slackThreadTs: params.rootThreadTs,
        arcThreadId: threadId,
      });
    } catch (error) {
      // Roll back the in-flight mark so a future catchup can retry. Without this,
      // a transient failure (docker not ready, container build slow) would silently
      // swallow the message permanently.
      this.args.processedMessageKeys.delete(messageKey);
      eventLogger.warn('slack', 'Failed to process inbound Slack message', {
        channelId: params.channelId,
        messageTs: message.ts,
        error: getErrorMessage(error),
      });
    }
  }

  private async executeTask(
    binding: SlackBinding,
    params: {
      channelId: string;
      rootThreadTs: string;
      defaultWorkingDirectory: string | null;
    },
    task: string,
    messageTs: string,
    files?: SlackFile[]
  ): Promise<string> {
    const deps = this.args.getDeps();
    if (!deps || !params.defaultWorkingDirectory) throw new Error('Slack bridge dependencies unavailable.');
    const workspacePath = binding.workspacePath ?? params.defaultWorkingDirectory;
    if (!workspacePath) throw new Error('Slack workspace path unavailable.');

    let threadId = binding.threadId;
    let threadWorkingDirectory: string;
    if (!threadId) {
      let creationPromise = this.args.pendingThreadCreations.get(binding.key);
      if (!creationPromise) {
        const titleSource = task || (files?.[0]?.name ?? 'file upload');
        const derivedName = deriveThreadTitleFromMessage(titleSource, { isSlack: true });
        creationPromise = deps
          .createThread({
            name: derivedName ?? `slack-${params.channelId}-${params.rootThreadTs.replace('.', '-')}`,
            workingDirectory: workspacePath,
          })
          .then((created) => {
            this.args.workspaceManager.updateBinding(binding.key, { threadId: created.id });
            return created;
          })
          .finally(() => {
            this.args.pendingThreadCreations.delete(binding.key);
          });
        this.args.pendingThreadCreations.set(binding.key, creationPromise);
      }
      const created = await creationPromise;
      threadId = created.id;
      threadWorkingDirectory = created.workingDirectory;
    } else {
      threadWorkingDirectory = deps.getThreadWorkingDirectory(threadId) ?? workspacePath;
    }

    const autopilotEnabled = Boolean(deps.setAutopilot) && Boolean(getStore().get('settings').autopilot?.enabled);
    if (autopilotEnabled) {
      // triggerAfterTurn: false — we're about to call sendInput below; letting setAutopilot
      // fire its post-enable hook here would race the queue (planner reads pre-input state,
      // then logs "state changed during planning" as soon as the input lands).
      deps.setAutopilot?.(threadId, true, { triggerAfterTurn: false });
    }

    let input = task;
    let uploadedPaths: string[] = [];
    if (files && files.length > 0) {
      const { paths, errors: downloadErrors } = await this.args.fileService.downloadFiles(
        files,
        threadWorkingDirectory,
        this.args.getBotToken()
      );
      uploadedPaths = paths;
      if (uploadedPaths.length > 0) {
        const fileList = uploadedPaths.map((p) => `  ${p}`).join('\n');
        input = input ? `${input}\n\nAttached files:\n${fileList}` : `Attached files:\n${fileList}`;
      }
      if (downloadErrors.length > 0) {
        const errorDetail = downloadErrors.join('\n');
        await this.args.postMessage(
          params.channelId,
          `AgentOS: failed to download ${downloadErrors.length} file(s):\n${errorDetail}`,
          params.rootThreadTs
        );
        if (!input) return threadId;
      }
    }

    // Transcribe any audio attachments (e.g. Slack voice memos)
    const audioFiles = (files ?? []).filter(
      (f) =>
        f.mimetype?.startsWith('audio/') &&
        f.name &&
        uploadedPaths.includes(path.join('.agentos', 'uploads', path.basename(f.name)))
    );
    if (audioFiles.length > 0) {
      const transcripts: string[] = [];
      for (const af of audioFiles) {
        const absPath = path.join(threadWorkingDirectory, '.agentos', 'uploads', path.basename(af.name!));
        try {
          const transcript = await audioService.transcribeFromFile(absPath);
          if (transcript) transcripts.push(transcript);
        } catch (err) {
          eventLogger.warn('slack', 'Failed to transcribe audio file', {
            file: af.name,
            error: getErrorMessage(err),
          });
        }
      }
      if (transcripts.length > 0) {
        const combined = transcripts.join('\n\n');
        input = input ? `${input}\n\n${combined}` : combined;
        const preview = combined.length > 300 ? `${combined.slice(0, 300)}\u2026` : combined;
        void this.args.postMessage(params.channelId, `🎙 _Transcribed:_ "${preview}"`, params.rootThreadTs);
      }
    }

    deps.setSlackContext(threadId, { channelId: params.channelId, threadTs: params.rootThreadTs });
    void this.args.addReaction(params.channelId, messageTs, 'eyes');
    const slackContextNote = `[Slack: reply via post_update(channel_id='${params.channelId}', thread_ts='${params.rootThreadTs}')]`;
    try {
      await deps.sendInput(threadId, `${input}\n`, 'user', { systemPromptSuffix: slackContextNote });
      void this.args.removeReaction(params.channelId, messageTs, 'eyes');
      if (autopilotEnabled) {
        void this.args.addReaction(params.channelId, messageTs, 'robot_face');
        this.args.onAutopilotPending(threadId, { channelId: params.channelId, messageTs });
      } else {
        void this.args.addReaction(params.channelId, messageTs, 'white_check_mark');
      }
    } catch (error) {
      void this.args.removeReaction(params.channelId, messageTs, 'eyes');
      if (error instanceof Error && error.message === 'Superseded by newer input') return threadId;
      if (error instanceof Error && error.message === 'Interrupted by user input') {
        void this.args.addReaction(params.channelId, messageTs, 'white_check_mark');
        return threadId;
      }
      eventLogger.error('slack', 'sendInput failed for Slack-triggered thread', {
        channelId: params.channelId,
        threadId,
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      void this.args.addReaction(params.channelId, messageTs, 'x');
    }

    return threadId;
  }
}
