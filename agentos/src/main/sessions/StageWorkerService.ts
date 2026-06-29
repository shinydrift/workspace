import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import * as kanbanDb from '../kanban/db';
import { PtyProcess } from './PtyProcess';
import { effectiveHostCwd } from './effectiveCwd';
import { buildDockerExecArgs } from '../utils/docker/sandbox';
import { getApiKey } from '../utils/providerConfig';
import { readClaudeOauthToken } from './threadAuth';
import { getMcpToken } from '../mcp/mcpAuth';
import { eventLogger } from '../utils/eventLog';
import { buildHeadlessSystemPrompt } from './systemPromptBuilder';
import { memoryMcpServer } from '../integrations/memoryMcpServer';
import { threadMcpServer } from '../integrations/threadMcpServer';
import { councilMcpServer } from '../integrations/councilMcpServer';
import { kanbanMcpServer } from '../kanban/mcpServer';
import { recordingsMcpServer } from '../integrations/recordingsMcpServer';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { EmbeddedChildThreadRunner } from './EmbeddedChildThreadRunner';
import { ThreadOutputManager } from './threadOutput';
import { broadcastThreadCreated, broadcastStatus } from './broadcaster';
import { ClaudeInteractiveSession } from './claudeInteractive/ClaudeInteractiveSession';
import { claudeInteractiveSessions } from './claudeInteractive/sessionRegistry';
import type { JsonlEntry } from './claudeInteractive/ClaudeJsonlWatcher';
import type { TurnEndReason } from './headlessRunner';
import type { Thread, ThreadStatus } from '../../shared/types';
import type { ClaudeEffort, CodexReasoning, Provider } from '../../shared/types/provider';

function buildStageBootInstructions(opts: { childThreadId: string; taskId: string; stage: string }): string {
  return [
    `You are a kanban stage worker.`,
    `Your sub-thread ID is: ${opts.childThreadId}`,
    `Task ID: ${opts.taskId}`,
    `Stage: ${opts.stage}`,
    ``,
    `When you call \`report_stage_result\`, pass thread_id="${opts.childThreadId}" (your sub-thread ID above).`,
    `When you have completed your work and reported the stage result, your job is done — stop.`,
    ``,
    `If you use council: call council_dispatch then immediately call council_await_completion to block until all members finish. Do NOT use dispatch-and-stop — as a one-shot process you cannot receive injected synthesis messages.`,
  ].join('\n');
}

export class StageWorkerService {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly runner: EmbeddedChildThreadRunner,
    private readonly output: ThreadOutputManager,
    private readonly sendInput: (parentThreadId: string, input: string, source: 'automation') => Promise<void>
  ) {}

  async spawn(opts: {
    parentThreadId: string;
    taskId: string;
    stage: string;
    prompt: string;
    provider?: Provider;
    model?: string;
    effort?: ClaudeEffort;
    reasoning?: CodexReasoning;
  }): Promise<{ childThreadId: string }> {
    const parent = threadStore.getThread(opts.parentThreadId);
    if (!parent) throw new Error(`Parent thread ${opts.parentThreadId} not found`);
    if (!this.store.ptys.has(opts.parentThreadId)) {
      throw new Error(`Parent thread ${opts.parentThreadId} is not running — start it before spawning a stage worker`);
    }
    if (!parent.provider) {
      throw new Error(`Parent thread ${opts.parentThreadId} has no provider — cannot spawn stage worker`);
    }

    const effectiveProvider = opts.provider ?? parent.provider;
    const effectiveModel = opts.model ?? parent.model;

    // Stage workers exec into the parent's container (or run on its host); inherit that
    // thread's execution mode and captured launch env.
    const parentLaunch = this.store.launchModes.get(opts.parentThreadId);
    const runOnHost = parentLaunch?.runOnHost ?? false;
    const hostEnv = parentLaunch?.hostEnv ?? {};

    const childId = nanoid();
    const now = Date.now();
    const agentRole = `stage-${opts.stage}` as const;
    const childThread: Omit<Thread, 'logBuffer'> = {
      id: childId,
      name: `stage/${opts.stage}`,
      projectId: parent.projectId,
      workingDirectory: parent.workingDirectory,
      projectPath: parent.projectPath,
      subdir: parent.subdir,
      usingWorktree: parent.usingWorktree,
      provider: effectiveProvider,
      model: effectiveModel,
      parentThreadId: opts.parentThreadId,
      agentRole,
      taskId: opts.taskId,
      status: 'running',
      createdAt: now,
      lastActiveAt: now,
      queueDepth: 0,
      promptHistory: [],
      autopilotEnabled: false,
      autopilotState: 'idle',
      autopilotConsecutiveTurns: 0,
    };

    const settings = getStore().get('settings');
    const apiKey = getApiKey(effectiveProvider, settings.apiKeys) ?? null;
    // claude-interactive authenticates via the subscription OAuth token (same token as headless
    // claude), so it must be read for both providers — not just 'claude'.
    const claudeOauthToken =
      effectiveProvider === 'claude' || effectiveProvider === 'claude-interactive'
        ? await readClaudeOauthToken()
        : null;

    const {
      effectiveSystemPrompt,
      extraEnv,
      memoryMcpUrl,
      threadMcpUrl,
      councilMcpUrl,
      kanbanMcpUrl,
      recordingsMcpUrl,
    } = buildHeadlessSystemPrompt({
      initialPayload: buildStageBootInstructions({ childThreadId: childId, taskId: opts.taskId, stage: opts.stage }),
      slackCtx: null,
      useHeadless: true,
      runOnHost,
      projectId: parent.projectId,
      threadId: childId,
      memoryMcpPort: memoryMcpServer.actualPort ?? 0,
      threadMcpPort: threadMcpServer.actualPort ?? 0,
      councilMcpPort: councilMcpServer.actualPort ?? 0,
      kanbanMcpPort: kanbanMcpServer.actualPort ?? 0,
      recordingsMcpPort: recordingsMcpServer.actualPort ?? 0,
      taskCtx: null,
      agentRole,
    });

    // claude-interactive runs the stage through a persistent PTY (`claude --session-id`)
    // instead of one-shot `claude -p`, so usage is billed against the Claude subscription
    // rather than the API. Anthropic treats `-p` (headless) as API usage; the interactive
    // harness authenticates via CLAUDE_CODE_OAUTH_TOKEN only.
    if (effectiveProvider === 'claude-interactive') {
      return this.spawnInteractive({
        parentThreadId: opts.parentThreadId,
        taskId: opts.taskId,
        stage: opts.stage,
        prompt: opts.prompt,
        childId,
        childThread,
        workingDirectory: parent.workingDirectory,
        model: effectiveModel,
        effort: opts.effort,
        claudeOauthToken,
        systemPrompt: effectiveSystemPrompt,
        extraEnv,
        memoryMcpUrl,
        threadMcpUrl,
        councilMcpUrl,
        kanbanMcpUrl,
        recordingsMcpUrl,
        runOnHost,
        hostEnv,
        providerCommandOverrides: settings.agents.commandOverrides,
      });
    }

    const execArgs = buildDockerExecArgs(opts.parentThreadId, opts.prompt, {
      provider: effectiveProvider,
      model: effectiveModel,
      effort: opts.effort,
      reasoning: opts.reasoning,
      skipPermissions: true,
      apiKey,
      claudeOauthToken,
      mcpBearerToken: getMcpToken(),
      systemPrompt: effectiveSystemPrompt,
      extraEnv,
      memoryMcpUrl,
      threadMcpUrl,
      councilMcpUrl,
      kanbanMcpUrl,
      recordingsMcpUrl,
      runOnHost,
      providerCommandOverrides: settings.agents.commandOverrides,
    });

    const procEnv = execArgs.env ? { ...hostEnv, ...execArgs.env } : undefined;
    const proc = new PtyProcess(
      execArgs.command,
      execArgs.args,
      effectiveHostCwd(parent.workingDirectory, parent.subdir, runOnHost),
      procEnv
    );

    this.runner.setup({
      childThread,
      proc,
      onExit: (exitCode) => {
        eventLogger.info('kanban', 'Stage worker exited', {
          childThreadId: childId,
          taskId: opts.taskId,
          stage: opts.stage,
          exitCode,
        });

        if (parent.projectId) {
          const task = kanbanDb.getTask(parent.projectId, opts.taskId);
          if (task?.assignedThreadId === childId) {
            kanbanDb.assignTask(parent.projectId, opts.taskId, null);
            const injection = `[STAGE WORKER EXITED] task=${opts.taskId} stage=${opts.stage} exit_code=${exitCode ?? 'unknown'} — worker exited without reporting a stage result.`;
            this.sendInput(opts.parentThreadId, injection, 'automation').catch((err: unknown) => {
              eventLogger.warn('kanban', 'Stage worker exit injection failed', {
                parentThreadId: opts.parentThreadId,
                error: String(err),
              });
            });
          }
        }
      },
    });

    return { childThreadId: childId };
  }

  // Interactive harness branch — runs the stage worker through a ClaudeInteractiveSession
  // (PTY `claude --session-id`) instead of a one-shot `claude -p` process, so the work bills
  // against the Claude subscription. The session shares the main thread's container and is
  // registered under the child id so `stop_stage_worker` can tear it down. The stage worker
  // reports via `report_stage_result` (which notifies the main thread and unassigns the task)
  // and then ends its turn; runTurn resolves at that point. If the turn ends while the task is
  // still assigned to this child, the worker stopped without reporting — mirror the headless
  // onExit and nudge the main thread so it isn't left waiting.
  private spawnInteractive(opts: {
    parentThreadId: string;
    taskId: string;
    stage: string;
    prompt: string;
    childId: string;
    childThread: Omit<Thread, 'logBuffer'>;
    workingDirectory: string;
    model?: string;
    effort?: ClaudeEffort;
    claudeOauthToken: string | null;
    systemPrompt: string | null;
    extraEnv: Record<string, string> | undefined;
    memoryMcpUrl: string | null;
    threadMcpUrl: string | null;
    councilMcpUrl: string | null;
    kanbanMcpUrl: string | null;
    recordingsMcpUrl: string | null;
    runOnHost: boolean;
    hostEnv: Record<string, string>;
    providerCommandOverrides?: Partial<Record<Provider, string>>;
  }): { childThreadId: string } {
    const childId = opts.childId;
    const projectId = opts.childThread.projectId;
    const sessionId = randomUUID();
    const childThreadWithSession = { ...opts.childThread, claudeSessionId: sessionId };

    const notifyExitedWithoutReport = (): void => {
      const task = kanbanDb.getTask(projectId, opts.taskId);
      if (task?.assignedThreadId !== childId) return;
      kanbanDb.assignTask(projectId, opts.taskId, null);
      const injection = `[STAGE WORKER EXITED] task=${opts.taskId} stage=${opts.stage} — interactive worker ended without reporting a stage result.`;
      this.sendInput(opts.parentThreadId, injection, 'automation').catch((err: unknown) => {
        eventLogger.warn('kanban', 'Interactive stage worker exit injection failed', {
          parentThreadId: opts.parentThreadId,
          error: String(err),
        });
      });
    };

    let session: ClaudeInteractiveSession;
    try {
      threadStore.saveThread(childThreadWithSession);
      this.output.initLogBuffer(childId);
      this.output.openLogStream(childId);
      broadcastThreadCreated({ ...childThreadWithSession, logBuffer: [] });

      session = new ClaudeInteractiveSession(
        opts.parentThreadId,
        sessionId,
        opts.workingDirectory,
        {
          // The stage worker shares the main thread's container (agentos-session-<parentThreadId>),
          // so the docker exec must target the parent's id, not the child's.
          threadId: opts.parentThreadId,
          sessionId,
          isResume: false,
          claudeOauthToken: opts.claudeOauthToken,
          // Subscription auth only — injecting an API key would make Claude Code bill via the API,
          // defeating the reason to run interactively.
          apiKey: null,
          mcpBearerToken: getMcpToken(),
          model: opts.model || undefined,
          effort: opts.effort,
          systemPrompt: opts.systemPrompt,
          skipPermissions: true,
          extraEnv: opts.extraEnv,
          runOnHost: opts.runOnHost,
          subdir: opts.childThread.subdir,
          launchEnv: opts.hostEnv,
          providerCommandOverrides: opts.providerCommandOverrides,
          mcp: {
            memoryMcpUrl: opts.memoryMcpUrl,
            threadMcpUrl: opts.threadMcpUrl,
            councilMcpUrl: opts.councilMcpUrl,
            kanbanMcpUrl: opts.kanbanMcpUrl,
            recordingsMcpUrl: opts.recordingsMcpUrl,
          },
        },
        () => claudeInteractiveSessions.delete(childId)
      );
      claudeInteractiveSessions.set(childId, session);
    } catch (err) {
      eventLogger.warn('kanban', 'Failed to spawn interactive stage worker', {
        childThreadId: childId,
        taskId: opts.taskId,
        stage: opts.stage,
        error: String(err),
      });
      try {
        this.output.closeLogStream(childId);
      } catch {
        /* best-effort */
      }
      threadStore.updateThread(childId, { status: 'error', exitCode: null });
      broadcastStatus({ threadId: childId, status: 'error' });
      notifyExitedWithoutReport();
      return { childThreadId: childId };
    }

    let cleanedUp = false;
    const finalize = (status: ThreadStatus, reason: TurnEndReason | 'error'): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.output.flushAssistantMessage(childId, { multiTurn: true });
      this.output.closeLogStream(childId);
      // exitCode is null because interactive lifecycle is driven by turn settlement, not a
      // process exit code — matches the council interactive path.
      threadStore.updateThread(childId, { status, exitCode: null });
      broadcastStatus({ threadId: childId, status });
      notifyExitedWithoutReport();
      session.dispose();
      eventLogger.info('kanban', 'Interactive stage worker ended', {
        childThreadId: childId,
        taskId: opts.taskId,
        stage: opts.stage,
        reason,
      });
    };

    // Mirror EmbeddedChildThreadRunner: log each JSONL entry and flush assistant/user
    // rounds as their own messages. No broadcastTerminalData — the interactive harness
    // emits JSONL, not stream-json, so the live token stream view is unavailable; final
    // messages still reach the renderer via flushAssistantMessage.
    const onEntry = (entry: JsonlEntry): void => {
      const data = JSON.stringify(entry) + '\n';
      this.output.appendLog(childId, data);
      if (entry.type === 'assistant' || entry.type === 'user') {
        this.output.flushAssistantMessage(childId, { multiTurn: true, skipSideEffects: true });
      } else {
        this.output.clearPendingOutput(childId);
      }
    };

    // Boot instructions are baked into the system prompt (buildHeadlessSystemPrompt's
    // initialPayload), so the turn input is just the stage prompt.
    session
      .runTurn(opts.prompt, undefined, onEntry)
      .then((reason) => finalize('stopped', reason))
      .catch((err: unknown) => {
        if (cleanedUp) return;
        eventLogger.warn('kanban', 'Interactive stage worker turn failed', {
          childThreadId: childId,
          taskId: opts.taskId,
          stage: opts.stage,
          error: String(err),
        });
        finalize('error', 'error');
      });

    return { childThreadId: childId };
  }
}
