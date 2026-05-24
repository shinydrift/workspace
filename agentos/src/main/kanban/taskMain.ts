// Per-task main thread orchestration.
//
// A "main thread" is spawned per kanban task and lives for the task's lifetime.
// It runs the `kanban-orchestrator` skill and dispatches stage sub-threads
// (one at a time) that execute via `docker exec` into the main thread's
// container, sharing its worktree.

import type { KanbanTask } from '../../shared/types/kanban';
import type { ClaudeEffort, CodexReasoning, Provider } from '../../shared/types/provider';
import * as kanbanDb from './db';
import { TERMINAL_STATUSES, PROVISIONAL_MAIN_THREAD_ID } from './db';
import * as threadStore from '../threads/threadStore';
import { getProject, getAllProjects } from '../threads/db';
import { threadManager } from '../sessions/ThreadManager';
import { slackBridge } from '../integrations/slackBridge';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

export interface SpawnStageWorkerArgs {
  projectId: string;
  task: KanbanTask;
  stage: string;
  mainThreadId: string;
  stagePrompt: string;
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
}

function buildMainThreadKickoff(task: KanbanTask, hasSlack: boolean): string {
  const slackLine = hasSlack
    ? `If you have Slack context, post a one-line start update (task title + first stage) before spawning the first stage worker.\n`
    : '';
  return [
    `You are the main thread for kanban task ${task.id}. Drive it through its stages using the \`kanban-orchestrator\` skill.`,
    ``,
    `${slackLine}Start by calling \`get_task({ task_id: "${task.id}" })\` to read the current status, then \`spawn_stage_worker\` for that stage and stop. When you receive a [STAGE COMPLETE] message, decide the next action per the skill.`,
  ].join('\n');
}

/**
 * Create the main thread for a newly-created task.
 *
 * Launches a thread with `agentRole: 'task-main'`, `taskId: task.id`, working directory
 * set to the task's worktree path if set, otherwise the project dir. Kicks it off with
 * a prompt that invokes the `kanban-orchestrator` skill.
 * Persists the resulting thread id on `kanban_tasks.main_thread_id`.
 *
 * Returns the new main thread's id.
 */
export async function createMainThread(projectId: string, task: KanbanTask): Promise<string | null> {
  const project = getProject(projectId);
  if (!project) throw new Error(`createMainThread: project ${projectId} not found`);

  // Atomically claim the main-thread slot. The CAS succeeds only when main_thread_id IS NULL.
  // If it fails, another call already owns the slot — return the winner's thread ID or null.
  const claimed = kanbanDb.claimTaskMainThread(projectId, task.id);
  if (!claimed) {
    const existing = kanbanDb.getTask(projectId, task.id);
    eventLogger.info('kanban', 'createMainThread: slot already claimed, skipping', {
      taskId: task.id,
      mainThreadId: existing?.mainThreadId,
    });
    if (existing?.mainThreadId && existing.mainThreadId !== PROVISIONAL_MAIN_THREAD_ID) {
      return existing.mainThreadId;
    }
    // Slot is held by another in-progress call — bail without error
    return null;
  }

  let workingDirectory = project.path;
  try {
    if (task.worktreePath) {
      workingDirectory = task.worktreePath;
    }

    const thread = await threadManager.createThread({
      name: task.title.slice(0, 50),
      workingDirectory,
      projectPath: project.path,
    });
    const threadId = thread.id;

    // If ThreadFactory created a fresh worktree (workingDirectory unset on the task),
    // persist it on the task so subsequent restarts reuse the same worktree instead
    // of orphaning it and spawning a duplicate.
    if (!task.worktreePath && thread.usingWorktree && thread.workingDirectory !== project.path) {
      try {
        kanbanDb.updateTaskWorktree(projectId, task.id, null, thread.workingDirectory);
      } catch (err) {
        eventLogger.warn('kanban', 'Failed to persist task worktree path', {
          taskId: task.id,
          worktreePath: thread.workingDirectory,
          error: String(err),
        });
      }
    }

    threadStore.updateThread(threadId, {
      agentRole: 'task-main',
      taskId: task.id,
      ...(task.skillTags.length ? { skillTags: task.skillTags } : {}),
      ...(task.worktreePath || thread.usingWorktree ? { usingWorktree: true } : {}),
    });

    kanbanDb.setTaskMainThread(projectId, task.id, threadId);

    const slackCtx =
      task.slackChannelId && task.slackThreadTs
        ? { channelId: task.slackChannelId, threadTs: task.slackThreadTs }
        : await slackBridge.openTaskThread(projectId, task.title);
    if (slackCtx) {
      if (!task.slackThreadTs) kanbanDb.updateTaskSlack(projectId, task.id, slackCtx.channelId, slackCtx.threadTs);
      threadManager.setSlackContext(threadId, slackCtx);
      slackBridge.bindThreadToSlackThread(threadId, slackCtx.channelId, slackCtx.threadTs, workingDirectory);
    }

    threadManager.setThreadAutopilot(threadId, true);
    await threadManager.startThread(threadId);
    await threadManager.sendInput(threadId, `${buildMainThreadKickoff(task, slackCtx != null)}\n`, 'automation');

    eventLogger.info('kanban', 'Task main thread created', {
      taskId: task.id,
      projectId,
      threadId,
      workingDirectory,
    });
    return threadId;
  } catch (err) {
    // Reset the provisional claim so reconcile can retry on next startup.
    try {
      kanbanDb.setTaskMainThread(projectId, task.id, null);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

/**
 * Spawn a stage sub-thread inside the main thread's container.
 *
 * Uses the same `docker exec` mechanism that council sub-threads use
 * (`parentThreadId = mainThreadId`), so the sub-thread inherits the main
 * thread's container, mounts, and worktree. Sub-threads are short-lived:
 * they run one stage, call `report_stage_result`, and stop.
 *
 * The sub-thread's `agentRole` is `stage-${stage}` for UI filtering.
 *
 * Returns the sub-thread's id.
 */
export async function spawnStageWorker(args: SpawnStageWorkerArgs): Promise<string> {
  const { projectId, task, stage, mainThreadId, stagePrompt, provider, model, effort, reasoning } = args;

  const taskContext = buildTaskContextPreamble(task, stage);
  const fullPrompt = `${taskContext}\n\n${stagePrompt}`;

  const { childThreadId } = await threadManager.spawnStageChildThread({
    parentThreadId: mainThreadId,
    taskId: task.id,
    stage,
    prompt: fullPrompt,
    provider,
    model,
    effort,
    reasoning,
  });

  kanbanDb.assignTask(projectId, task.id, childThreadId);
  kanbanDb.addTaskEvent(
    projectId,
    task.id,
    'assigned',
    { threadId: childThreadId, stage, role: `stage-${stage}` },
    childThreadId
  );
  eventLogger.info('kanban', 'Stage worker spawned', {
    taskId: task.id,
    stage,
    mainThreadId,
    childThreadId,
  });
  return childThreadId;
}

function buildTaskContextPreamble(task: KanbanTask, stage: string): string {
  const lines = [
    `[STAGE CONTEXT]`,
    `task_id: ${task.id}`,
    `project_id: ${task.projectId}`,
    `stage: ${stage}`,
    `title: ${task.title}`,
    `priority: ${task.priority}`,
  ];
  if (task.description && task.description.trim().length > 0) {
    lines.push('', 'description:', task.description.trim());
  }
  return lines.join('\n');
}

/**
 * At app startup, reconcile tasks whose `main_thread_id` points at a thread
 * that is no longer running (app restart, crash). For non-terminal tasks,
 * create a fresh main thread so orchestration resumes.
 */
export async function reconcileOrphanedTasks(): Promise<void> {
  const projectIds = new Set<string>();
  for (const p of getAllProjects()) projectIds.add(p.id);
  for (const t of threadStore.getAllThreads()) {
    if (t.projectId) projectIds.add(t.projectId);
  }

  for (const projectId of projectIds) {
    let tasks: KanbanTask[];
    try {
      tasks = kanbanDb.listTasks(projectId);
    } catch (err) {
      eventLogger.warn('kanban', 'reconcile: failed to list tasks', {
        projectId,
        error: getErrorMessage(err),
      });
      continue;
    }
    for (const task of tasks) {
      if (TERMINAL_STATUSES.has(task.status)) continue;
      const mainAlive = task.mainThreadId != null && threadStore.getThread(task.mainThreadId)?.status === 'running';
      if (mainAlive) continue;

      // Clear stale main/assigned pointers so createMainThread can claim fresh ids.
      if (task.mainThreadId) {
        try {
          kanbanDb.setTaskMainThread(projectId, task.id, null);
        } catch {
          /* best-effort */
        }
      }
      if (task.assignedThreadId) {
        const sub = threadStore.getThread(task.assignedThreadId);
        if (sub && sub.status === 'running') {
          await threadManager.stopThread(task.assignedThreadId).catch((err: unknown) => {
            eventLogger.warn('kanban', 'reconcile: failed to stop orphaned stage worker', {
              taskId: task.id,
              threadId: task.assignedThreadId,
              error: getErrorMessage(err),
            });
          });
        }
        try {
          kanbanDb.assignTask(projectId, task.id, null);
        } catch {
          /* best-effort */
        }
      }

      const refreshed: KanbanTask = { ...task, mainThreadId: null, assignedThreadId: null };
      try {
        await createMainThread(projectId, refreshed);
      } catch (err) {
        eventLogger.warn('kanban', 'reconcile: failed to create main thread', {
          projectId,
          taskId: task.id,
          error: getErrorMessage(err),
        });
      }
    }
  }
}
