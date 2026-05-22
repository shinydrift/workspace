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
import { eventLogger } from '../utils/eventLog';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { EmbeddedChildThreadRunner } from './EmbeddedChildThreadRunner';
import type { Thread } from '../../shared/types';
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
    private readonly runner: EmbeddedChildThreadRunner
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
    const councilMcpUrl = `http://host.docker.internal:${councilMcpServer.actualPort ?? 0}/mcp`;
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
    });

    const proc = new PtyProcess(execArgs.command, execArgs.args, parent.workingDirectory);

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
}
