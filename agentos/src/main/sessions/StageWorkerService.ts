import { nanoid } from 'nanoid';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import * as kanbanDb from '../kanban/db';
import { PtyProcess } from './PtyProcess';
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
import type { Thread } from '../../shared/types';
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

    const childId = nanoid();
    const now = Date.now();
    const agentRole = `stage-${opts.stage}` as const;
    const childThread: Omit<Thread, 'logBuffer'> = {
      id: childId,
      name: `stage/${opts.stage}`,
      projectId: parent.projectId,
      workingDirectory: parent.workingDirectory,
      projectPath: parent.projectPath,
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
    const claudeOauthToken = effectiveProvider === 'claude' ? await readClaudeOauthToken() : null;

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
      projectId: parent.projectId,
      threadId: childId,
      slackMcpPort: 0,
      memoryMcpPort: memoryMcpServer.actualPort ?? 0,
      threadMcpPort: threadMcpServer.actualPort ?? 0,
      councilMcpPort: councilMcpServer.actualPort ?? 0,
      kanbanMcpPort: kanbanMcpServer.actualPort ?? 0,
      recordingsMcpPort: recordingsMcpServer.actualPort ?? 0,
      taskCtx: null,
      agentRole,
    });

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
    });

    const proc = new PtyProcess(execArgs.command, execArgs.args, parent.workingDirectory);

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
}
