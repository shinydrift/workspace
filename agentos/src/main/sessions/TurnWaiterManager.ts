import type { Provider } from '../../shared/types';
import { getEffectiveQueueSilenceFallbackMs } from '../../shared/effectiveProjectSettings';
import type { QueueSource } from './ThreadInputQueue';
import { getStore } from '../store/index'; // settings only
import * as threadStore from '../threads/threadStore';
import { isCliReady } from '../utils/readySignalDetector';
import { eventLogger } from '../utils/eventLog';
import { loadProjectConfigSync } from '../config/projectConfig';

const STALL_MS = 120_000;

type TurnWaiter = {
  provider: Provider;
  source: QueueSource;
  tail: string;
  silenceTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  stallTimer?: NodeJS.Timeout;
  onStall?: () => void;
  settle: (reason: 'ready-signal' | 'silence-fallback' | 'timeout' | 'cancelled', error?: Error) => void;
};

export class TurnWaiterManager {
  private waiters = new Map<string, TurnWaiter>();

  has(threadId: string): boolean {
    return this.waiters.has(threadId);
  }

  observe(threadId: string, data: string): void {
    const waiter = this.waiters.get(threadId);
    if (!waiter) return;
    waiter.tail = `${waiter.tail}${data}`.slice(-4096);
    if (isCliReady(waiter.provider, waiter.tail)) {
      waiter.settle('ready-signal');
      return;
    }
    const silenceFallbackMs = this.getSilenceFallbackMs(threadId);
    if (waiter.silenceTimer) clearTimeout(waiter.silenceTimer);
    waiter.silenceTimer = setTimeout(() => {
      waiter.settle('silence-fallback');
    }, silenceFallbackMs);
    if (waiter.onStall) {
      clearTimeout(waiter.stallTimer);
      waiter.stallTimer = setTimeout(() => waiter.onStall(), STALL_MS);
    }
  }

  reject(threadId: string, error: Error): void {
    const waiter = this.waiters.get(threadId);
    if (!waiter) return;
    waiter.settle('cancelled', error);
  }

  async wait(
    threadId: string,
    source: QueueSource,
    hasPty: boolean,
    provider: Provider,
    timeoutMs?: number,
    onStall?: () => void
  ): Promise<void> {
    if (!hasPty) {
      throw new Error(`Thread ${threadId} is not running`);
    }
    if (this.waiters.has(threadId)) {
      throw new Error(`Thread ${threadId} already has a pending turn waiter`);
    }

    const silenceFallbackMs = this.getSilenceFallbackMs(threadId);

    await new Promise<void>((resolve, reject) => {
      const waiter: TurnWaiter = {
        provider,
        source,
        tail: '',
        onStall,
        settle: (reason, error) => {
          const active = this.waiters.get(threadId);
          if (!active || active !== waiter) return;
          if (waiter.silenceTimer) clearTimeout(waiter.silenceTimer);
          if (waiter.timeoutTimer) clearTimeout(waiter.timeoutTimer);
          if (waiter.stallTimer) clearTimeout(waiter.stallTimer);
          this.waiters.delete(threadId);
          if (error) {
            reject(error);
            return;
          }
          eventLogger.debug('queue', 'Queued input completed turn wait', {
            threadId,
            source,
            strategy: reason,
          });
          resolve();
        },
      };

      if (timeoutMs && timeoutMs > 0) {
        waiter.timeoutTimer = setTimeout(() => {
          waiter.settle('timeout', new Error(`Input timed out waiting for completion after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const armSilenceFallback = (): void => {
        if (waiter.silenceTimer) clearTimeout(waiter.silenceTimer);
        waiter.silenceTimer = setTimeout(() => {
          waiter.settle('silence-fallback');
        }, silenceFallbackMs);
      };

      this.waiters.set(threadId, waiter);
      armSilenceFallback();
      if (onStall) {
        waiter.stallTimer = setTimeout(() => onStall(), STALL_MS);
      }
    });
  }

  private getSilenceFallbackMs(threadId: string): number {
    const thread = threadStore.getThread(threadId);
    const projectPath = thread?.projectPath ?? thread?.workingDirectory;
    const projectConfig = projectPath ? loadProjectConfigSync(projectPath) : null;
    return getEffectiveQueueSilenceFallbackMs(getStore().get('settings'), projectConfig);
  }
}
