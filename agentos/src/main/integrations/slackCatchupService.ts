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

// Per-channel cap on pending entries. Permanent failures (e.g. bad payload that
// always crashes) would otherwise leak entries forever and pin the cursor; this
// bounds the working set. The oldest entry is evicted when full so the cursor
// is freed and the (likely poisonous) message is given up on.
const MAX_PENDING_PER_CHANNEL = 100;

export class SlackCatchupService {
  // In-flight or failed message timestamps per channel. Cursor advancement is capped
  // below the minimum entry so a later success can't jump the cursor past an earlier
  // failure, leaving the failed message reachable on the next catchup sweep.
  // Insertion-ordered (Set) so we can evict the oldest entry when full.
  private readonly pendingByChannel = new Map<string, Set<string>>();
  // Tracks which failed messages we've already posted a user-facing error about,
  // so periodic-catchup retries don't spam the channel with duplicate notices.
  private readonly notifiedFailures = new Map<string, Set<string>>();

  constructor(
    private readonly getWebClient: () => WebClient | null,
    private readonly dispatchInboundSlackEvent: (event: SlackInboundEvent) => Promise<void>
  ) {}

  /** Returns true if the ts was newly added (caller can treat as first attempt). */
  markPending(channelId: string, ts: string): boolean {
    const set = this.pendingByChannel.get(channelId) ?? new Set<string>();
    const wasNew = !set.has(ts);
    set.add(ts);
    if (set.size > MAX_PENDING_PER_CHANNEL) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) {
        set.delete(oldest);
        eventLogger.warn('slack', 'Evicting oldest pending Slack message; cap reached', {
          channelId,
          evictedTs: oldest,
        });
      }
    }
    this.pendingByChannel.set(channelId, set);
    return wasNew;
  }

  markCompleted(channelId: string, ts: string): void {
    const set = this.pendingByChannel.get(channelId);
    if (set) {
      set.delete(ts);
      if (set.size === 0) this.pendingByChannel.delete(channelId);
    }
    const notified = this.notifiedFailures.get(channelId);
    if (notified) {
      notified.delete(ts);
      if (notified.size === 0) this.notifiedFailures.delete(channelId);
    }
  }

  /** Returns true if we should post a failure notice (i.e. we haven't already for this ts). */
  tryMarkFailureNotified(channelId: string, ts: string): boolean {
    const set = this.notifiedFailures.get(channelId) ?? new Set<string>();
    if (set.has(ts)) return false;
    set.add(ts);
    this.notifiedFailures.set(channelId, set);
    return true;
  }

  /** Clear all in-memory state. Called on bridge stop() so a re-enable doesn't pin the cursor on phantom entries. */
  clear(): void {
    this.pendingByChannel.clear();
    this.notifiedFailures.clear();
  }

  updateChannelCursor(channelId: string, ts: string): void {
    const existing = getSlackCursor(channelId);
    const proposed = this.cursorAfter(ts);
    const pending = this.pendingByChannel.get(channelId);
    const cap = pending && pending.size > 0 ? this.minPendingCursor(pending) : null;
    const next = cap && cap < proposed ? cap : proposed;
    if (!existing || next > existing) {
      setSlackCursor(channelId, next);
    }
  }

  private cursorAfter(ts: string): string {
    const [secs, frac = ''] = ts.split('.');
    const micro = BigInt(secs) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6)) + 1n;
    return `${(micro / 1_000_000n).toString()}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
  }

  private minPendingCursor(pending: Set<string>): string {
    let min: string | null = null;
    for (const ts of pending) {
      if (min === null || ts < min) min = ts;
    }
    // Caller guards with pending.size > 0, so min is always assigned.
    // Cap at the pending ts itself; sweepChannelHistory/sweepThreadReplies pass
    // `inclusive: true` so the message AT the cursor is re-fetched.
    return min as string;
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
    // inclusive: true so a cursor capped AT a failed message's ts re-fetches that
    // message — Slack's `oldest` is exclusive by default, which would skip it.
    await this.sweepMessages(
      (cursor) => webClient.conversations.history({ channel: channelId, oldest, inclusive: true, limit: 200, cursor }),
      channelId
    );
  }

  private async sweepThreadReplies(channelId: string, threadTs: string, oldest: string): Promise<void> {
    const webClient = this.getWebClient();
    if (!webClient) return;
    await this.sweepMessages(
      (cursor) =>
        webClient.conversations.replies({
          channel: channelId,
          ts: threadTs,
          oldest,
          inclusive: true,
          limit: 200,
          cursor,
        }),
      channelId,
      threadTs,
      threadTs
    );
  }
}
