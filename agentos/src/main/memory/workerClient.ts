// Main-side client for the memory utilityProcess. Owns the spawn/respawn
// lifecycle and the request/response correlation table. Methods called on
// AgentOSMemoryService land here and are forwarded to ../memory/worker/indexer.ts.
//
// This file is electron-free by design — all main-process dependencies are
// injected. ./workerClientDefaults.ts assembles the singleton with real fork,
// snapshot, log, and broadcast wiring. Tests construct MemoryWorkerClient
// directly with fakes.

import type { AppSettings, SavedProject } from '../../shared/types';
import {
  MemoryIndexerCrashedError,
  type WorkerMessage,
  type WorkerOutbound,
  type WorkerReady,
  type WorkerRequest,
} from './worker/ipc';
import type { RuntimeThread } from './runtime';

// Minimal projection of Electron's UtilityProcess. Tests substitute a fake
// without dragging Electron into the test runner.
export interface WorkerChild {
  postMessage(msg: WorkerOutbound | WorkerRequest): void;
  on(event: 'message', listener: (msg: WorkerMessage) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  once(event: 'exit', listener: (code: number | null) => void): void;
  off(event: 'message', listener: (msg: WorkerMessage) => void): void;
  kill(): void;
}

export type WorkerForkFn = (entryPath: string) => WorkerChild;
export type WorkerLogFn = (
  level: 'debug' | 'info' | 'warn' | 'error',
  subsystem: string,
  msg: string,
  meta?: Record<string, unknown>
) => void;
export type WorkerBroadcastFn = (channel: string, payload: unknown) => void;
export type WorkerSnapshotFn = () => {
  settings: AppSettings;
  projects: SavedProject[];
  threads: RuntimeThread[];
};
export type WorkerSubscribeSettingsFn = (cb: (s: AppSettings) => void) => () => void;

export interface MemoryWorkerClientOpts {
  entryPath: string;
  forkFn: WorkerForkFn;
  subscribeSettings: WorkerSubscribeSettingsFn;
  snapshot: WorkerSnapshotFn;
  log: WorkerLogFn;
  broadcast: WorkerBroadcastFn;
  // Per-call timeout. Pending requests reject with MemoryIndexerCrashedError
  // after this many ms with no response. Guards against worker hangs leaking
  // entries in the pending Map.
  callTimeoutMs?: number;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

let counter = 0;
function nextId(): string {
  counter = (counter + 1) >>> 0;
  return `r${Date.now().toString(36)}_${counter.toString(36)}`;
}

export class MemoryWorkerClient {
  private child: WorkerChild | null = null;
  private ready = false;
  private readyProbe: WorkerReady['probe'] | null = null;
  private startingPromise: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private respawnAttempts = 0;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsUnsub: (() => void) | null = null;
  private shuttingDown = false;
  private homeDir: string | null = null;
  // Last-known projects/threads snapshot pushed to the worker. Skip re-pushing
  // identical payloads on every call() — see snapshotEqual.
  private lastProjectsPushed: SavedProject[] | null = null;
  private lastThreadsPushed: RuntimeThread[] | null = null;
  private entryPath: string;
  private forkFn: WorkerForkFn;
  private subscribeSettingsFn: WorkerSubscribeSettingsFn;
  private snapshotFn: WorkerSnapshotFn;
  private logFn: WorkerLogFn;
  private broadcastFn: WorkerBroadcastFn;
  private callTimeoutMs: number;

  constructor(opts: MemoryWorkerClientOpts) {
    this.entryPath = opts.entryPath;
    this.forkFn = opts.forkFn;
    this.subscribeSettingsFn = opts.subscribeSettings;
    this.snapshotFn = opts.snapshot;
    this.logFn = opts.log;
    this.broadcastFn = opts.broadcast;
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  async ensureStarted(homeDir: string): Promise<void> {
    this.homeDir = homeDir;
    if (this.ready) return;
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = this.spawn(homeDir).finally(() => {
      this.startingPromise = null;
    });
    return this.startingPromise;
  }

  getReadyProbe(): WorkerReady['probe'] | null {
    return this.readyProbe;
  }

  async call<T = unknown>(method: string, args: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
    if (!this.homeDir) throw new Error('Memory worker not configured — call ensureStarted() first.');
    if (this.shuttingDown) throw new MemoryIndexerCrashedError('Memory worker is shutting down');
    if (!this.ready) await this.ensureStarted(this.homeDir);
    // Push fresh projects/threads snapshots only if they changed since the last
    // push — saves the per-call serialization cost for repeated operations
    // (e.g. saveChunk during chat streaming) when state is stable. Settings
    // changes are pushed via the settingsEvents subscription.
    const snap = this.snapshotFn();
    if (!arraysShallowEqualById(snap.projects, this.lastProjectsPushed)) {
      this.postEvent('runtime:projects', snap.projects);
      this.lastProjectsPushed = snap.projects;
    }
    if (!arraysShallowEqualById(snap.threads, this.lastThreadsPushed)) {
      this.postEvent('runtime:threads', snap.threads);
      this.lastThreadsPushed = snap.threads;
    }
    return this.invoke<T>(method, args, opts.timeoutMs);
  }

  private invoke<T>(method: string, args: unknown, timeoutMs?: number): Promise<T> {
    const id = nextId();
    const req: WorkerRequest = { kind: 'request', id, method, args };
    const effectiveTimeout = timeoutMs ?? this.callTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer =
        effectiveTimeout > 0
          ? setTimeout(() => {
              const entry = this.pending.get(id);
              if (!entry) return;
              this.pending.delete(id);
              reject(
                new MemoryIndexerCrashedError(
                  `Memory indexer call timed out after ${effectiveTimeout}ms (method=${method})`
                )
              );
            }, effectiveTimeout)
          : null;
      timer?.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.child!.postMessage(req);
      } catch (err) {
        this.cancelPending(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private cancelPending(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(id);
  }

  private postEvent(channel: string, payload: unknown): void {
    if (!this.child) return;
    try {
      this.child.postMessage({ kind: 'event', channel, payload } satisfies WorkerOutbound);
    } catch {
      /* worker dead — respawn handler will retry pending work */
    }
  }

  private async spawn(homeDir: string): Promise<void> {
    const child = this.forkFn(this.entryPath);
    this.child = child;
    this.ready = false;
    this.readyProbe = null;
    // Per-spawn snapshot tracking — a fresh worker needs a full push the first
    // time call() runs.
    this.lastProjectsPushed = null;
    this.lastThreadsPushed = null;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onReady = (msg: WorkerMessage): void => {
        if (!msg || typeof msg !== 'object') return;
        if ('kind' in msg && (msg as { kind: string }).kind === 'ready') {
          const ready = msg as unknown as WorkerReady;
          this.readyProbe = ready.probe;
          if (ready.probe.errors.length > 0) {
            this.logFn('warn', 'memory', 'Memory indexer native probe warnings', {
              errors: ready.probe.errors,
            });
          }
          child.off('message', onReady);
          resolve();
        }
      };
      child.on('message', onReady);
      child.once('exit', (code) => {
        reject(new MemoryIndexerCrashedError(`Memory indexer exited before ready (code=${code})`));
      });
    });

    child.on('message', (msg: WorkerMessage) => this.onMessage(msg));
    child.on('exit', (code) => this.onExit(code));

    await readyPromise;

    // Subscribe to settings BEFORE sending __init__. Any settings change that
    // fires during the worker's __init__ processing window will arrive as a
    // runtime:settings event AFTER the __init__ message — Node preserves
    // postMessage order — so the worker installs its runtime with the snapshot
    // value then applies the most-recent change on top.
    this.subscribeSettings();

    // Capture the snapshot here, AFTER readyPromise has yielded the event loop.
    // bootstrap/services.ts calls configure() before threadManager.loadFromStore();
    // capturing inside ensureStarted's microtask path would race that load. By
    // the time readyPromise resolves (worker fork + native init), the threads
    // store has been populated synchronously.
    const snap = this.snapshotFn();
    // __init__ runs sync initDbDir + creates the worker runtime — fast — but
    // give it a generous timeout in case the project DB pre-warm (if added in
    // the future) gets slow. 0 = no timeout would defeat hang detection.
    await this.invoke(
      '__init__',
      {
        homeDir,
        settings: snap.settings,
        projects: snap.projects,
        threads: snap.threads,
      },
      5 * 60_000
    );
    this.lastProjectsPushed = snap.projects;
    this.lastThreadsPushed = snap.threads;

    // Warmup every spawn — including respawns — so the worker's
    // MemorySyncCoordinator restarts its hourly maintenance interval and
    // schedules initial project syncs. Failure here is non-fatal (warmup is
    // best-effort): log and continue so the worker still accepts user calls.
    try {
      // Warmup awaits Promise.all over projects (each just mkdir + schedule
      // background sync), so it's fast. Use the same generous timeout for
      // safety on cold starts.
      await this.invoke('warmup', null, 5 * 60_000);
    } catch (err) {
      this.logFn('warn', 'memory', 'Memory indexer warmup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.ready = true;
    this.respawnAttempts = 0;
  }

  private subscribeSettings(): void {
    if (this.settingsUnsub) return;
    this.settingsUnsub = this.subscribeSettingsFn((updated) => {
      this.postEvent('runtime:settings', updated);
    });
  }

  private onMessage(msg: WorkerMessage): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'response') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(msg.error.message));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (msg.kind === 'event') {
      this.handleEvent(msg.channel, msg.payload);
    }
  }

  private handleEvent(channel: string, payload: unknown): void {
    if (channel === 'runtime:log') {
      const p = payload as {
        level: 'debug' | 'info' | 'warn' | 'error';
        subsystem: string;
        msg: string;
        meta?: Record<string, unknown>;
      };
      this.logFn(p.level, p.subsystem, p.msg, p.meta);
      return;
    }
    // Anything else is a renderer broadcast (MEMORY_INDEX_STATUS and friends).
    this.broadcastFn(channel, payload);
  }

  private onExit(code: number | null): void {
    if (this.shuttingDown) return;
    this.ready = false;
    this.child = null;
    this.logFn('warn', 'memory', 'Memory indexer exited', { code });
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new MemoryIndexerCrashedError(`Memory indexer exited (code=${code})`));
      this.pending.delete(id);
    }
    this.scheduleRespawn();
  }

  private scheduleRespawn(): void {
    if (this.respawnTimer || this.shuttingDown || !this.homeDir) return;
    // Skip if a spawn is already in flight — a concurrent call() may have
    // triggered ensureStarted while we were arming the timer. Without this
    // guard the timer's spawn() would run alongside the call-driven spawn(),
    // producing two utilityProcesses contending for the same WAL handles.
    if (this.startingPromise || this.child) return;
    this.respawnAttempts += 1;
    // Exponential backoff capped at 30s. First retry at 1s.
    const delay = Math.min(1000 * Math.pow(2, this.respawnAttempts - 1), 30_000);
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      if (this.startingPromise || this.child || this.shuttingDown) return;
      this.startingPromise = this.spawn(this.homeDir!)
        .catch((err) => {
          this.logFn('error', 'memory', 'Memory indexer respawn failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          this.scheduleRespawn();
        })
        .finally(() => {
          this.startingPromise = null;
        });
    }, delay);
    this.respawnTimer.unref?.();
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    this.shuttingDown = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    // If the worker is mid-spawn, wait for it to reach ready before issuing
    // __shutdown__ — otherwise we'd skip the graceful drain (flushPending +
    // closeAllDbs in the worker) and risk leaving the WAL dirty.
    if (this.startingPromise) {
      try {
        await Promise.race([
          this.startingPromise,
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
        ]);
      } catch {
        /* spawn failed — fall through */
      }
    }
    if (!this.child) return;
    if (!this.ready) {
      // Worker forked but never reached ready (probe crash, native dlopen failure).
      // No safe way to drain — best we can do is kill.
      try {
        this.child.kill();
      } catch {
        /* worker may already be dead */
      }
      this.child = null;
      return;
    }
    try {
      await Promise.race([
        this.invoke('__shutdown__', null),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Memory indexer shutdown timed out')), timeoutMs).unref?.()
        ),
      ]);
    } catch {
      /* fall through to kill */
    }
    try {
      this.child.kill();
    } catch {
      /* worker may already be dead */
    }
    this.child = null;
  }
}

function arraysShallowEqualById<T extends { id: string }>(a: readonly T[] | null, b: readonly T[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}
