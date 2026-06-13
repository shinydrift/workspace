import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { broadcastTerminalData } from './broadcaster';
import { buildDockerExecArgs } from '../utils/docker';
import { loadProjectConfig } from '../config/projectConfig';
import { readClaudeOauthToken } from './threadAuth';
import { resolveEffectiveEffort, resolveEffectiveModel, resolveEffectiveReasoning } from '../utils/providerConfig';
import { resolveDisallowedTools } from '../mcp/toolResolver';
import { eventLogger } from '../utils/eventLog';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import { emitTurnStarted, emitTurnEnded } from '../events';
import { PtyProcess } from './PtyProcess';
import type { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { ContainerManager } from './ContainerManager';
import type { ThreadOutputManager } from './threadOutput';
import { filterClaudeCliNoise } from './threadOutput';
import type { QueueSource } from './ThreadInputQueue';

const HEADLESS_IDLE_STOP_MS = 30 * 60 * 1000; // 30 minutes
const HEADLESS_STALL_MS = 120_000; // 2 minutes with no output → auto-recover

const PROVIDER_LIMIT_SIGNALS = [
  "you've hit your org's monthly usage limit",
  'monthly usage limit',
  'usage limit',
  'quota exceeded',
  'rate limit exceeded',
  'too many requests',
];

export function hasProviderLimitSignal(rawOutput: string): boolean {
  const lower = rawOutput.toLowerCase();
  return PROVIDER_LIMIT_SIGNALS.some((signal) => lower.includes(signal));
}

export class ProviderLimitError extends Error {
  constructor(public readonly rawOutput: string) {
    super('Provider usage limit reached');
    this.name = 'ProviderLimitError';
  }
}

export function isProviderLimitError(error: unknown): error is ProviderLimitError {
  return error instanceof ProviderLimitError;
}

export type TurnEndReason = 'turn_duration' | 'stop_hook_summary' | 'timeout';

export type TurnExecutionResult = {
  rawOutput: string;
  // Only populated by the claude-interactive harness today. `turn_duration` /
  // `stop_hook_summary` are the system markers claude-interactive writes when a turn
  // completes cleanly. `timeout` means the JSONL never wrote either within the budget —
  // the turn is incomplete (claude crashed / hung tool / TUI stuck) and autopilot must
  // not run against it.
  turnEndReason?: TurnEndReason;
};

export type HeadlessTurnDeps = {
  store: ThreadRuntimeStore;
  output: ThreadOutputManager;
  containers: ContainerManager;
  callbacks: {
    sendInput: (threadId: string, input: string, source: QueueSource) => Promise<void>;
    stopThread: (threadId: string, opts?: { preserveQueue?: boolean }) => Promise<void>;
    persistUserInput: (threadId: string, source: QueueSource, trimmed: string, raw: string) => void;
    persistSessionIds: (threadId: string, rawOutput: string) => void;
  };
};

export async function execHeadlessTurn(
  threadId: string,
  input: string,
  source: QueueSource,
  deps: HeadlessTurnDeps,
  options: { timeoutMs?: number; persistInput?: boolean; systemPromptSuffix?: string } = {}
): Promise<TurnExecutionResult> {
  const { store, output, containers, callbacks } = deps;
  const { timeoutMs, persistInput = true, systemPromptSuffix } = options;

  if (!store.ptys.has(threadId)) {
    throw new Error(`Thread ${threadId} is not running`);
  }

  containers.cancelIdleStop(threadId);

  const thread = threadStore.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }
  const provider = thread.provider ?? 'claude';
  const launchMode = store.launchModes.get(threadId);
  const baseSystemPrompt = launchMode?.systemPrompt ?? null;
  const systemPrompt =
    baseSystemPrompt && systemPromptSuffix
      ? `${baseSystemPrompt}\n${systemPromptSuffix}`
      : systemPromptSuffix || baseSystemPrompt;
  const memoryMcpUrl = launchMode?.memoryMcpUrl ?? null;
  const threadMcpUrl = launchMode?.threadMcpUrl ?? null;
  const councilMcpUrl = launchMode?.councilMcpUrl ?? null;
  const slackMcpUrl = launchMode?.slackMcpUrl ?? null;
  const kanbanMcpUrl = launchMode?.kanbanMcpUrl ?? null;
  const recordingsMcpUrl = launchMode?.recordingsMcpUrl ?? null;
  const agentRole = thread.agentRole ?? null;
  const disallowedTools = agentRole ? resolveDisallowedTools() : [];
  let claudeSessionId = provider === 'claude' ? thread.claudeSessionId : undefined;
  const codexSessionId = provider === 'codex' ? thread.codexSessionId : undefined;
  const geminiSessionId = provider === 'gemini' ? thread.geminiSessionId : undefined;
  let piSessionId = provider === 'pi' ? thread.piSessionId : undefined;

  // Pre-validate the session file exists before passing --resume. Without this, docker exec
  // runs a full Claude invocation that immediately exits with "No conversation found with
  // session ID", triggering the retry in the exit handler — the "double turn". This is
  // particularly common after migrating session storage (e.g. per-thread dir → ~/.claude).
  if (claudeSessionId) {
    const userHome = app.getPath('home');
    const sessionFile = path.join(userHome, '.claude', 'projects', '-workspace', `${claudeSessionId}.jsonl`);
    if (!fs.existsSync(sessionFile)) {
      eventLogger.info('thread', 'Session file not found, clearing stale session ID', {
        threadId,
        claudeSessionId,
      });
      threadStore.updateThread(threadId, { claudeSessionId: null });
      claudeSessionId = undefined;
    }
  }

  if (piSessionId) {
    const userHome = app.getPath('home');
    const piSessionDir = path.join(userHome, '.agentos', 'sessions', threadId);
    if (!fs.existsSync(piSessionDir) || fs.readdirSync(piSessionDir).length === 0) {
      eventLogger.info('thread', 'Pi session directory missing or empty, clearing stale session ID', {
        threadId,
        piSessionId,
      });
      threadStore.updateThread(threadId, { piSessionId: null });
      piSessionId = undefined;
    }
  }

  const trimmed = input.replace(/\n$/, '').trim();
  if (persistInput) {
    callbacks.persistUserInput(threadId, source, trimmed, input);
  }
  eventLogger.info('queue', 'Queued input dispatched (headless)', { threadId, source, length: trimmed.length });

  const settings = getStore().get('settings');
  const claudeOauthToken = provider === 'claude' ? await readClaudeOauthToken() : null;
  const projectConfigResult = await loadProjectConfig(thread.projectPath ?? thread.workingDirectory);
  const model = resolveEffectiveModel(
    provider as Parameters<typeof resolveEffectiveModel>[0],
    thread.model,
    projectConfigResult.config,
    settings
  );
  const effort =
    provider === 'claude' ? resolveEffectiveEffort(projectConfigResult.config, settings, thread.effort) : undefined;
  const reasoning =
    provider === 'codex'
      ? resolveEffectiveReasoning(projectConfigResult.config, settings, thread.reasoning)
      : undefined;
  const runOnHost = launchMode?.runOnHost ?? false;
  const execArgs = buildDockerExecArgs(threadId, input, {
    provider: provider as Parameters<typeof buildDockerExecArgs>[2]['provider'],
    claudeSessionId,
    codexSessionId,
    geminiSessionId,
    piSessionId,
    systemPrompt,
    systemPromptSuffix,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    slackMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
    disallowedTools,
    skipPermissions: settings.skipPermissions ?? true,
    claudeOauthToken,
    model,
    effort,
    reasoning,
    runOnHost,
    providerCommandOverrides: settings.providerCommandOverrides,
  });

  // On host, exec processes don't inherit any container env — overlay the captured launch env
  // (API keys, backend routing, AGENTOS_* ids) under the per-turn env from buildDockerExecArgs.
  const turnEnv = execArgs.env ? { ...(launchMode?.hostEnv ?? {}), ...execArgs.env } : undefined;

  let turnProc: PtyProcess;
  try {
    turnProc = new PtyProcess(execArgs.command, execArgs.args, thread.workingDirectory, turnEnv);
  } catch (error) {
    const message = getErrorMessage(error);
    eventLogger.error('thread', 'Failed to start headless turn process', {
      threadId,
      provider,
      command: execArgs.command,
      error: message,
    });
    output.appendSystemLogEntry(threadId, `[headless turn spawn failed: ${message}]`);
    throw error;
  }

  store.activeTurnProcs.set(threadId, { proc: turnProc, input: trimmed });
  emitTurnStarted({ threadId });
  let outputBuffer = '';

  try {
    await new Promise<void>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          turnProc.kill();
          reject(new Error(`Input timed out waiting for completion after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      let stalledByTimeout = false;
      let stallTimer: NodeJS.Timeout | undefined;
      const resetStallTimer = (): void => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          stalledByTimeout = true;
          if (outputBuffer.trim().length === 0) {
            // No output at all — genuine cold stall. Re-queue so the model can recover.
            eventLogger.warn('thread', 'Headless turn stalled with no output, re-queuing', { threadId });
            void callbacks.sendInput(
              threadId,
              'The previous turn stalled. Continue with what you were working on.',
              'automation'
            );
          } else {
            // Model produced output then stopped — process likely hung after completing.
            // Do NOT re-queue: the model may have already sent a Slack reply or finished
            // its work, and a re-queue would cause a duplicate response.
            eventLogger.warn('thread', 'Headless turn stalled after producing output, killing without re-queue', {
              threadId,
            });
          }
          turnProc.kill();
        }, HEADLESS_STALL_MS);
      };
      resetStallTimer();

      turnProc.on('data', (chunk: string) => {
        resetStallTimer();
        containers.touchFromActivity(threadId).catch((err) => {
          eventLogger.warn('thread', 'failed to touch container registry', { error: String(err) });
        });
        const filtered = filterClaudeCliNoise(chunk);
        if (!filtered) return;
        outputBuffer += filtered;
        output.appendLog(threadId, filtered);
        broadcastTerminalData({ threadId, data: filtered });
      });

      turnProc.on('exit', (exitCode: number | undefined) => {
        if (stallTimer) clearTimeout(stallTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (stalledByTimeout) {
          resolve();
          return;
        }
        if (exitCode !== 0 && exitCode !== undefined && !store.ptys.has(threadId)) {
          eventLogger.warn('docker', 'Container exited mid-turn', { threadId, provider, source, exitCode });
          reject(new Error(`Container exited mid-turn (exit code ${exitCode})`));
          return;
        }
        if (exitCode !== 0 && exitCode !== undefined && hasProviderLimitSignal(outputBuffer)) {
          eventLogger.warn('thread', 'Provider usage limit signal detected', { threadId, provider, source, exitCode });
          reject(new ProviderLimitError(outputBuffer));
          return;
        }
        // Only persist session IDs if this turn was not interrupted.
        // If interrupted, activeTurnProcs no longer holds this proc (deleted by
        // interruptActiveTurnForInput), so the partial output's session ID would
        // point to an incomplete session. Keeping the pre-interrupt session ID lets
        // the next turn resume from the last clean state instead.
        if (store.activeTurnProcs.get(threadId)?.proc === turnProc) {
          callbacks.persistSessionIds(threadId, outputBuffer);
        }
        resolve();
      });
    });
  } finally {
    const wasActive = store.activeTurnProcs.get(threadId)?.proc === turnProc;
    if (wasActive) {
      store.activeTurnProcs.delete(threadId);
      emitTurnEnded({ threadId });
    }
  }

  // Mark the thread active at turn completion so lastActiveAt reflects when
  // the response was received, not just when input was dispatched.
  threadStore.updateThread(threadId, { lastActiveAt: Date.now() });

  containers.scheduleIdleStop(threadId, HEADLESS_IDLE_STOP_MS, () => {
    eventLogger.info('thread', 'Idle timeout reached, stopping container', { threadId });
    // preserveQueue so a Slack reply that races the teardown isn't rejected with
    // 'Thread queue cleared' — the next sendInput restarts and drains it.
    callbacks.stopThread(threadId, { preserveQueue: true }).catch((err: unknown) => {
      eventLogger.warn('thread', 'Idle stop failed', { threadId, error: String(err) });
    });
  });

  return { rawOutput: outputBuffer };
}
