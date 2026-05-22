import { randomUUID } from 'crypto';
import { eventLogger } from '../../utils/eventLog';
import * as threadStore from '../../threads/threadStore';
import { loadProjectConfig } from '../../config/projectConfig';
import { resolveEffectiveEffort, resolveEffectiveModel } from '../../utils/providerConfig';
import { resolveDisallowedTools } from '../../mcp/toolResolver';
import { getStore } from '../../store/index';
import { readClaudeOauthToken } from '../threadAuth';
import { emitTurnStarted, emitTurnEnded } from '../../events';
import { generateSlugFromSessionId } from '../messagePersistence';
import { broadcastRename } from '../broadcaster';
import type { QueueSource } from '../ThreadInputQueue';
import type { HeadlessTurnDeps, TurnExecutionResult } from '../headlessRunner';
import { ClaudeInteractiveSession } from './ClaudeInteractiveSession';
import { claudeInteractiveSessions } from './sessionRegistry';
import type { JsonlEntry } from './ClaudeJsonlWatcher';

// Matches headless's HEADLESS_IDLE_STOP_MS. Idle teardown is routed through
// ContainerManager.scheduleIdleStop, the same path headless uses, so the
// 30m-idle → save-chunk → stop-container behavior is identical.
const INTERACTIVE_IDLE_STOP_MS = 30 * 60 * 1000;

// Entry point for the Claude interactive harness. Matches execHeadlessTurn's signature
// so the dispatch site in turnExecution.ts is a single ternary. All complexity
// (persistent PTY, JSONL tailing, paste handling) lives in the wrapper module —
// headless code is untouched.
export async function execClaudeInteractiveTurn(
  threadId: string,
  input: string,
  source: QueueSource,
  deps: HeadlessTurnDeps,
  options: { timeoutMs?: number; persistInput?: boolean; systemPromptSuffix?: string } = {}
): Promise<TurnExecutionResult> {
  const { store, output, containers, callbacks } = deps;
  const { timeoutMs, persistInput = true, systemPromptSuffix } = options;

  const thread = threadStore.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  containers.cancelIdleStop(threadId);

  // Ensure a session id is allocated up-front so the JSONL tail knows what file
  // to watch and resumes cleanly across PTY restarts within the same thread.
  let sessionId = thread.claudeSessionId ?? undefined;
  if (!sessionId) {
    sessionId = randomUUID();
    threadStore.updateThread(threadId, { claudeSessionId: sessionId });
    if (thread.name === 'Untitled') {
      // persistAllSessionIds (which TurnExecutor wires for the headless path) parses
      // claude's stream-json result envelope for the session_id; interactive's JSONL
      // doesn't carry that envelope, so the auto-rename never fires from there.
      // Persist + broadcast directly so the UI updates without a refresh.
      const newName = generateSlugFromSessionId(sessionId);
      threadStore.updateThread(threadId, { name: newName });
      broadcastRename({ threadId, name: newName });
    }
  }

  const trimmed = input.replace(/\n$/, '').trim();
  if (persistInput) {
    callbacks.persistUserInput(threadId, source, trimmed, input);
  }
  eventLogger.info('queue', 'Queued input dispatched (claude interactive)', {
    threadId,
    source,
    length: trimmed.length,
  });

  let session = claudeInteractiveSessions.get(threadId);
  if (!session) {
    const launchMode = store.launchModes.get(threadId);
    const baseSystemPrompt = launchMode?.systemPrompt ?? null;
    const settings = getStore().get('settings');
    const projectConfigResult = await loadProjectConfig(thread.projectPath ?? thread.workingDirectory);
    const model = resolveEffectiveModel('claude-interactive', thread.model, projectConfigResult.config, settings);
    const effort = resolveEffectiveEffort(projectConfigResult.config, settings, thread.effort);
    const claudeOauthToken = await readClaudeOauthToken();
    const agentRole = thread.agentRole ?? null;
    const disallowedTools = agentRole ? resolveDisallowedTools() : [];

    session = new ClaudeInteractiveSession(
      threadId,
      sessionId,
      thread.workingDirectory,
      {
        threadId,
        sessionId,
        claudeOauthToken,
        apiKey: null,
        mcpBearerToken: null,
        model,
        effort,
        systemPrompt: baseSystemPrompt,
        disallowedTools,
        skipPermissions: settings.skipPermissions ?? true,
        mcp: {
          memoryMcpUrl: launchMode?.memoryMcpUrl ?? null,
          threadMcpUrl: launchMode?.threadMcpUrl ?? null,
          councilMcpUrl: launchMode?.councilMcpUrl ?? null,
          slackMcpUrl: launchMode?.slackMcpUrl ?? null,
          kanbanMcpUrl: launchMode?.kanbanMcpUrl ?? null,
          recordingsMcpUrl: launchMode?.recordingsMcpUrl ?? null,
        },
      },
      () => claudeInteractiveSessions.delete(threadId)
    );
    claudeInteractiveSessions.set(threadId, session);
  }

  emitTurnStarted({ threadId });

  // Accumulate raw output from JSONL entries for the TurnExecutionResult.rawOutput
  // contract, matching how headless populates it. Each entry is written to the
  // thread log immediately so the renderer sees it stream.
  let rawOutput = '';
  const onEntry = (entry: JsonlEntry): void => {
    const data = JSON.stringify(entry) + '\n';
    rawOutput += data;
    output.appendLog(threadId, data);
    if (entry.type === 'assistant' || entry.type === 'user') {
      output.flushAssistantMessage(threadId, { multiTurn: true, skipSideEffects: true });
    } else {
      // System/lifecycle entries: logged but not emitted as chat messages mid-turn.
      // Clear from pendingAssistantChunks so the end-of-turn flush doesn't broadcast raw JSON.
      output.clearPendingOutput(threadId);
    }
  };

  // Mirror headless/sandbox.ts: --append-system-prompt is ignored by Claude Code when
  // resuming a session, so inject the per-turn suffix (e.g. Slack context note) into
  // the user message instead. Only inject on resumed sessions (claudeSessionId was
  // already set before this call) — on a fresh session --append-system-prompt works
  // and the suffix would otherwise be injected twice.
  const isResume = Boolean(thread.claudeSessionId);
  const effectiveInput = isResume && systemPromptSuffix ? `${systemPromptSuffix}\n\n${input}` : input;

  try {
    await session.runTurn(effectiveInput, timeoutMs, onEntry);
    threadStore.updateThread(threadId, { lastActiveAt: Date.now() });
    callbacks.persistSessionIds(threadId, rawOutput);
    output.flushSideEffectsOnly(threadId, rawOutput);
    // Schedule idle teardown the same way headless does — same ContainerManager
    // timer, same stopThread callback (saveBeforeStop → /save-session-chunk →
    // stopThread). cancelIdleStop at the top of this function clears it on next turn.
    containers.scheduleIdleStop(threadId, INTERACTIVE_IDLE_STOP_MS, () => {
      eventLogger.info('thread', 'Idle timeout reached, stopping container', { threadId });
      callbacks.stopThread(threadId).catch((err: unknown) => {
        eventLogger.warn('thread', 'Idle stop failed', { threadId, error: String(err) });
      });
    });
    eventLogger.info('queue', 'Queued input completed (claude interactive)', { threadId, source });
    return { rawOutput };
  } finally {
    emitTurnEnded({ threadId });
  }
}
