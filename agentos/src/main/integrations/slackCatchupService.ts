import type { WebClient } from '@slack/web-api';
import { eventLogger } from '../utils/eventLog';
import type { SlackFile } from './slackFileService';
import { getAllSlackBindings, getSlackCursor, setSlackCursor, deleteSlackBinding } from '../threads/db';

export type SlackInboundEvent = {
  type?: string;
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
  channel?: string;
  files?: SlackFile[];
};

export class SlackCatchupService {
  constructor(
    private readonly getWebClient: () => WebClient | null,
    private readonly dispatchInboundSlackEvent: (event: SlackInboundEvent) => Promise<void>
  ) {}

  updateChannelCursor(channelId: string, ts: string): void {
    const existing = getSlackCursor(channelId);
    const [secs, frac = ''] = ts.split('.');
    const micro = BigInt(secs) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6)) + 1n;
    const nextTs = `${(micro / 1_000_000n).toString()}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
    if (!existing || nextTs > existing) {
      setSlackCursor(channelId, nextTs);
    }
  }

  async catchUpMissedMessages(watchedChannelIds: string[]): Promise<void> {
    const webClient = this.getWebClient();
    if (!webClient) return;
    const defaultCursor = `${Math.floor(Date.now() / 1000 - 86400)}.000000`;

    for (const rawChannelId of watchedChannelIds) {
      const channelId = rawChannelId.trim();
      if (!channelId) continue;
      const oldest = getSlackCursor(channelId) ?? defaultCursor;
      try {
        await this.sweepChannelHistory(channelId, oldest);
      } catch (error) {
        eventLogger.warn('slack', 'Catch-up sweep failed for channel', { channelId, error: String(error) });
      }
    }

    const bindings = getAllSlackBindings();
    for (const binding of bindings) {
      if (!binding.threadId) continue;
      const channelId = binding.channelId;
      const oldest = getSlackCursor(channelId) ?? defaultCursor;
      try {
        await this.sweepThreadReplies(channelId, binding.threadTs, oldest);
      } catch (error) {
        const slackErrCode = (error as { data?: { error?: string } })?.data?.error;
        if (slackErrCode === 'thread_not_found') {
          eventLogger.info('slack', 'Removing stale binding for deleted thread', {
            channelId,
            threadTs: binding.threadTs,
          });
          deleteSlackBinding(binding.key);
        } else {
          eventLogger.warn('slack', 'Catch-up sweep failed for thread', {
            channelId,
            threadTs: binding.threadTs,
            error: String(error),
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    eventLogger.info('slack', 'Slack catch-up sweep complete', { channels: watchedChannelIds.length });
  }

  private mapSlackApiMessage(msg: unknown, channelId: string, overrideThreadTs?: string): SlackInboundEvent {
    const m = msg as {
      type?: unknown;
      ts?: unknown;
      text?: unknown;
      user?: unknown;
      bot_id?: unknown;
      subtype?: unknown;
      thread_ts?: unknown;
      files?: unknown;
    };
    return {
      type: typeof m.type === 'string' ? m.type : undefined,
      ts: typeof m.ts === 'string' ? m.ts : undefined,
      text: typeof m.text === 'string' ? m.text : undefined,
      user: typeof m.user === 'string' ? m.user : undefined,
      bot_id: typeof m.bot_id === 'string' ? m.bot_id : undefined,
      subtype: typeof m.subtype === 'string' ? m.subtype : undefined,
      thread_ts: overrideThreadTs ?? (typeof m.thread_ts === 'string' ? m.thread_ts : undefined),
      channel: channelId,
      files: Array.isArray(m.files) ? (m.files as SlackFile[]) : undefined,
    };
  }

  private async sweepMessages(
    fetcher: (cursor?: string) => Promise<{ messages?: unknown[]; response_metadata?: { next_cursor?: string } }>,
    channelId: string,
    overrideThreadTs?: string,
    skipTs?: string
  ): Promise<void> {
    // Collect all pages first — Slack returns newest-first, so per-page reverse produces wrong
    // global order across pages. Collecting then sorting guarantees oldest→newest dispatch.
    const allMessages: unknown[] = [];
    let cursor: string | undefined;
    do {
      const result = await fetcher(cursor);
      allMessages.push(...(result.messages ?? []));
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    allMessages.sort((a, b) => {
      const tsA = (a as { ts?: string }).ts ?? '';
      const tsB = (b as { ts?: string }).ts ?? '';
      return tsA < tsB ? -1 : tsA > tsB ? 1 : 0;
    });

    for (const msg of allMessages) {
      const m = msg as { ts?: string; type?: string };
      if (!m.ts || m.type !== 'message') continue;
      if (skipTs && m.ts === skipTs) continue;
      await this.dispatchInboundSlackEvent(this.mapSlackApiMessage(msg, channelId, overrideThreadTs));
    }
  }

  private async sweepChannelHistory(channelId: string, oldest: string): Promise<void> {
    const webClient = this.getWebClient();
    if (!webClient) return;
    await this.sweepMessages(
      (cursor) => webClient.conversations.history({ channel: channelId, oldest, limit: 200, cursor }),
      channelId
    );
  }

  private async sweepThreadReplies(channelId: string, threadTs: string, oldest: string): Promise<void> {
    const webClient = this.getWebClient();
    if (!webClient) return;
    await this.sweepMessages(
      (cursor) => webClient.conversations.replies({ channel: channelId, ts: threadTs, oldest, limit: 200, cursor }),
      channelId,
      threadTs,
      threadTs
    );
  }
}
