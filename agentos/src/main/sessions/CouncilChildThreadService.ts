import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import { PtyProcess } from './PtyProcess';
import { buildDockerExecArgs } from '../utils/docker/sandbox';
import { councilService, councilEvents } from '../council/service';
import { buildCouncilBootInstructions } from '../council/bootInstructions';
import { councilMcpServer } from '../integrations/councilMcpServer';
import { getApiKey } from '../utils/providerConfig';
import { readClaudeOauthToken } from './threadAuth';
import { getMcpToken } from '../mcp/mcpAuth';
import { mcpUrl } from '../mcp/mcpHost';
import { eventLogger } from '../utils/eventLog';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { EmbeddedChildThreadRunner } from './EmbeddedChildThreadRunner';
import { ThreadOutputManager } from './threadOutput';
import { broadcastThreadCreated, broadcastStatus } from './broadcaster';
import { ClaudeInteractiveSession } from './claudeInteractive/ClaudeInteractiveSession';
import type { JsonlEntry } from './claudeInteractive/ClaudeJsonlWatcher';
import type { Provider, Thread, ThreadStatus } from '../../shared/types';
import type { CouncilMember, CouncilOutcomeRecord } from '../../shared/types/council';

const COUNCIL_CHILD_TIMEOUT_MS = 10 * 60 * 1000;

// Walk up the parent chain to find a thread ID that owns a live container.
// Stage workers share their parent's container and don't have their own PTY entry.
function resolveContainerThreadId(store: ThreadRuntimeStore, threadId: string): string {
  let current: string | undefined = threadId;
  while (current) {
    if (store.ptys.has(current)) return current;
    const t = threadStore.getThread(current);
    current = t?.parentThreadId;
  }
  throw new Error(`No running container found in parent chain of thread ${threadId}`);
}

export class CouncilChildThreadService {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly runner: EmbeddedChildThreadRunner,
    private readonly output: ThreadOutputManager
  ) {}

  async spawn(opts: {
    parentThreadId: string;
    runId: string;
    member: CouncilMember;
    memberLabel: string;
    prompt: string;
    onOutcome: (outcome: CouncilOutcomeRecord) => void;
  }): Promise<{ childThreadId: string }> {
    const parent = threadStore.getThread(opts.parentThreadId);
    if (!parent) throw new Error(`Parent thread ${opts.parentThreadId} not found`);
    const containerThreadId = resolveContainerThreadId(this.store, opts.parentThreadId);

    const childId = nanoid();
    const now = Date.now();
    const childThread: Omit<Thread, 'logBuffer'> = {
      id: childId,
      name: `council/${opts.member.provider}-${opts.member.model}`,
      projectId: parent.projectId,
      workingDirectory: parent.workingDirectory,
      projectPath: parent.projectPath,
      usingWorktree: parent.usingWorktree,
      provider: opts.member.provider,
      model: opts.member.model,
      parentThreadId: opts.parentThreadId,
      councilRunId: opts.runId,
      status: 'running',
      createdAt: now,
      lastActiveAt: now,
      queueDepth: 0,
      promptHistory: [],
      autopilotEnabled: false,
      autopilotState: 'idle',
      autopilotConsecutiveTurns: 0,
    };

    councilService.registerChildMember(opts.runId, childId, opts.member);

    const settings = getStore().get('settings');
    const apiKey = getApiKey(opts.member.provider, settings.apiKeys) ?? null;
    const isClaudeFamily = opts.member.provider === 'claude' || opts.member.provider === 'claude-interactive';
    const claudeOauthToken = isClaudeFamily ? await readClaudeOauthToken() : null;

    const bootInstructions = buildCouncilBootInstructions({
      runId: opts.runId,
      memberLabel: opts.memberLabel,
      childThreadId: childId,
    });
    const composed = `${bootInstructions}\n\n${opts.prompt}`;
    // Council children exec into the parent's container (or run on its host); inherit that
    // thread's execution mode and captured launch env.
    const containerLaunch = this.store.launchModes.get(containerThreadId);
    const runOnHost = containerLaunch?.runOnHost ?? false;
    const hostEnv = containerLaunch?.hostEnv ?? {};
    const councilMcpUrl = mcpUrl(councilMcpServer.actualPort ?? 0, runOnHost);

    if (opts.member.provider === 'claude-interactive') {
      return this.spawnInteractive({
        runId: opts.runId,
        member: opts.member,
        onOutcome: opts.onOutcome,
        containerThreadId,
        childId,
        childThread,
        composed,
        workingDirectory: parent.workingDirectory,
        claudeOauthToken,
        apiKey,
        councilMcpUrl,
        runOnHost,
        hostEnv,
        providerCommandOverrides: settings.providerCommandOverrides,
      });
    }

    const execArgs = buildDockerExecArgs(containerThreadId, composed, {
      provider: opts.member.provider,
      model: opts.member.model,
      effort: isClaudeFamily ? opts.member.effort : undefined,
      reasoning: opts.member.provider === 'codex' ? opts.member.reasoning : undefined,
      skipPermissions: true,
      apiKey,
      claudeOauthToken,
      mcpBearerToken: getMcpToken(),
      councilMcpUrl,
      runOnHost,
      providerCommandOverrides: settings.providerCommandOverrides,
    });

    const procEnv = execArgs.env ? { ...hostEnv, ...execArgs.env } : undefined;
    const proc = new PtyProcess(execArgs.command, execArgs.args, parent.workingDirectory, procEnv);

    let outcomeRecorded = false;

    const onMcpOutcome = (data: { runId: string; outcome: CouncilOutcomeRecord }): void => {
      if (data.runId !== opts.runId || data.outcome.childThreadId !== childId) return;
      outcomeRecorded = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      councilEvents.off('outcome:submitted', onMcpOutcome);
      proc.kill();
    };
    councilEvents.on('outcome:submitted', onMcpOutcome);

    const timeoutMs = COUNCIL_CHILD_TIMEOUT_MS;
    const timeoutHandle: NodeJS.Timeout | null = setTimeout(() => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      councilEvents.off('outcome:submitted', onMcpOutcome);
      opts.onOutcome({
        runId: opts.runId,
        childThreadId: childId,
        member: opts.member,
        status: 'timeout',
        error: `Council child timed out after ${Math.round(timeoutMs / 1000)}s`,
        submittedAt: Date.now(),
      });
      proc.kill();
    }, timeoutMs);

    this.runner.setup({
      childThread,
      proc,
      onExit: (exitCode) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        councilEvents.off('outcome:submitted', onMcpOutcome);
        if (!outcomeRecorded) {
          opts.onOutcome({
            runId: opts.runId,
            childThreadId: childId,
            member: opts.member,
            status: 'error',
            error: `Child exited with code ${exitCode ?? 'unknown'} before submitting an outcome`,
            submittedAt: Date.now(),
          });
          outcomeRecorded = true;
        }
        eventLogger.info('council', 'Council child thread exited', {
          childThreadId: childId,
          runId: opts.runId,
          exitCode,
        });
      },
    });

    return { childThreadId: childId };
  }

  // Interactive harness branch — uses ClaudeInteractiveSession instead of a one-shot
  // PtyProcess. The child runs in PTY mode with --session-id, output streams from the
  // JSONL file rather than stdout. Lifecycle still terminates on council MCP outcome
  // submission, child PTY exit, or council timeout (whichever first).
  private spawnInteractive(opts: {
    runId: string;
    member: CouncilMember;
    onOutcome: (outcome: CouncilOutcomeRecord) => void;
    containerThreadId: string;
    childId: string;
    childThread: Omit<Thread, 'logBuffer'>;
    composed: string;
    workingDirectory: string;
    claudeOauthToken: string | null;
    apiKey: string | null;
    councilMcpUrl: string;
    runOnHost: boolean;
    hostEnv: Record<string, string>;
    providerCommandOverrides?: Partial<Record<Provider, string>>;
  }): { childThreadId: string } {
    const sessionId = randomUUID();
    const childThreadWithSession = { ...opts.childThread, claudeSessionId: sessionId };

    // Pre-listener setup that can throw (disk I/O, IPC marshalling, watcher init).
    // If any throw, we record the failure and return — without this guard the parent
    // council would hang the full MAX_COUNCIL_MS (15 min) waiting for an outcome.
    let session: ClaudeInteractiveSession;
    try {
      threadStore.saveThread(childThreadWithSession);
      this.output.initLogBuffer(opts.childId);
      this.output.openLogStream(opts.childId);
      broadcastThreadCreated({ ...childThreadWithSession, logBuffer: [] });

      session = new ClaudeInteractiveSession(
        opts.childId,
        sessionId,
        opts.workingDirectory,
        {
          // args.threadId is used by buildClaudeInteractiveArgs to pick the container
          // (`agentos-session-<threadId>`). Council children share the parent's container,
          // so we pass the resolved container thread id, not the child's id.
          threadId: opts.containerThreadId,
          sessionId,
          isResume: false,
          claudeOauthToken: opts.claudeOauthToken,
          apiKey: opts.apiKey,
          mcpBearerToken: getMcpToken(),
          model: opts.member.model || undefined,
          effort: opts.member.effort,
          skipPermissions: true,
          runOnHost: opts.runOnHost,
          launchEnv: opts.hostEnv,
          providerCommandOverrides: opts.providerCommandOverrides,
          mcp: { councilMcpUrl: opts.councilMcpUrl },
        },
        () => {
          // No registry to clean up for council children — they aren't tracked in
          // claudeInteractiveSessions and dispose-on-exit is driven by the wrappers below.
        }
      );
    } catch (err) {
      eventLogger.warn('council', 'Failed to spawn interactive council child', {
        childThreadId: opts.childId,
        runId: opts.runId,
        error: String(err),
      });
      try {
        this.output.closeLogStream(opts.childId);
      } catch {
        /* best-effort */
      }
      try {
        threadStore.updateThread(opts.childId, { status: 'error', exitCode: null });
      } catch {
        /* best-effort */
      }
      broadcastStatus({ threadId: opts.childId, status: 'error' });
      opts.onOutcome({
        runId: opts.runId,
        childThreadId: opts.childId,
        member: opts.member,
        status: 'error',
        error: `Failed to spawn interactive council child: ${String(err)}`,
        submittedAt: Date.now(),
      });
      return { childThreadId: opts.childId };
    }

    let outcomeRecorded = false;
    let cleanedUp = false;

    const finalize = (statusOnNoOutcome: ThreadStatus, errorMessage?: string): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      councilEvents.off('outcome:submitted', onMcpOutcome);
      this.output.flushAssistantMessage(opts.childId, { multiTurn: true });
      this.output.closeLogStream(opts.childId);
      if (!outcomeRecorded) {
        outcomeRecorded = true;
        opts.onOutcome({
          runId: opts.runId,
          childThreadId: opts.childId,
          member: opts.member,
          status: 'error',
          error: errorMessage ?? 'Interactive council child ended before submitting an outcome',
          submittedAt: Date.now(),
        });
      }
      // exitCode is null because interactive lifecycle is driven by us (MCP outcome,
      // timeout, or runTurn settlement), not a process exit code. Matches the headless
      // path's `exitCode: exitCode ?? null` shape.
      threadStore.updateThread(opts.childId, { status: statusOnNoOutcome, exitCode: null });
      broadcastStatus({ threadId: opts.childId, status: statusOnNoOutcome });
      eventLogger.info('council', 'Council interactive child ended', {
        childThreadId: opts.childId,
        runId: opts.runId,
      });
    };

    const onMcpOutcome = (data: { runId: string; outcome: CouncilOutcomeRecord }): void => {
      if (data.runId !== opts.runId || data.outcome.childThreadId !== opts.childId) return;
      outcomeRecorded = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      session.dispose();
    };
    councilEvents.on('outcome:submitted', onMcpOutcome);

    const timeoutHandle: NodeJS.Timeout | null = setTimeout(() => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      opts.onOutcome({
        runId: opts.runId,
        childThreadId: opts.childId,
        member: opts.member,
        status: 'timeout',
        error: `Council child timed out after ${Math.round(COUNCIL_CHILD_TIMEOUT_MS / 1000)}s`,
        submittedAt: Date.now(),
      });
      session.dispose();
    }, COUNCIL_CHILD_TIMEOUT_MS);

    // No broadcastTerminalData here — unlike the headless path (EmbeddedChildThreadRunner
    // which broadcasts raw stream-json from PTY 'data'), the interactive harness produces
    // JSONL entries that don't match extractStreamBlocks's stream-json parser. Final
    // assistant messages still reach the renderer via flushAssistantMessage →
    // broadcastMessageAppended; the live token-by-token streaming view is unavailable
    // for interactive council members.
    const onEntry = (entry: JsonlEntry): void => {
      const data = JSON.stringify(entry) + '\n';
      this.output.appendLog(opts.childId, data);
      if (entry.type === 'assistant' || entry.type === 'user') {
        this.output.flushAssistantMessage(opts.childId, { multiTurn: true, skipSideEffects: true });
      } else {
        this.output.clearPendingOutput(opts.childId);
      }
    };

    session
      .runTurn(opts.composed, undefined, onEntry)
      .then(() => {
        finalize('stopped');
      })
      .catch((err: unknown) => {
        // runTurn rejects when the watcher is cancelled (dispose path) — that's expected
        // when the MCP outcome arrives or the council times out. Only treat unexpected
        // rejections as errors.
        if (outcomeRecorded) {
          finalize('stopped');
          return;
        }
        eventLogger.warn('council', 'Interactive council turn failed', {
          childThreadId: opts.childId,
          runId: opts.runId,
          error: String(err),
        });
        finalize('error', `Interactive council turn failed: ${String(err)}`);
      });

    return { childThreadId: opts.childId };
  }
}
