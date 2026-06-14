import type { Thread, CreateThreadRequest } from '../../shared/types';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { TurnExecutor } from './turnExecution';
import type { ThreadOutputManager } from './threadOutput';
import type { ThreadInputQueue } from './ThreadInputQueue';
import type { TurnWaiterManager } from './TurnWaiterManager';
import type { ContainerManager } from './ContainerManager';
import type { ThreadStateService } from './ThreadStateService';
import { ThreadLoader } from './ThreadLoader';
import { ThreadFactory } from './ThreadFactory';
import { ThreadRuntime } from './ThreadRuntime';
import { getContainerStatus } from '../utils/docker';
import { eventLogger } from '../utils/eventLog';

/**
 * Composition root for thread lifecycle. Constructs and wires ThreadLoader, ThreadFactory,
 * and ThreadRuntime, then delegates each public method to the appropriate class.
 * ThreadManager's public API is unchanged.
 */
export class ThreadLifecycle {
  private readonly loader: ThreadLoader;
  private readonly factory: ThreadFactory;
  private readonly runtime: ThreadRuntime;
  private readonly store: ThreadRuntimeStore;

  constructor(
    store: ThreadRuntimeStore,
    executor: TurnExecutor,
    output: ThreadOutputManager,
    inputQueue: ThreadInputQueue,
    waiterManager: TurnWaiterManager,
    containers: ContainerManager,
    _onBroadcastQueueDepth: (threadId: string, depth: number) => void,
    stateService: ThreadStateService
  ) {
    this.store = store;
    this.loader = new ThreadLoader(output);
    this.runtime = new ThreadRuntime(
      store,
      executor,
      output,
      inputQueue,
      waiterManager,
      containers,
      () => this.loader.sessionsDataDir,
      stateService
    );
    this.factory = new ThreadFactory(
      output,
      () => this.loader.sessionsDataDir,
      (id, reason) => this.runtime.teardownThreadRuntime(id, reason),
      stateService
    );
  }

  loadFromStore(): void {
    this.loader.loadFromStore();
  }

  async loadFromStoreLate(): Promise<void> {
    return this.loader.loadFromStoreLate();
  }

  async createThread(req: CreateThreadRequest): Promise<Thread> {
    return this.factory.createThread(req);
  }

  async startThread(
    threadId: string,
    options?: { forceClaudePlainText?: boolean; fallbackTried?: boolean }
  ): Promise<void> {
    return this.runtime.startThread(threadId, options);
  }

  async stopThread(threadId: string, opts?: { preserveQueue?: boolean }): Promise<void> {
    return this.runtime.stopThread(threadId, opts);
  }

  // Probe the outer container PTY + docker container status before dispatching input.
  // Catches dead host processes and paused/exited containers (e.g. after macOS sleep,
  // where a 30m idle setTimeout was deferred and the container is in an unknown state).
  // Restarts in-place with preserveQueue so the in-flight input runs against the fresh PTY.
  async ensureHealthy(threadId: string): Promise<void> {
    const proc = this.store.ptys.get(threadId);
    if (!proc) return;

    let reason: string | null = null;
    try {
      process.kill(proc.pid, 0);
    } catch {
      reason = 'pty-process-dead';
    }
    // Host threads have no container; only the PTY liveness check above applies to them.
    // Probing docker would always report 'missing' and trigger a needless restart loop.
    if (!reason && !this.store.launchModes.get(threadId)?.runOnHost) {
      const status = await getContainerStatus(`agentos-session-${threadId}`);
      if (status !== 'running') reason = `container-${status ?? 'missing'}`;
    }
    if (!reason) return;

    eventLogger.warn('thread', 'Restarting thread before dispatch: unhealthy', {
      threadId,
      reason,
      pid: proc.pid,
    });
    await this.stopThread(threadId, { preserveQueue: true });
    await this.startThread(threadId);
  }

  deleteThread(threadId: string): void {
    this.factory.deleteThread(threadId);
  }

  archiveThread(threadId: string): void {
    this.factory.archiveThread(threadId);
  }
}
