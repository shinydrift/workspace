import * as threadStore from '../threads/threadStore';
import { eventLogger } from '../utils/eventLog';
import { emitTurnEnded } from '../events';
import { threadPostsStore } from './threadPostsStore';
import type { ThreadInputQueue, QueueSource } from './ThreadInputQueue';
import type { TurnExecutor } from './turnExecution';
import type { ThreadLifecycle } from './ThreadLifecycle';
import type { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { ThreadOutputManager } from './threadOutput';

export class ThreadInputService {
  constructor(
    private readonly inputQueue: ThreadInputQueue,
    private readonly executor: TurnExecutor,
    private readonly lifecycle: ThreadLifecycle,
    private readonly store: ThreadRuntimeStore,
    private readonly output: ThreadOutputManager,
    private readonly broadcastQueueDepth: (threadId: string, depth: number) => void,
    private readonly clearChunkPending: (threadId: string) => void
  ) {}

  async sendInput(
    threadId: string,
    input: string,
    source: QueueSource = 'user',
    options?: { timeoutMs?: number; systemPromptSuffix?: string }
  ): Promise<void> {
    // Reset the session-chunk trigger so the next idle after this input can save again.
    if (source !== 'skills') this.clearChunkPending(threadId);
    const queueTimeoutMs = options?.timeoutMs ?? 0;
    const dropPolicy =
      queueTimeoutMs > 0 && (source === 'automation' || source === 'autopilot')
        ? ('timeout' as const)
        : ('never' as const);

    const interrupted = source === 'user' ? this.interruptActiveTurnForInput(threadId, input) : null;
    // When a new user message arrives, drop any pending autopilot messages — they are
    // stale continuations for the previous request and would cause spurious extra replies.
    if (source === 'user') {
      this.inputQueue.dropPendingItemsBySource(threadId, 'autopilot', (id, depth) =>
        this.broadcastQueueDepth(id, depth)
      );
    }
    const execInput = interrupted?.execInput ?? input;
    const persistExecInput = interrupted?.persistExecInput ?? true;

    await this.inputQueue.enqueue({
      threadId,
      input,
      source,
      timeoutMs: queueTimeoutMs,
      dropPolicy,
      execute: async (item) => {
        // Wait for any in-flight teardown (stop + container cleanup) to finish before dispatching,
        // so this turn doesn't start/exec against a container that's mid-removal.
        const teardown = this.store.teardownInFlight.get(threadId);
        if (teardown) await teardown;
        const elapsedInQueueMs = Date.now() - item.enqueuedAt;
        const remainingTimeoutMs =
          dropPolicy === 'timeout' ? Math.max(1_000, queueTimeoutMs - elapsedInQueueMs) : undefined;
        if (!this.store.ptys.has(threadId)) {
          if (source === 'user') {
            await this.lifecycle.startThread(threadId);
          } else {
            throw new Error(`Thread ${threadId} is not running`);
          }
        } else if (source === 'user') {
          // Liveness probe before dispatching: catches dead host PTYs and paused/exited
          // containers (e.g. after macOS sleep, where a deferred idle teardown setTimeout
          // hasn't fired yet). Applies to headless and interactive alike — both keep a
          // long-lived container-keeper PTY in store.ptys between turns. On unhealthy,
          // restarts in place with preserveQueue so this item runs against the fresh PTY.
          await this.lifecycle.ensureHealthy(threadId);
        }
        await this.executor.runTurn(
          threadId,
          execInput,
          source,
          remainingTimeoutMs,
          persistExecInput,
          options?.systemPromptSuffix
        );
      },
      onDepthChange: (id, depth) => this.broadcastQueueDepth(id, depth),
    });
  }

  private interruptActiveTurnForInput(
    threadId: string,
    input: string
  ): { execInput: string; persistExecInput: boolean } | null {
    const activeTurn = this.store.activeTurnProcs.get(threadId);
    if (!activeTurn) return null;
    const trimmed = input.replace(/\n$/, '').trim();
    if (!trimmed) return null;

    const thread = threadStore.getThread(threadId);
    const history = [...(thread?.promptHistory ?? []), trimmed].slice(-100);
    threadStore.updateThread(threadId, { promptHistory: history, lastActiveAt: Date.now() });
    this.output.appendNormalizedMessage(threadId, 'user', trimmed, input);
    // Interrupting turns skip persistUserInput (persistExecInput=false below), so append the thread-view
    // prompt post here too — otherwise an interrupting message never appears in the thread view and any
    // optimistic placeholder for it would never reconcile.
    threadPostsStore.append(threadId, 'prompt', 'user', trimmed);
    this.output.clearPendingOutput(threadId);

    activeTurn.proc.kill();
    this.store.activeTurnProcs.delete(threadId);
    emitTurnEnded({ threadId });
    this.store.interruptedThreads.add(threadId);

    // Drop any stale pending user and autopilot messages from the queue — they were
    // superseded by this new message. The claudeSessionId persists through kills so the
    // resumed session already has full context; just pass the new message immediately.
    const droppedUser = this.inputQueue.dropPendingItemsBySource(threadId, 'user', (id, depth) =>
      this.broadcastQueueDepth(id, depth)
    );
    const droppedAutopilot = this.inputQueue.dropPendingItemsBySource(threadId, 'autopilot', (id, depth) =>
      this.broadcastQueueDepth(id, depth)
    );
    eventLogger.info('queue', 'Interrupted active headless turn for new user input', {
      threadId,
      droppedStaleMessages: droppedUser + droppedAutopilot,
    });
    return { execInput: input, persistExecInput: false };
  }
}
