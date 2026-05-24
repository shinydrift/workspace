import * as threadStore from '../threads/threadStore';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { eventLogger } from '../utils/eventLog';
import { loadProjectConfig } from '../config/projectConfig';
import { broadcastRename } from './broadcaster';
import { internalBus } from '../events';
import type { ThreadIdleEvent } from '../events';
import { AutopilotService } from '../autopilot/service';
import { AutopilotStateService } from './AutopilotStateService';
import { ThreadReadService } from './ThreadReadService';
import { ThreadStateService } from './ThreadStateService';
import { integrationContextManager } from '../integrations/IntegrationContextManager';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { ThreadLifecycle } from './ThreadLifecycle';
import { TurnExecutor } from './turnExecution';
import { ThreadOutputManager } from './threadOutput';
import { ThreadInputQueue, type QueueSource } from './ThreadInputQueue';
import { ThreadInputService } from './ThreadInputService';
import { TurnWaiterManager } from './TurnWaiterManager';
import { ContainerManager } from './ContainerManager';
import { councilService } from '../council/service';
import * as kanbanDb from '../kanban/db';
import { EmbeddedChildThreadRunner } from './EmbeddedChildThreadRunner';
import { CouncilChildThreadService } from './CouncilChildThreadService';
import { StageWorkerService } from './StageWorkerService';
import { SessionChunkManager } from './SessionChunkManager';
import { CouncilSynthesisManager } from './CouncilSynthesisManager';
import type { Disposable } from '../lifecycle';

import type { CouncilMember, CouncilOutcomeRecord } from '../../shared/types/council';
import type { ClaudeEffort, CodexReasoning, Provider } from '../../shared/types/provider';
import type {
  Thread,
  ThreadLogEntry,
  ThreadInjectionStatus,
  ContainerSummary,
  ProjectConfigLookup,
  CreateThreadRequest,
  Message,
  PersonalitySettings,
} from '../../shared/types';

class ThreadManager implements Disposable {
  private readonly store = new ThreadRuntimeStore();
  private readonly output = new ThreadOutputManager();
  private readonly inputQueue = new ThreadInputQueue();
  private readonly waiterManager = new TurnWaiterManager();
  private readonly containers = new ContainerManager();
  private readonly stateService: ThreadStateService;
  private readonly executor: TurnExecutor;
  // Public so named module exports (threadLifecycle, threadReads, threadAutopilotState) can
  // reference them directly, letting consumers import only the sub-service they need.
  readonly lifecycle: ThreadLifecycle;
  private readonly autopilot: AutopilotService;
  readonly autopilotState: AutopilotStateService;
  readonly reads: ThreadReadService;
  private readonly chunkManager: SessionChunkManager;
  private readonly councilManager: CouncilSynthesisManager;
  private readonly runner: EmbeddedChildThreadRunner;
  private readonly councilChildService: CouncilChildThreadService;
  private readonly stageWorkerService: StageWorkerService;
  private readonly inputService: ThreadInputService;
  private readonly onThreadIdleResolveStop = ({ threadId }: ThreadIdleEvent): void =>
    this.chunkManager.handleThreadIdle(threadId);

  constructor() {
    // All callbacks use closures — references resolve at call-time, not construction-time.
    this.stateService = new ThreadStateService(this.store, (threadId) => this.inputQueue.queueDepth(threadId));

    this.reads = new ThreadReadService(this.store, this.output, this.inputQueue);

    this.autopilotState = new AutopilotStateService(
      this.stateService,
      (threadId) => this.output.listMessages(threadId),
      (threadId) => this.reads.getThread(threadId)
    );

    this.autopilot = new AutopilotService({
      getThread: (threadId) => threadStore.getThread(threadId) ?? undefined,
      getMessages: (threadId) => this.output.listMessages(threadId),
      hasPendingCouncilSubmission: (threadId) => councilService.hasPendingRunForThread(threadId),
      hasActiveStageWorker: (threadId) => {
        const thread = threadStore.getThread(threadId);
        if (!thread?.projectId) return false;
        return kanbanDb.hasActiveStageWorker(thread.projectId, threadId);
      },
      isThreadTaskTerminal: (threadId) => {
        const thread = threadStore.getThread(threadId);
        if (!thread?.projectId || !thread.taskId) return false;
        const task = kanbanDb.getTask(thread.projectId, thread.taskId);
        return task != null && kanbanDb.isTerminalStatus(task.status);
      },
      enqueueAutopilot: (threadId, input) => {
        // If new input arrived while the autopilot planner was running, the continuation
        // is stale — drop it rather than producing a spurious extra Slack response.
        if (this.inputQueue.queueDepth(threadId) > 0) {
          eventLogger.info('autopilot', 'Skipped enqueue: thread has pending input', { threadId });
          return;
        }
        this.sendInput(threadId, `${input.trim()}\n`, 'autopilot').catch((error: unknown) => {
          this.autopilotState.setState(threadId, {
            autopilotState: 'blocked',
            autopilotLastReason: getErrorMessage(error),
          });
        });
      },
      appendAutopilotDecision: (threadId, action, reason) => {
        this.output.appendMessage(
          threadId,
          'user',
          JSON.stringify({ action, reason }),
          undefined,
          'autopilot-decision'
        );
      },
      setThreadAutopilotState: (threadId, patch) => this.autopilotState.setState(threadId, patch),
    });

    // Break the construction-order dependency: wire the post-turn autopilot hook now that
    // both services exist. AutopilotStateService.setAutopilot calls this when re-enabling.
    this.autopilotState.setAfterTurnHook((threadId, source) => this.autopilot.maybeRunAfterTurn(threadId, source));

    this.executor = new TurnExecutor({
      store: this.store,
      turnWaiterManager: this.waiterManager,
      inputQueue: this.inputQueue,
      output: this.output,
      autopilot: this.autopilot,
      autopilotState: this.autopilotState,
      containers: this.containers,
      stateService: this.stateService,
      callbacks: {
        startThread: (id) => this.lifecycle.startThread(id),
        renameThread: (id, name) => {
          this.renameThread(id, name);
        },
        sendInput: (id, input, source) => this.sendInput(id, input, source),
        stopThread: async (id, opts) => {
          await this.chunkManager.saveBeforeStop(id);
          // consumeStopAborted is set synchronously in clearPending when new input
          // arrives — checked here instead of queue depth to avoid a microtask race
          // where the queue hasn't been populated yet when this resumes.
          if (this.chunkManager.consumeStopAborted(id)) {
            eventLogger.info('thread', 'New input during pre-stop save, aborting stop', { threadId: id });
            return;
          }
          return this.lifecycle.stopThread(id, opts);
        },
      },
    });

    this.lifecycle = new ThreadLifecycle(
      this.store,
      this.executor,
      this.output,
      this.inputQueue,
      this.waiterManager,
      this.containers,
      (threadId, depth) => this.broadcastQueueDepth(threadId, depth),
      this.stateService
    );

    this.chunkManager = new SessionChunkManager(
      (threadId) => this.store.ptys.has(threadId),
      (threadId) => this.output.listMessages(threadId),
      (threadId, input, source) => this.sendInput(threadId, input, source)
    );

    this.councilManager = new CouncilSynthesisManager(
      (threadId) =>
        this.inputQueue.dropPendingItemsBySource(threadId, 'autopilot', (id, depth) =>
          this.broadcastQueueDepth(id, depth)
        ),
      (threadId) => this.store.ptys.has(threadId),
      (threadId) => this.lifecycle.startThread(threadId),
      (threadId, input, source) => this.sendInput(threadId, input, source)
    );

    this.inputService = new ThreadInputService(
      this.inputQueue,
      this.executor,
      this.lifecycle,
      this.store,
      this.output,
      (id, depth) => this.broadcastQueueDepth(id, depth),
      (id) => this.chunkManager.clearPending(id)
    );

    this.runner = new EmbeddedChildThreadRunner(this.store, this.output);
    this.councilChildService = new CouncilChildThreadService(this.store, this.runner, this.output);
    this.stageWorkerService = new StageWorkerService(this.store, this.runner, this.output, (parentThreadId, input) =>
      this.sendInput(parentThreadId, input, 'automation')
    );

    internalBus.on('thread:idle', this.onThreadIdleResolveStop);
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  loadFromStore(): void {
    this.lifecycle.loadFromStore();
  }

  async loadFromStoreLate(): Promise<void> {
    await this.lifecycle.loadFromStoreLate();
  }

  // ---------------------------------------------------------------------------
  // Thread CRUD + lifecycle (delegate to ThreadLifecycle)
  // ---------------------------------------------------------------------------

  async createThread(req: CreateThreadRequest): Promise<Thread> {
    return this.lifecycle.createThread(req);
  }

  async getProjectConfig(projectPath: string): Promise<ProjectConfigLookup> {
    const result = await loadProjectConfig(projectPath);
    return { config: result.config, exists: result.exists, path: result.path, warnings: result.warnings };
  }

  async startThread(
    threadId: string,
    options?: { forceClaudePlainText?: boolean; fallbackTried?: boolean }
  ): Promise<void> {
    return this.lifecycle.startThread(threadId, options);
  }

  async stopThread(threadId: string): Promise<void> {
    return this.lifecycle.stopThread(threadId);
  }

  deleteThread(threadId: string): void {
    this.lifecycle.deleteThread(threadId);
  }

  archiveThread(threadId: string): void {
    this.lifecycle.archiveThread(threadId);
  }

  setSlackContext(threadId: string, ctx: { channelId: string; threadTs: string | null }): void {
    integrationContextManager.setSlackContext(threadId, ctx);
  }

  renameThread(threadId: string, name: string): Thread {
    threadStore.updateThread(threadId, { name });
    broadcastRename({ threadId, name });
    return this.getThread(threadId)!;
  }

  // ---------------------------------------------------------------------------
  // Thread reads (delegated to ThreadReadService)
  // ---------------------------------------------------------------------------

  getThreads(): Thread[] {
    return this.reads.getThreads();
  }

  getThread(threadId: string): Thread | null {
    return this.reads.getThread(threadId);
  }

  getLogHistory(threadId: string): ThreadLogEntry[] {
    return this.reads.getLogHistory(threadId);
  }

  getPendingOutput(threadId: string): string {
    return this.reads.getPendingOutput(threadId);
  }

  getInjectionStatus(threadId: string): ThreadInjectionStatus {
    return this.reads.getInjectionStatus(threadId);
  }

  listMessages(threadId: string, opts?: { sinceMs?: number; role?: string }): Message[] {
    return this.reads.listMessages(threadId, opts);
  }

  clearMessages(threadId: string): void {
    this.output.clearMessages(threadId);
  }

  appendAutomationMessage(threadId: string, content: string): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    const thread = threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    threadStore.updateThread(threadId, { lastActiveAt: Date.now() });
    this.output.appendNormalizedMessageWithSource(threadId, 'user', 'automation', trimmed, `${trimmed}\n`);
  }

  skipPendingAutopilotAndAppendAutomationMessage(threadId: string, content: string): void {
    this.inputQueue.dropPendingItemsBySource(threadId, 'autopilot', (id, depth) => this.broadcastQueueDepth(id, depth));
    this.appendAutomationMessage(threadId, content);
  }

  triggerAutopilotForCouncilDone(threadId: string, runId: string): void {
    this.councilManager.maybeTriggerSynthesis(threadId, runId);
  }

  resizeTerminal(threadId: string, cols: number, rows: number): void {
    this.store.ptys.get(threadId)?.resize(cols, rows);
  }

  /**
   * Spawn a council sub-thread inside the parent thread's existing container.
   *
   * Bypasses ThreadLifecycle entirely: no worktree, no `docker run`, no
   * TurnExecutor — just a real Thread record (so the child is queryable and
   * persistable) and a single PtyProcess wrapping `docker exec` into the
   * parent's container. Streams output through the council outcome parser
   * and resolves once a sentinel block is parsed (or the PTY exits).
   *
   * The child Thread is filtered from `getThreads()` via `parentThreadId`,
   * so it does not appear at the top level of the thread list.
   */
  async spawnCouncilChildThread(opts: {
    parentThreadId: string;
    runId: string;
    member: CouncilMember;
    memberLabel: string;
    prompt: string;
    onOutcome: (outcome: CouncilOutcomeRecord) => void;
  }): Promise<{ childThreadId: string }> {
    return this.councilChildService.spawn(opts);
  }

  /**
   * Spawn a kanban stage worker inside the task's main thread container.
   *
   * Mirrors {@link spawnCouncilChildThread}: no worktree, no `docker run`,
   * just a Thread record + a single PtyProcess wrapping `docker exec` into
   * the main thread's container. The worker inherits the main thread's
   * provider, model, mounts, and worktree.
   *
   * The worker signals completion by calling the `report_stage_result` MCP
   * tool (which injects a message into the main thread). The worker exits
   * naturally after receiving the tool result.
   */
  async spawnStageChildThread(opts: {
    parentThreadId: string;
    taskId: string;
    stage: string;
    prompt: string;
    provider?: Provider;
    model?: string;
    effort?: ClaudeEffort;
    reasoning?: CodexReasoning;
  }): Promise<{ childThreadId: string }> {
    return this.stageWorkerService.spawn(opts);
  }

  getActiveThreadIds(): string[] {
    return [...this.store.activeTurnProcs.keys()];
  }

  async dispose(): Promise<void> {
    // Remove idle listener before killing — saveBeforeStop inside stopThread handles
    // pre-stop chunk saving; idle-triggered saves racing shutdown would be redundant.
    internalBus.off('thread:idle', this.onThreadIdleResolveStop);
    await this.killAll();
  }

  async killAll(): Promise<void> {
    const ids = [...this.store.ptys.keys()];
    await Promise.allSettled(
      ids.map((id) => {
        let handle: ReturnType<typeof setTimeout>;
        return Promise.race([
          this.lifecycle.stopThread(id),
          new Promise<never>((_, reject) => {
            handle = setTimeout(() => reject(new Error('stop timeout')), 5_000);
          }),
        ])
          .finally(() => clearTimeout(handle))
          .catch((err: unknown) => {
            eventLogger.warn('thread', 'kill all: stop thread failed', { threadId: id, error: String(err) });
          });
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  async sendInput(
    threadId: string,
    input: string,
    source: QueueSource = 'user',
    options?: { timeoutMs?: number; systemPromptSuffix?: string }
  ): Promise<void> {
    return this.inputService.sendInput(threadId, input, source, options);
  }

  // ---------------------------------------------------------------------------
  // Autopilot
  // ---------------------------------------------------------------------------

  setThreadProviderModel(
    threadId: string,
    provider: string,
    model: string | undefined,
    effort?: ClaudeEffort | null,
    reasoning?: CodexReasoning | null
  ): Thread {
    const thread = threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    threadStore.updateThread(threadId, {
      provider: provider as Thread['provider'],
      model: model ?? null,
      effort: effort ?? null,
      reasoning: reasoning ?? null,
    });
    return this.reads.getThread(threadId)!;
  }

  setThreadAutopilot(threadId: string, enabled: boolean, options?: { triggerAfterTurn?: boolean }): Thread {
    return this.autopilotState.setAutopilot(threadId, enabled, options);
  }

  setPersonalityOverride(threadId: string, override: Partial<PersonalitySettings> | null): void {
    if (override === null) {
      this.store.personalityOverrides.delete(threadId);
    } else {
      this.store.personalityOverrides.set(threadId, override);
    }
  }

  // ---------------------------------------------------------------------------
  // Containers
  // ---------------------------------------------------------------------------

  async pruneContainers(opts?: { force?: boolean }): Promise<{ pruned: string[]; errors: string[] }> {
    return this.containers.prune(opts);
  }

  async removeContainer(containerName: string): Promise<void> {
    await this.containers.remove(containerName);
  }

  async listContainerSummaries(): Promise<ContainerSummary[]> {
    return this.containers.listSummaries();
  }

  setKanbanWatchdog(cb: (taskId: string, projectId: string, reason: string) => void): void {
    this.autopilotState.setKanbanWatchdog(cb);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private broadcastQueueDepth(threadId: string, depth: number): void {
    if (threadStore.getThread(threadId)) {
      threadStore.updateThread(threadId, { queueDepth: depth });
    }
    this.stateService.broadcastCurrentStatus(threadId);
  }
}

export const threadManager = new ThreadManager();

// Named sub-service exports — import these directly to avoid depending on the full facade
export const threadLifecycle = threadManager.lifecycle;
export const threadReads = threadManager.reads;
export const threadAutopilotState = threadManager.autopilotState;
