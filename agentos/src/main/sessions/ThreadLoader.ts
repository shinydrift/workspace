import { app } from 'electron';
import type { Thread } from '../../shared/types';
import * as threadStore from '../threads/threadStore';
import { worktreeWorkerClient } from '../utils/worktreeWorkerClientDefaults';
import { eventLogger } from '../utils/eventLog';
import { pruneOrphanProjects as pruneOrphanProjectsFn } from './containerProjectManager';
import { ensureDataDirs } from './messagePersistence';
import { threadPostsStore } from './threadPostsStore';
import type { ThreadOutputManager } from './threadOutput';

// 'archived' is intentionally excluded — archived threads are filtered out before runtime use.
const VALID_STATUSES = new Set(['running', 'idle', 'error', 'stopped', 'building']);
const VALID_PROVIDERS = new Set([undefined, 'claude', 'claude-interactive', 'codex', 'gemini', 'pi']);

async function withConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class ThreadLoader {
  private _sessionsDataDir = '';
  private lateLoadData: {
    sanitizedSet: Set<string>;
    sanitizedThreads: Record<string, Omit<Thread, 'pid' | 'logBuffer'>>;
  } | null = null;

  constructor(private readonly output: ThreadOutputManager) {}

  get sessionsDataDir(): string {
    return this._sessionsDataDir;
  }

  loadFromStore(): void {
    const { logsDir, messagesDir, sessionsDataDir, threadPostsDir } = ensureDataDirs(app.getPath('home'));
    this._sessionsDataDir = sessionsDataDir;
    this.output.setDirs(logsDir, messagesDir);
    threadPostsStore.setDir(threadPostsDir);

    const storedThreadsArr = threadStore.getAllThreads();
    let droppedThreadCount = 0;
    const sanitizedSet = new Set<string>();

    for (const thread of storedThreadsArr) {
      if (!this.isValidStoredThread(thread)) {
        droppedThreadCount += 1;
        threadStore.deleteThread(thread.id);
        continue;
      }
      sanitizedSet.add(thread.id);
    }

    threadStore.resetToStopped([...sanitizedSet]);

    const sanitizedThreads: Record<string, Omit<Thread, 'pid' | 'logBuffer'>> = Object.fromEntries(
      storedThreadsArr
        .filter((t) => sanitizedSet.has(t.id))
        .map((t) => [t.id, { ...t, provider: t.provider ?? 'claude', status: 'stopped' as Thread['status'] }])
    );
    pruneOrphanProjectsFn(sanitizedThreads);

    if (droppedThreadCount > 0) {
      eventLogger.warn('thread', 'Dropped invalid persisted threads during store load', { droppedThreadCount });
    }

    for (const id of sanitizedSet) {
      this.output.initLogBuffer(id);
    }

    this.lateLoadData = { sanitizedSet, sanitizedThreads };
  }

  async loadFromStoreLate(): Promise<void> {
    if (!this.lateLoadData) return;
    const { sanitizedSet, sanitizedThreads } = this.lateLoadData;
    this.lateLoadData = null;

    const projectPaths = new Set<string>();
    const worktreeThreads: Array<Omit<Thread, 'pid' | 'logBuffer'>> = [];
    for (const t of Object.values(sanitizedThreads)) {
      if (t.projectPath) projectPaths.add(t.projectPath);
      if (t.usingWorktree && t.workingDirectory) worktreeThreads.push(t);
    }

    const activeWorktreePaths = new Set<string>();
    await withConcurrency(worktreeThreads, 4, async (t) => {
      if (!(await worktreeWorkerClient.isWorktreeClean(t.workingDirectory))) {
        activeWorktreePaths.add(t.workingDirectory);
      }
    });

    await worktreeWorkerClient.pruneOrphanWorktrees(activeWorktreePaths, projectPaths);

    const stoppedIds = [...sanitizedSet].filter((id) => threadStore.getThread(id)?.status === 'stopped');
    await this.output.preloadFromDiskAsync(stoppedIds);
  }

  private isValidStoredThread(value: unknown): value is Omit<Thread, 'logBuffer'> {
    if (!value || typeof value !== 'object') return false;
    const thread = value as Partial<Thread>;
    return (
      VALID_STATUSES.has(thread.status as string) &&
      VALID_PROVIDERS.has(thread.provider) &&
      typeof thread.id === 'string' &&
      thread.id.length > 0 &&
      typeof thread.name === 'string' &&
      thread.name.length > 0 &&
      typeof thread.projectId === 'string' &&
      thread.projectId.length > 0 &&
      typeof thread.workingDirectory === 'string' &&
      thread.workingDirectory.length > 0 &&
      typeof thread.createdAt === 'number' &&
      Number.isFinite(thread.createdAt) &&
      typeof thread.lastActiveAt === 'number' &&
      Number.isFinite(thread.lastActiveAt)
    );
  }
}
