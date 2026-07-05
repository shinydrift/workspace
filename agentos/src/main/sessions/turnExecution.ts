import { app } from 'electron';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { persistAllSessionIds, generateSlugFromSessionId } from './messagePersistence';
import type { ThreadStateService } from './ThreadStateService';
import { rebuildManagedMcpConfig } from './mcpConfig';
import { stopContainer } from '../utils/docker';
import { removeContainer as removeDockerContainer } from '../utils/dockerCleanup';
import { removeContainerRegistryEntry } from '../utils/containerRegistry';
import { isCliReady } from '../utils/readySignalDetector';
import { eventLogger } from '../utils/eventLog';
import * as threadStore from '../threads/threadStore';
import { threadPostsStore } from './threadPostsStore';
import { PtyProcess } from './PtyProcess';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { execHeadlessTurn, isProviderLimitError, type TurnEndReason } from './headlessRunner';
import { execClaudeInteractiveTurn } from './claudeInteractive/execClaudeInteractiveTurn';
import { claudeInteractiveSessions } from './claudeInteractive/sessionRegistry';
import { emitTurnStarted, emitTurnEnded } from '../events';
import { getStore } from '../store/index';
import { loadProjectConfig } from '../config/projectConfig';
import { getEffectiveProviderOrder } from '../../shared/effectiveProjectSettings';
import type { AutopilotService } from '../autopilot/service';
import type { AutopilotStateService } from './AutopilotStateService';
import type { ContainerManager } from './ContainerManager';
import type { TurnWaiterManager } from './TurnWaiterManager';
import type { ThreadInputQueue, QueueSource } from './ThreadInputQueue';
import type { ThreadOutputManager } from './threadOutput';
import { PROVIDER_LABEL, type Provider, type ProviderEntry, type ThreadInjectionStatus } from '../../shared/types';
export type { TurnExecutionResult } from './headlessRunner';

// Waits for the PTY process to emit its first output (or a ready signal), then
// sends the startup payload (memory + boot context) as the first user message.
// Falls back to a hard timeout of 2.5 s if no output arrives.
function scheduleStartupInjection(params: {
  threadId: string;
  proc: PtyProcess;
  provider: Provider;
  payload: string;
  details: { hasBoot: boolean; hasMemory: boolean; warnings: string[] };
  onSendInput: (threadId: string, input: string, source: 'boot') => Promise<void>;
  onInjected: (threadId: string, status: ThreadInjectionStatus) => void;
  onAppendLog: (threadId: string, msg: string) => void;
}): void {
  const { threadId, proc, provider, payload, details, onSendInput, onInjected, onAppendLog } = params;

  let injected = false;
  let tail = '';
  const hardTimeoutMs = 2500;

  const cleanup = (): void => {
    clearTimeout(hardTimeout);
    proc.off('data', onData);
    proc.off('exit', onExit);
  };

  const markInjected = (reason: 'ready-signal' | 'first-output' | 'timeout'): void => {
    if (injected) return;
    injected = true;
    cleanup();
    onSendInput(threadId, `${payload}\n`, 'boot')
      .then(() => {
        const warnSuffix = details.warnings.length > 0 ? ` [warnings: ${details.warnings.join('; ')}]` : '';
        onAppendLog(threadId, `[startup injected via ${reason}]${warnSuffix}`);
      })
      .catch((error: unknown) => {
        onAppendLog(threadId, `[startup injection failed: ${getErrorMessage(error)}]`);
      });
    onInjected(threadId, {
      hasBoot: details.hasBoot,
      hasMemory: details.hasMemory,
      injected: true,
    });
    eventLogger.info('thread', 'Startup payload injected', {
      threadId,
      reason,
      hasBoot: details.hasBoot,
      hasMemory: details.hasMemory,
      warnings: details.warnings,
    });
  };

  const onData = (chunk: string): void => {
    if (injected) return;
    tail = `${tail}${chunk}`.slice(-4096);
    if (isCliReady(provider, tail)) {
      markInjected('ready-signal');
    }
  };

  const onExit = (): void => {
    if (injected) return;
    cleanup();
    onInjected(threadId, {
      hasBoot: details.hasBoot,
      hasMemory: details.hasMemory,
      injected: false,
      error: 'Process exited before startup injection',
    });
    eventLogger.warn('thread', 'Startup payload skipped because process exited early', { threadId });
  };

  const hardTimeout = setTimeout(() => markInjected('timeout'), hardTimeoutMs);
  proc.on('data', onData);
  proc.on('exit', onExit);
}

export type LaunchMode = {
  claudeStreamJson: boolean;
  fallbackTried: boolean;
  headless: boolean;
  /** When true the thread runs on the host (no Docker container); teardown skips docker. */
  runOnHost: boolean;
  /** Launch-time env to replay onto each per-turn host process (empty under Docker). */
  hostEnv: Record<string, string>;
  systemPrompt: string | null;
  memoryMcpUrl: string | null;
  threadMcpUrl: string | null;
  councilMcpUrl: string | null;
  kanbanMcpUrl: string | null;
  recordingsMcpUrl: string | null;
};

/**
 * Manages turn execution, startup injection, and headless exec.
 *
 * Uses ThreadRuntimeStore for shared pty/launchMode state, eliminating the
 * per-map accessor-callback pattern that previously coupled it to ThreadManager.
 */
export class TurnExecutor {
  private readonly store: ThreadRuntimeStore;
  private readonly turnWaiterManager: TurnWaiterManager;
  private readonly inputQueue: ThreadInputQueue;
  private readonly output: ThreadOutputManager;
  private readonly autopilot: AutopilotService;
  private readonly autopilotState: AutopilotStateService;
  private readonly containers: ContainerManager;
  private readonly callbacks: {
    startThread: (threadId: string) => Promise<void>;
    renameThread: (threadId: string, name: string) => void;
    sendInput: (threadId: string, input: string, source: QueueSource) => Promise<void>;
    stopThread: (threadId: string, opts?: { preserveQueue?: boolean }) => Promise<void>;
  };
  private readonly stateService: ThreadStateService;

  constructor(args: {
    store: ThreadRuntimeStore;
    turnWaiterManager: TurnWaiterManager;
    inputQueue: ThreadInputQueue;
    output: ThreadOutputManager;
    autopilot: AutopilotService;
    autopilotState: AutopilotStateService;
    containers: ContainerManager;
    stateService: ThreadStateService;
    callbacks: {
      startThread: (threadId: string) => Promise<void>;
      renameThread: (threadId: string, name: string) => void;
      sendInput: (threadId: string, input: string, source: QueueSource) => Promise<void>;
      stopThread: (threadId: string, opts?: { preserveQueue?: boolean }) => Promise<void>;
    };
  }) {
    this.store = args.store;
    this.turnWaiterManager = args.turnWaiterManager;
    this.inputQueue = args.inputQueue;
    this.output = args.output;
    this.autopilot = args.autopilot;
    this.autopilotState = args.autopilotState;
    this.containers = args.containers;
    this.stateService = args.stateService;
    this.callbacks = args.callbacks;
  }

  // ---------------------------------------------------------------------------
  // Input dispatch
  // ---------------------------------------------------------------------------

  writeInputNow(threadId: string, input: string, source: QueueSource, persistInput = true): void {
    const proc = this.store.ptys.get(threadId);
    if (!proc) throw new Error(`Thread ${threadId} is not running`);
    proc.write(input);

    const trimmed = input.replace(/\n$/, '').trim();
    if (!trimmed) return;

    if (persistInput) {
      this.persistUserInput(threadId, source, trimmed, input);
    }
    eventLogger.info('queue', 'Queued input dispatched', { threadId, source, length: trimmed.length });
  }

  private persistUserInput(threadId: string, source: QueueSource, trimmed: string, rawInput: string): void {
    if (!trimmed) return;
    if (source !== 'user' && source !== 'automation' && source !== 'autopilot') return;
    this.output.flushAssistantMessage(threadId);
    const thread = threadStore.getThread(threadId);
    const history = [...(thread?.promptHistory ?? []), trimmed].slice(-100);
    threadStore.updateThread(threadId, { promptHistory: history, lastActiveAt: Date.now() });
    const messageSource = source === 'autopilot' ? 'autopilot' : source === 'automation' ? 'automation' : 'human';
    this.output.appendNormalizedMessageWithSource(threadId, 'user', messageSource, trimmed, rawInput);
    // Capture human prompts in the thread view. Slack-origin prompts already flow through this path
    // (Slack inbound is routed in as user input), so this covers both UI and Slack without duplication.
    if (messageSource === 'human') {
      threadPostsStore.append(threadId, 'prompt', 'user', trimmed);
    }
  }

  async runTurn(
    threadId: string,
    input: string,
    source: QueueSource,
    timeoutMs?: number,
    persistInput = true,
    systemPromptSuffix?: string
  ): Promise<void> {
    this.store.interruptedThreads.delete(threadId);

    const isUserTurn = source === 'user' || source === 'automation' || source === 'autopilot';
    const postTurnId = isUserTurn ? randomUUID() : null;
    const effectiveSystemPromptSuffix = postTurnId
      ? [
          `Current AgentOS turn id: ${postTurnId}.`,
          `When calling agentos-thread post_update, ask_clarification, or upload_file, pass turn_id="${postTurnId}".`,
          systemPromptSuffix,
        ]
          .filter(Boolean)
          .join('\n')
      : systemPromptSuffix;
    const flushOutput = (): void => {
      if (isUserTurn) {
        this.output.flushAssistantMessage(threadId);
      } else {
        this.output.clearPendingOutput(threadId);
      }
    };

    let wasThisTurnInterrupted = false;
    let turnEndReason: TurnEndReason | undefined;
    try {
      if (postTurnId) this.store.threadPostTurnIds.set(threadId, postTurnId);
      turnEndReason = await this.executeTurn(
        threadId,
        input,
        source,
        timeoutMs,
        persistInput,
        effectiveSystemPromptSuffix
      );
      wasThisTurnInterrupted = this.store.interruptedThreads.has(threadId);
      flushOutput();
      eventLogger.info('queue', 'Main agent turn ended', { threadId, source, turnEndReason });
      this.autopilotState.recordTurnEndReason(threadId, turnEndReason);
      if (wasThisTurnInterrupted) {
        eventLogger.info('autopilot', 'Skipped: turn was interrupted by new user input', { threadId });
      } else if (turnEndReason === 'timeout') {
        // claude-interactive only: the JSONL never wrote a turn_duration / stop_hook_summary
        // system marker within the turn budget. Overwhelmingly this means the turn didn't
        // complete cleanly (crash, hung tool, stuck TUI) and the planner would be reading a
        // half-finished response.
        // (Note: this is unrelated to TurnWaiterManager's kebab-case 'silence-fallback', which
        // is the normal turn-end signal for codex/gemini PTY output — those still fire autopilot.)
        eventLogger.info('autopilot', 'Skipped: turn ended on timeout (incomplete)', { threadId });
      } else {
        this.autopilot.maybeRunAfterTurn(threadId, source);
      }
      if (!wasThisTurnInterrupted && this.store.ptys.has(threadId) && this.inputQueue.queueDepth(threadId) === 0) {
        this.stateService.broadcastIdle(threadId);
      }
    } catch (error) {
      flushOutput();
      throw error;
    } finally {
      if (postTurnId && this.store.threadPostTurnIds.get(threadId) === postTurnId) {
        this.store.threadPostTurnIds.delete(threadId);
      }
    }
    if (wasThisTurnInterrupted) {
      throw new Error('Interrupted by user input');
    }
  }

  // ---------------------------------------------------------------------------
  // Startup injection
  // ---------------------------------------------------------------------------

  scheduleStartupInjection(
    threadId: string,
    proc: PtyProcess,
    provider: Provider,
    payload: string | null,
    details: { hasBoot: boolean; hasMemory: boolean; warnings: string[] }
  ): void {
    if (!payload) {
      eventLogger.info('thread', 'No startup memory/boot payload found', { threadId });
      return;
    }
    scheduleStartupInjection({
      threadId,
      proc,
      provider,
      payload,
      details,
      onSendInput: (id, input, source) => this.callbacks.sendInput(id, input, source),
      onInjected: (id, status) => {
        this.store.injectionStatuses.set(id, status);
      },
      onAppendLog: (id, msg) => {
        this.output.appendSystemLogEntry(id, msg);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdownThreadRuntime(threadId: string, options?: { preserveQueue?: boolean }): Promise<void> {
    this.containers.cancelIdleStop(threadId);
    this.turnWaiterManager.reject(threadId, new Error('Thread stopped while waiting for command completion'));
    if (!options?.preserveQueue) {
      this.inputQueue.clearQueue(threadId);
    }
    // Tear down any claude-interactive session before the container goes. Its inner
    // `docker exec` PTY would otherwise be orphaned in the registry and reused by the
    // next turn, writing input into a dead exec that never reaches the model.
    claudeInteractiveSessions.disposeThread(threadId);
    const proc = this.store.ptys.get(threadId);
    if (!proc) {
      await removeDockerContainer(`agentos-session-${threadId}`).catch((err) => {
        eventLogger.warn('session', 'failed to remove docker container', { error: String(err) });
      });
      await removeContainerRegistryEntry(`agentos-session-${threadId}`).catch((err) => {
        eventLogger.warn('session', 'failed to remove container registry entry', { error: String(err) });
      });
      return;
    }

    if (this.store.launchModes.get(threadId)?.runOnHost) {
      // Host threads have no container, so docker teardown is skipped. The keep-alive proc killed
      // below is a separate process from any in-flight per-turn CLI (a distinct PtyProcess) —
      // under Docker the container kill cascaded to it, but on host it must be reaped explicitly,
      // or a long-running agent process with full host access is orphaned.
      const activeTurn = this.store.activeTurnProcs.get(threadId);
      if (activeTurn) {
        activeTurn.proc.kill();
        this.store.activeTurnProcs.delete(threadId);
      }
      this.store.activeTurns.delete(threadId);
    } else {
      await stopContainer(threadId).catch((err) => {
        eventLogger.warn('session', 'failed to stop container', { error: String(err) });
      });
    }
    proc.kill();
    this.store.ptys.delete(threadId);
    this.store.launchModes.delete(threadId);
    rebuildManagedMcpConfig(
      this.store.launchModes,
      Object.fromEntries(threadStore.getAllThreads().map((t) => [t.id, t])),
      path.join(app.getPath('home'), '.agentos', 'sessions')
    );
    this.output.closeLogStream(threadId);
    this.stateService.setStoppedInDB(threadId);
  }

  getThreadProvider(threadId: string): Provider {
    const thread = threadStore.getThread(threadId);
    return thread?.provider ?? 'claude';
  }

  getThreadEntry(threadId: string): ProviderEntry {
    const thread = threadStore.getThread(threadId);
    return { provider: thread?.provider ?? 'claude', model: thread?.model };
  }

  // ---------------------------------------------------------------------------
  // Private execution
  // ---------------------------------------------------------------------------

  private async executeTurn(
    threadId: string,
    input: string,
    source: QueueSource,
    timeoutMs?: number,
    persistInput = true,
    systemPromptSuffix?: string
  ): Promise<TurnEndReason | undefined> {
    if (this.store.launchModes.get(threadId)?.headless) {
      try {
        return await this.execHeadlessTurn(threadId, input, source, timeoutMs, persistInput, systemPromptSuffix);
      } catch (error) {
        if (
          isProviderLimitError(error) &&
          (await this.fallbackProviderAndRetry(threadId, input, source, timeoutMs, systemPromptSuffix))
        ) {
          return undefined;
        }
        throw error;
      }
    }

    this.writeInputNow(threadId, input, source, persistInput);
    const proc = this.store.ptys.get(threadId);
    emitTurnStarted({ threadId });
    try {
      await this.turnWaiterManager.wait(
        threadId,
        source,
        proc !== undefined,
        this.getThreadProvider(threadId),
        timeoutMs
      );
    } finally {
      emitTurnEnded({ threadId });
    }
    return undefined;
  }

  private persistSessionIds(threadId: string, rawOutput: string): void {
    const sessionId = persistAllSessionIds(threadId, rawOutput);
    if (sessionId) {
      const thread = threadStore.getThread(threadId);
      if (thread && thread.name === 'Untitled') {
        this.callbacks.renameThread(threadId, generateSlugFromSessionId(sessionId));
      }
    }
  }

  private async execHeadlessTurn(
    threadId: string,
    input: string,
    source: QueueSource,
    timeoutMs: number | undefined,
    persistInput: boolean,
    systemPromptSuffix: string | undefined
  ): Promise<TurnEndReason | undefined> {
    const provider = this.getThreadProvider(threadId);
    const runner = provider === 'claude-interactive' ? execClaudeInteractiveTurn : execHeadlessTurn;
    const result = await runner(
      threadId,
      input,
      source,
      {
        store: this.store,
        output: this.output,
        containers: this.containers,
        callbacks: {
          stopThread: (id, opts) => this.callbacks.stopThread(id, opts),
          persistUserInput: (id, src, trimmed, raw) => this.persistUserInput(id, src, trimmed, raw),
          persistSessionIds: (id, out) => this.persistSessionIds(id, out),
        },
      },
      { timeoutMs, persistInput, systemPromptSuffix }
    );
    return result.turnEndReason;
  }

  private async fallbackProviderAndRetry(
    threadId: string,
    input: string,
    source: QueueSource,
    timeoutMs: number | undefined,
    systemPromptSuffix: string | undefined
  ): Promise<boolean> {
    const thread = threadStore.getThread(threadId);
    if (!thread) return false;

    const currentProvider = thread.provider ?? 'claude';
    const projectConfigResult = await loadProjectConfig(thread.projectPath ?? thread.workingDirectory);
    const providerOrder = getEffectiveProviderOrder(getStore().get('settings'), projectConfigResult.config);
    const currentIndex = providerOrder.findIndex((entry) => entry.provider === currentProvider);
    const searchFrom = currentIndex >= 0 ? currentIndex + 1 : 0;
    const nextEntry = providerOrder.slice(searchFrom).find((entry) => entry.provider !== currentProvider);
    if (!nextEntry) {
      eventLogger.warn('thread', 'Provider usage limit reached, but no fallback provider is configured', {
        threadId,
        provider: currentProvider,
      });
      return false;
    }

    this.output.clearPendingOutput(threadId);
    this.output.appendSystemLogEntry(
      threadId,
      `[provider fallback] ${PROVIDER_LABEL[currentProvider]} hit a usage limit; switching to ${PROVIDER_LABEL[nextEntry.provider]}.`
    );

    eventLogger.warn('thread', 'Switching provider after usage limit', {
      threadId,
      fromProvider: currentProvider,
      toProvider: nextEntry.provider,
    });

    threadStore.updateThread(threadId, {
      provider: nextEntry.provider,
      model: nextEntry.model ?? null,
      effort: nextEntry.provider === 'claude' ? (nextEntry.effort ?? null) : null,
      reasoning: nextEntry.provider === 'codex' ? (nextEntry.reasoning ?? null) : null,
    });
    this.stateService.broadcastCurrentStatus(threadId, { provider: nextEntry.provider });

    await this.shutdownThreadRuntime(threadId, { preserveQueue: true });
    await this.callbacks.startThread(threadId);
    await this.executeTurn(threadId, input, source, timeoutMs, false, systemPromptSuffix);
    return true;
  }
}
