// Main-side client for the worktree utilityProcess. Owns the spawn lifecycle and
// the request/response correlation table. Every git/docker worktree operation is
// forwarded here instead of running on the main thread — the sync spawns froze the
// app (see worktreeEngine.ts).
//
// This file is electron-free by design so it can be unit-tested with a fake child.
// worktreeWorkerClientDefaults.ts assembles the singleton with the real
// utilityProcess.fork + eventLogger wiring. Mirrors the memory worker's split.

import { WorktreeWorkerCrashedError, type WorktreeMessage, type WorktreeRequest } from './worktreeIpc';
import type { KanbanTaskGitSummary } from '../../shared/types/kanban';

// Most calls are quick; createSessionWorktree can fetch from origin and the
// startup prune walks every project, so both get a longer ceiling.
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const LONG_CALL_TIMEOUT_MS = 120_000;

// Minimal projection of Electron's UtilityProcess. Tests substitute a fake
// without dragging Electron into the test runner.
export interface WorktreeWorkerChild {
  postMessage(msg: WorktreeRequest): void;
  on(event: 'message', listener: (msg: WorktreeMessage) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  once(event: 'exit', listener: (code: number | null) => void): void;
  off(event: 'message', listener: (msg: WorktreeMessage) => void): void;
  kill(): void;
}

export type WorktreeForkFn = (entryPath: string) => WorktreeWorkerChild;
export type WorktreeLogFn = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;

export interface WorktreeWorkerClientOpts {
  entryPath: string;
  forkFn: WorktreeForkFn;
  log?: WorktreeLogFn;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

let counter = 0;
function nextId(): string {
  counter = (counter + 1) >>> 0;
  return `wt${Date.now().toString(36)}_${counter.toString(36)}`;
}

export class WorktreeWorkerClient {
  private child: WorktreeWorkerChild | null = null;
  private ready = false;
  private startingPromise: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private shuttingDown = false;
  private entryPath: string;
  private forkFn: WorktreeForkFn;
  private log: WorktreeLogFn;

  constructor(opts: WorktreeWorkerClientOpts) {
    this.entryPath = opts.entryPath;
    this.forkFn = opts.forkFn;
    this.log = opts.log ?? (() => {});
  }

  async ensureStarted(): Promise<void> {
    if (this.ready) return;
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = this.spawn().finally(() => {
      this.startingPromise = null;
    });
    return this.startingPromise;
  }

  private async spawn(): Promise<void> {
    const child = this.forkFn(this.entryPath);
    this.child = child;
    this.ready = false;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onReady = (msg: WorktreeMessage): void => {
        if (msg && typeof msg === 'object' && (msg as { kind?: string }).kind === 'ready') {
          child.off('message', onReady);
          resolve();
        }
      };
      child.on('message', onReady);
      child.once('exit', (code) =>
        reject(new WorktreeWorkerCrashedError(`Worktree worker exited before ready (code=${code})`))
      );
    });

    child.on('message', (msg: WorktreeMessage) => this.onMessage(msg));
    child.on('exit', (code) => this.onExit(code));

    await readyPromise;
    this.ready = true;
  }

  private invoke<T>(method: string, args: unknown, timeoutMs: number): Promise<T> {
    const id = nextId();
    const req: WorktreeRequest = { kind: 'request', id, method, args };
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.has(id)) return;
              this.pending.delete(id);
              reject(new WorktreeWorkerCrashedError(`Worktree worker call timed out after ${timeoutMs}ms (${method})`));
            }, timeoutMs)
          : null;
      timer?.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.child!.postMessage(req);
      } catch (err) {
        const entry = this.pending.get(id);
        if (entry?.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private onMessage(msg: WorktreeMessage): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'response') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.kind === 'event' && msg.channel === 'worktree:log') {
      const p = msg.payload as { level: 'info' | 'warn' | 'error'; message: string; meta?: Record<string, unknown> };
      this.log(p.level, p.message, p.meta);
    }
  }

  private onExit(code: number | null): void {
    this.ready = false;
    this.child = null;
    if (!this.shuttingDown) this.log('warn', 'Worktree worker exited', { code });
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new WorktreeWorkerCrashedError(`Worktree worker exited (code=${code})`));
    }
    this.pending.clear();
  }

  private async call<T>(method: string, args: unknown, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<T> {
    if (this.shuttingDown) throw new WorktreeWorkerCrashedError('Worktree worker is shutting down');
    await this.ensureStarted();
    return this.invoke<T>(method, args, timeoutMs);
  }

  isWorktreeClean(worktreePath: string): Promise<boolean> {
    return this.call('isWorktreeClean', { worktreePath });
  }

  isWorktreeRegistered(worktreePath: string): Promise<boolean> {
    return this.call('isWorktreeRegistered', { worktreePath });
  }

  isBranchSyncedWithRemote(worktreePath: string): Promise<boolean> {
    return this.call('isBranchSyncedWithRemote', { worktreePath });
  }

  pruneOrphanWorktrees(activeWorktreePaths: Set<string>, projectPaths: Set<string> = new Set()): Promise<void> {
    // Sets don't survive the structured-clone IPC boundary as Sets — pass arrays.
    return this.call(
      'pruneOrphanWorktrees',
      { activeWorktreePaths: [...activeWorktreePaths], projectPaths: [...projectPaths] },
      LONG_CALL_TIMEOUT_MS
    );
  }

  removeSessionWorktree(worktreePath: string): Promise<void> {
    return this.call('removeSessionWorktree', { worktreePath });
  }

  getTaskGitSummary(
    projectPath: string,
    options: { branch?: string | null; worktreePath?: string | null }
  ): Promise<KanbanTaskGitSummary | null> {
    return this.call('getTaskGitSummary', { projectPath, options });
  }

  createSessionWorktree(baseDir: string, sessionName: string, sessionId: string): Promise<string | null> {
    return this.call('createSessionWorktree', { baseDir, sessionName, sessionId }, LONG_CALL_TIMEOUT_MS);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* already dead */
      }
      this.child = null;
    }
    this.ready = false;
  }
}
