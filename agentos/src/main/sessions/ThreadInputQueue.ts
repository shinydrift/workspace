import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

export type QueueSource = 'user' | 'automation' | 'autopilot' | 'boot' | 'skills';
type DropPolicy = 'never' | 'timeout';

type QueueItem = {
  id: string;
  input: string;
  source: QueueSource;
  enqueuedAt: number;
  timeoutMs: number;
  dropPolicy: DropPolicy;
  execute: (item: QueueItem) => Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class ThreadInputQueue {
  private queues = new Map<string, QueueItem[]>();
  private processing = new Set<string>();

  async enqueue(params: {
    threadId: string;
    input: string;
    source: QueueSource;
    timeoutMs?: number;
    dropPolicy?: DropPolicy;
    execute: (item: QueueItem) => Promise<void>;
    onDepthChange?: (threadId: string, depth: number) => void;
  }): Promise<void> {
    const timeoutMs = Math.max(1_000, params.timeoutMs ?? 120_000);
    const dropPolicy: DropPolicy = params.dropPolicy ?? 'timeout';
    const queue = this.queues.get(params.threadId) ?? [];

    return await new Promise<void>((resolve, reject) => {
      const item: QueueItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        input: params.input,
        source: params.source,
        enqueuedAt: Date.now(),
        timeoutMs,
        dropPolicy,
        execute: params.execute,
        resolve,
        reject,
      };
      queue.push(item);
      this.queues.set(params.threadId, queue);
      params.onDepthChange?.(params.threadId, queue.length);

      if (!this.processing.has(params.threadId)) {
        this.drain(params.threadId, params.onDepthChange).catch((error: unknown) => {
          eventLogger.error('queue', 'Queue drain failed', {
            threadId: params.threadId,
            error: getErrorMessage(error),
          });
        });
      }
    });
  }

  queueDepth(threadId: string): number {
    return (this.queues.get(threadId) ?? []).length;
  }

  clearQueue(threadId: string): void {
    const queue = this.queues.get(threadId) ?? [];
    for (const item of queue) {
      item.reject(new Error('Thread queue cleared'));
    }
    this.queues.delete(threadId);
    this.processing.delete(threadId);
  }

  // Drop pending (not-yet-executing) items from the given source. The first item is
  // currently executing and is left untouched. Returns the number of items dropped.
  dropPendingItemsBySource(
    threadId: string,
    source: QueueSource,
    onDepthChange?: (threadId: string, depth: number) => void
  ): number {
    const queue = this.queues.get(threadId);
    if (!queue || queue.length <= 1) return 0;

    const pending = queue.splice(1); // detach everything after the executing item
    const toReject = pending.filter((item) => item.source === source);
    const toKeep = pending.filter((item) => item.source !== source);
    queue.push(...toKeep);

    if (toReject.length > 0) {
      onDepthChange?.(threadId, queue.length);
      for (const item of toReject) {
        item.reject(new Error('Superseded by newer input'));
      }
    }
    return toReject.length;
  }

  private async drain(threadId: string, onDepthChange?: (threadId: string, depth: number) => void): Promise<void> {
    if (this.processing.has(threadId)) return;
    this.processing.add(threadId);
    try {
      let queue = this.queues.get(threadId) ?? [];
      while (queue.length > 0) {
        const currentQueue = this.queues.get(threadId) ?? [];
        const item = currentQueue[0];
        if (!item) break;

        const waitMs = Date.now() - item.enqueuedAt;
        if (item.dropPolicy === 'timeout' && waitMs > item.timeoutMs) {
          currentQueue.shift();
          onDepthChange?.(threadId, currentQueue.length);
          item.reject(new Error(`Input timed out in queue after ${item.timeoutMs}ms`));
          eventLogger.warn('queue', 'Dropping expired queued input', {
            threadId,
            source: item.source,
            timeoutMs: item.timeoutMs,
          });
          continue;
        }

        try {
          await item.execute(item);
          item.resolve();
        } catch (error: unknown) {
          item.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          currentQueue.shift();
          onDepthChange?.(threadId, currentQueue.length);
        }
        queue = this.queues.get(threadId) ?? [];
      }
    } finally {
      this.processing.delete(threadId);
      if ((this.queues.get(threadId) ?? []).length === 0) {
        this.queues.delete(threadId);
      }
    }
  }
}
