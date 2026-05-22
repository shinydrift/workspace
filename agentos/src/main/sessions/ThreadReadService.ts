import * as threadStore from '../threads/threadStore';
import type { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { ThreadOutputManager } from './threadOutput';
import type { ThreadInputQueue } from './ThreadInputQueue';
import type { Thread, ThreadLogEntry, ThreadInjectionStatus, Message } from '../../shared/types';

export class ThreadReadService {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly output: ThreadOutputManager,
    private readonly inputQueue: ThreadInputQueue
  ) {}

  private decorateThread(stored: Omit<Thread, 'pid' | 'logBuffer'>): Thread {
    return {
      ...stored,
      queueDepth: this.inputQueue.queueDepth(stored.id),
      logBuffer: [] as ThreadLogEntry[],
      sessionStartedAt: this.store.sessionStartedAts.get(stored.id),
      personalityOverride: this.store.personalityOverrides.get(stored.id),
    };
  }

  getThreads(): Thread[] {
    return threadStore
      .getAllThreads()
      .filter((t) => t.status !== 'archived')
      .map((t) => this.decorateThread(t));
  }

  getThread(threadId: string): Thread | null {
    const stored = threadStore.getThread(threadId);
    if (!stored) return null;
    return this.decorateThread(stored);
  }

  getLogHistory(threadId: string): ThreadLogEntry[] {
    return this.output.getLogHistory(threadId);
  }

  getPendingOutput(threadId: string): string {
    return this.output.getPendingOutput(threadId);
  }

  getInjectionStatus(threadId: string): ThreadInjectionStatus {
    return this.store.getInjectionStatus(threadId);
  }

  listMessages(threadId: string, opts?: { sinceMs?: number; role?: string }): Message[] {
    return this.output.listMessages(threadId, opts);
  }
}
