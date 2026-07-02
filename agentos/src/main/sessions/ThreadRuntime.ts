import stripAnsi from 'strip-ansi';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type { Provider, Thread } from '../../shared/types';
import { getEffectiveWorktreeSettings } from '../../shared/effectiveProjectSettings';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import {
  createSessionWorktree,
  removeSessionWorktree,
  isWorktreeClean,
  isWorktreeRegistered,
  isBranchSyncedWithRemote,
} from '../utils/worktree';
import { eventLogger } from '../utils/eventLog';
import { removeContainerRegistryEntriesForThread, upsertContainerRegistryEntry } from '../utils/containerRegistry';
import { removeContainer as removeDockerContainer } from '../utils/dockerCleanup';
import { loadProjectConfigSync } from '../config/projectConfig';
import { prepareThreadStartup } from './threadStartup';
import { waitForContainerRunning } from '../utils/docker';
import { rebuildManagedMcpConfig } from './mcpConfig';
import { broadcastTerminalData } from './broadcaster';
import { emitTurnEnded } from '../events';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { TurnExecutor } from './turnExecution';
import type { ThreadOutputManager } from './threadOutput';
import { filterClaudeCliNoise } from './threadOutput';
import type { ThreadInputQueue } from './ThreadInputQueue';
import type { TurnWaiterManager } from './TurnWaiterManager';
import type { ContainerManager } from './ContainerManager';
import type { ThreadStateService } from './ThreadStateService';

export class ThreadRuntime {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly executor: TurnExecutor,
    private readonly output: ThreadOutputManager,
    private readonly inputQueue: ThreadInputQueue,
    private readonly waiterManager: TurnWaiterManager,
    private readonly containers: ContainerManager,
    private readonly getSessDataDir: () => string,
    private readonly stateService: ThreadStateService
  ) {}

  async startThread(
    threadId: string,
    options?: { forceClaudePlainText?: boolean; fallbackTried?: boolean }
  ): Promise<void> {
    let stored = threadStore.getThread(threadId);
    if (!stored) throw new Error(`Thread ${threadId} not found`);
    if (this.store.ptys.has(threadId)) return;

    // Mark a (re)start in flight for the whole duration below. The exit-handler auto-prune checks
    // this so it can't remove this thread's worktree while a container is coming up — otherwise a
    // stop→start (ensureHealthy) leaves the pending PTY 'exit' event firing mid-startup and deleting
    // the worktree out from under the new container, giving it an empty /workspace. Cleared in the
    // finally once start completes or fails.
    this.store.startInFlight.add(threadId);
    try {
      // Recreate the worktree before (re)starting if its mount source is gone OR git no longer
      // tracks it as a worktree — e.g. the 30-min idle stop auto-pruned the clean+synced worktree
      // (dir + branch removed) while this thread was idle. Without this the container would bind a
      // missing /workspace and the thread would "have no mounted path" on the next message.
      if (stored.usingWorktree && stored.projectPath && !isWorktreeRegistered(stored.workingDirectory)) {
        const recreated = await createSessionWorktree(stored.projectPath, stored.name, threadId);
        if (recreated) {
          threadStore.updateThread(threadId, { workingDirectory: recreated });
          stored = { ...stored, workingDirectory: recreated };
        } else {
          // Recreation failed (transient git state). Fall back to the project path for THIS start
          // only — do NOT persist usingWorktree=false, so the next message retries the worktree
          // instead of stranding the thread on the main repo permanently. Drop usingWorktree in the
          // local snapshot so the exit-handler auto-prune below never acts on the main repo.
          eventLogger.warn('thread', 'Worktree recreate failed; using project path for this start only', {
            threadId,
            workingDirectory: stored.workingDirectory,
          });
          stored = { ...stored, workingDirectory: stored.projectPath, usingWorktree: false };
        }
      }

      await this.launchThread(threadId, stored, options);
    } finally {
      this.store.startInFlight.delete(threadId);
    }
  }

  private async launchThread(
    threadId: string,
    stored: Omit<Thread, 'logBuffer'>,
    options?: { forceClaudePlainText?: boolean; fallbackTried?: boolean }
  ): Promise<void> {
    const store = getStore();
    // claude-interactive shares container, binary, auth, and config dir with claude —
    // only the turn-execution path differs (dispatched in turnExecution.ts). Normalize
    // here so threadStartup/Runtime use the headless provisioning path unchanged.
    const rawProvider = stored.provider ?? 'claude';
    const provider: Provider = rawProvider === 'claude-interactive' ? 'claude' : rawProvider;
    const settings = store.get('settings');

    this.output.initLogBuffer(threadId);

    this.stateService.setBuilding(threadId, provider);

    let prepareResult: Awaited<ReturnType<typeof prepareThreadStartup>>;
    try {
      prepareResult = await prepareThreadStartup(threadId, stored, provider, settings, options, {
        containers: this.containers,
        sessionsDataDir: this.getSessDataDir(),
        output: this.output,
      });
    } catch (err) {
      eventLogger.error('thread', 'prepareThreadStartup failed', {
        threadId,
        provider,
        error: getErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.stateService.setError(threadId, provider);
      throw err;
    }
    const { proc, launchMode, imageName, configHash, containerName, startConfig } = prepareResult;

    this.store.ptys.set(threadId, proc);
    this.store.launchModes.set(threadId, launchMode);
    rebuildManagedMcpConfig(
      this.store.launchModes,
      Object.fromEntries(threadStore.getAllThreads().map((t) => [t.id, t])),
      this.getSessDataDir()
    );

    this.output.openLogStream(threadId);

    this.stateService.setRunning(threadId, provider, proc.pid);
    eventLogger.info('thread', `Thread started: ${stored.name}`, {
      threadId,
      provider,
      pid: proc.pid,
      imageName,
      hasBoot: startConfig.injectionPayload.hasBoot,
      hasMemory: startConfig.injectionPayload.hasMemory,
      projectConfigPath: startConfig.projectConfigResult.path,
      projectConfigExists: startConfig.projectConfigResult.exists,
      memoryEnabled: startConfig.memoryEnabled,
      bootEnabled: startConfig.bootEnabled,
    });

    await upsertContainerRegistryEntry({
      containerName,
      threadId,
      createdAtMs: Date.now(),
      lastUsedAtMs: Date.now(),
      image: imageName,
      configHash,
    }).catch((err) => {
      eventLogger.warn('thread', 'failed to touch container registry', { error: String(err) });
    });

    proc.on('data', (data: string) => {
      const filtered = filterClaudeCliNoise(data);
      this.containers.touchFromActivity(threadId).catch((err) => {
        eventLogger.warn('thread', 'failed to touch container registry', { error: String(err) });
      });
      if (!filtered) return;
      this.waiterManager.observe(threadId, filtered);
      this.output.appendLog(threadId, filtered);
      broadcastTerminalData({ threadId, data: filtered });
    });

    proc.on('exit', this.createPtyExitHandler(threadId, stored));

    if (launchMode.headless) {
      this.store.injectionStatuses.set(threadId, {
        hasBoot: startConfig.injectionPayload.hasBoot,
        hasMemory: startConfig.injectionPayload.hasMemory,
        injected: true,
      });
      // Host threads have no container — the keep-alive PTY is already running, so waiting
      // for a container that never gets created would always time out after 30s.
      if (!launchMode.runOnHost) await waitForContainerRunning(containerName);
    } else {
      this.store.injectionStatuses.set(threadId, {
        hasBoot: startConfig.injectionPayload.hasBoot,
        hasMemory: startConfig.injectionPayload.hasMemory,
        injected: false,
      });
      this.executor.scheduleStartupInjection(threadId, proc, provider, startConfig.injectionPayload.payload, {
        hasBoot: startConfig.injectionPayload.hasBoot,
        hasMemory: startConfig.injectionPayload.hasMemory,
        warnings: startConfig.injectionPayload.warnings,
      });
    }
  }

  async stopThread(threadId: string, opts?: { preserveQueue?: boolean }): Promise<void> {
    const work = this.runStop(threadId, opts);
    // Publish the in-flight teardown so input dispatch waits for stop + container cleanup to
    // finish before (re)starting — a turn must not race into a container that's being torn down.
    // Best-effort: the guard swallows teardown errors so a waiter never hangs, but it also means a
    // *failed* teardown won't block the next start (callers still get `work` for real error handling).
    const guard: Promise<void> = work.catch((): void => undefined);
    this.store.teardownInFlight.set(threadId, guard);
    void guard.then((): void => {
      if (this.store.teardownInFlight.get(threadId) === guard) {
        this.store.teardownInFlight.delete(threadId);
      }
    });
    return work;
  }

  private async runStop(threadId: string, opts?: { preserveQueue?: boolean }): Promise<void> {
    this.output.flushAssistantMessage(threadId);
    await this.executor.shutdownThreadRuntime(threadId, opts);
    this.stateService.broadcastStopped(threadId);
    eventLogger.info('thread', `Thread stopped: ${threadId}`, { threadId });
  }

  // Called via ThreadLifecycle's teardown callback — not intended for direct use outside that wiring.
  teardownThreadRuntime(threadId: string, reason: string): void {
    this.waiterManager.reject(threadId, new Error(reason));
    this.inputQueue.clearQueue(threadId);
    this.stopThread(threadId).catch((err) => {
      eventLogger.warn('thread', 'stop thread failed', { error: String(err) });
    });
    removeDockerContainer(`agentos-session-${threadId}`).catch((err) => {
      eventLogger.warn('thread', 'failed to remove docker container', { error: String(err) });
    });
    removeContainerRegistryEntriesForThread(threadId).catch((err) => {
      eventLogger.warn('thread', 'failed to remove registry entries', { error: String(err) });
    });
    this.output.cleanupThread(threadId);
    if (this.store.activeTurnProcs.has(threadId)) {
      emitTurnEnded({ threadId });
    }
    this.store.clearThread(threadId);
    this.containers.clearThread(threadId);
  }

  private createPtyExitHandler(
    threadId: string,
    stored: Omit<Thread, 'logBuffer'>
  ): (exitCode: number | undefined) => void {
    return (exitCode: number | undefined) => {
      this.waiterManager.reject(threadId, new Error('Thread exited while waiting for command completion'));
      this.store.ptys.delete(threadId);
      const launchMode = this.store.launchModes.get(threadId);
      this.store.launchModes.delete(threadId);
      const canFallback = this.shouldFallbackToPlainClaude(threadId, exitCode, launchMode);
      if (canFallback) {
        this.output.clearPendingOutput(threadId);
        this.output.closeLogStream(threadId);
        eventLogger.warn('thread', 'Claude stream-json unsupported, retrying in plain output mode', { threadId });
        this.startThread(threadId, { forceClaudePlainText: true, fallbackTried: true }).catch((error: unknown) => {
          const message = getErrorMessage(error);
          this.stateService.setError(threadId);
          eventLogger.error('thread', 'Thread restart after stream-json fallback failed', { threadId, error: message });
        });
        return;
      }
      this.output.flushAssistantMessage(threadId);
      this.output.closeLogStream(threadId);
      const preExitStatus = threadStore.getThread(threadId)?.status;
      this.stateService.setExited(threadId, exitCode);
      const finalStatus = threadStore.getThread(threadId)?.status ?? 'stopped';
      eventLogger.info('thread', `Thread exited: ${stored.name}`, { threadId, exitCode, status: finalStatus });
      rebuildManagedMcpConfig(
        this.store.launchModes,
        Object.fromEntries(threadStore.getAllThreads().map((t) => [t.id, t])),
        this.getSessDataDir()
      );
      // Only touch the container registry when the exit reflects real activity.
      // Idle-timeout or user-initiated shutdowns set status to 'stopped' before
      // killing the PTY; touching here would reset lastUsedAtMs to the kill time
      // and make the pruner's idle clock restart from shutdown instead of last use.
      if (preExitStatus !== 'stopped') {
        this.containers.touchFromActivity(threadId, true).catch((err) => {
          eventLogger.warn('thread', 'failed to touch container registry', { error: String(err) });
        });
      }

      // Auto-prune clean worktrees so they don't accumulate; recreated on next start.
      // Skip if the thread already has a new PTY — it restarted (a turn raced the teardown) and is
      // using its worktree again, so pruning here would kill the fresh container and remove its mount.
      // Also skip while a (re)start is in flight: stopThread's proc.kill() fires this exit event
      // without awaiting it, so it can land mid-startup (after the recreation guard checked, before
      // the new PTY is registered) and delete the worktree out from under the container coming up.
      const settings = getStore().get('settings');
      const projectConfig = stored.projectPath ? loadProjectConfigSync(stored.projectPath) : null;
      const pruneOnStop = getEffectiveWorktreeSettings(settings, projectConfig).pruneOnStop;
      if (
        pruneOnStop &&
        !this.store.ptys.has(threadId) &&
        !this.store.startInFlight.has(threadId) &&
        stored.usingWorktree &&
        stored.workingDirectory &&
        isWorktreeClean(stored.workingDirectory) &&
        isBranchSyncedWithRemote(stored.workingDirectory)
      ) {
        removeSessionWorktree(stored.workingDirectory);
        eventLogger.info('thread', `Auto-pruned clean worktree: ${stored.workingDirectory}`, { threadId });
      }
    };
  }

  private shouldFallbackToPlainClaude(
    threadId: string,
    exitCode: number | undefined,
    launchMode: { claudeStreamJson: boolean; fallbackTried: boolean; headless: boolean } | undefined
  ): boolean {
    if (exitCode === 0) return false;
    if (launchMode?.headless) return false;
    if (!launchMode?.claudeStreamJson || launchMode.fallbackTried) return false;
    if (this.executor.getThreadProvider(threadId) !== 'claude') return false;

    const raw = stripAnsi(this.output.getPendingOutput(threadId)).toLowerCase();
    if (!raw) return false;

    const unsupportedFlagSignals = [
      '--output-format',
      'unknown option',
      'invalid option',
      'unexpected argument',
      'unrecognized option',
      'stream-json',
    ];
    return unsupportedFlagSignals.some((signal) => raw.includes(signal));
  }
}
