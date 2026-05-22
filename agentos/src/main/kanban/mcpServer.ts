import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { kanbanService } from './service';
import * as kanbanDb from './db';
import { spawnStageWorker } from './taskMain';
import { getStagePrompt } from './stagePrompts';
import { loadProjectConfig } from '../config/projectConfig';
import { getProject } from '../threads/db';
import * as threadStore from '../threads/threadStore';
import { threadManager, threadLifecycle } from '../sessions/ThreadManager';
import { eventLogger } from '../utils/eventLog';
import type { KanbanTask, KanbanTaskStatus, KanbanStage } from '../../shared/types/kanban';
import { BaseMcpServer } from '../mcp/BaseMcpServer';

class KanbanMcpServer extends BaseMcpServer {
  start(): void {
    this.startHttpServer('kanban-mcp', 'AgentOS kanban MCP server', '127.0.0.1');
  }

  stop(): void {
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-kanban';
  }

  protected async registerTools(server: McpServer): Promise<void> {
    server.tool(
      'get_task',
      'Get a kanban task by ID.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string().describe('The task ID to retrieve.'),
      },
      ({ project_id, task_id }) =>
        this.runJsonTool(() => {
          const task = kanbanService.get(project_id, task_id);
          if (!task) throw new Error('Task not found.');
          return task;
        })
    );

    server.tool(
      'list_tasks',
      'List kanban tasks for a project, optionally filtered by status.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        status: z.string().min(1).max(64).optional(),
      },
      ({ project_id, status }) =>
        this.runJsonTool(() => kanbanService.list(project_id, status as KanbanTaskStatus | undefined))
    );

    server.tool(
      'move_task',
      'Move a task to a new status column. Validates WIP limits before moving.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string().describe('The task ID to move.'),
        status: z.string().min(1).max(64),
        reason: z.string().optional().describe('Optional reason for the move, logged as a note.'),
        thread_id: z
          .string()
          .optional()
          .describe('Caller thread id. Pass AGENTOS_THREAD_ID so the main thread skips its own move notification.'),
      },
      ({ project_id, task_id, status, reason, thread_id }) =>
        this.runJsonTool(() =>
          kanbanService.move(project_id, task_id, status as KanbanTaskStatus, thread_id ?? null, reason)
        )
    );

    server.tool(
      'archive_task',
      'Archive a task, removing it from the active board. The task is preserved and can be viewed in the archived section.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string().describe('The task ID to archive.'),
        reason: z.string().optional().describe('Optional reason for archiving, logged as a note.'),
        thread_id: z
          .string()
          .optional()
          .describe('Caller thread id. Pass AGENTOS_THREAD_ID so the main thread skips its own move notification.'),
      },
      ({ project_id, task_id, reason, thread_id }) =>
        this.runJsonTool(() =>
          kanbanService.move(project_id, task_id, 'archived' as KanbanTaskStatus, thread_id ?? null, reason)
        )
    );

    server.tool(
      'create_task',
      'Create a new kanban task on the board.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        title: z.string().min(1).max(256),
        description: z.string().max(50_000).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        skill_tags: z.array(z.string()).optional(),
        parent_task_id: z.string().optional(),
        status: z.string().min(1).max(64).optional(),
      },
      ({ project_id, title, description, priority, skill_tags, parent_task_id, status }) => {
        return this.runJsonTool(
          () =>
            kanbanService.create({
              projectId: project_id,
              title,
              description,
              priority: priority as KanbanTask['priority'] | undefined,
              skillTags: skill_tags,
              parentTaskId: parent_task_id,
              status: status as KanbanTaskStatus | undefined,
            }),
          {
            suffix:
              '\n\nTask created and queued in the kanban pipeline. Do not process this task further — the pipeline will handle it autonomously.',
          }
        );
      }
    );

    server.tool(
      'update_progress',
      'Update the progress percentage (0-100) of a task and optionally log a note.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string(),
        progress: z.number().int().min(0).max(100),
        note: z.string().max(10_000).optional(),
        thread_id: z.string().optional().describe('Thread ID logging this update. Use AGENTOS_THREAD_ID.'),
      },
      ({ project_id, task_id, progress, note, thread_id }) =>
        this.runTool(() => {
          kanbanService.updateProgress(project_id, task_id, progress, note, thread_id ?? undefined);
          return `Progress updated to ${progress}%.`;
        })
    );

    server.tool(
      'update_task',
      'Update editable fields on a task. Currently supports updating the description.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string(),
        description: z.string().max(50_000).optional().describe('New description to replace the existing one.'),
      },
      ({ project_id, task_id, description }) =>
        this.runTool(() => {
          if (description === undefined) return 'No fields provided.';
          kanbanService.updateDescription(project_id, task_id, description);
          return 'Task updated.';
        })
    );

    server.tool(
      'list_subtasks',
      'List all subtasks of a parent task.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        parent_task_id: z.string().describe('The parent task ID whose subtasks to list.'),
      },
      ({ project_id, parent_task_id }) => this.runJsonTool(() => kanbanService.listSubtasks(project_id, parent_task_id))
    );

    server.tool(
      'add_note',
      'Append a progress note to a task.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        task_id: z.string(),
        content: z.string().min(1).max(50_000),
        thread_id: z.string().optional().describe('Thread ID adding this note. Use AGENTOS_THREAD_ID.'),
      },
      ({ project_id, task_id, content, thread_id }) =>
        this.runJsonTool(() => kanbanService.addNote(project_id, task_id, content, thread_id))
    );

    server.tool(
      'list_stages',
      'List all kanban stages for a project, including their id, label, and agent role.',
      { project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.') },
      ({ project_id }) => this.runJsonTool(() => kanbanService.listStages(project_id))
    );

    server.tool(
      'update_stage',
      'Update a kanban stage label, order, or prompt. Provide the full stage object with your changes.',
      {
        project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.'),
        id: z.string().describe('Stage id to update (must match an existing stage id).'),
        label: z.string().min(1).max(128),
        order: z.number().int().min(0),
        prompt: z.string().max(50_000).optional().describe('Agent prompt for this stage. Omit to clear.'),
        save_to_memory: z
          .boolean()
          .optional()
          .describe('When true, save the task output to memory when this stage is entered.'),
      },
      ({ project_id, id, label, order, prompt, save_to_memory }) =>
        this.runTool(() => {
          const existing = kanbanService.listStages(project_id).find((s) => s.id === id);
          if (!existing) throw new Error(`Stage "${id}" is not defined for project ${project_id}.`);
          const stage: KanbanStage = {
            ...existing,
            label,
            order,
            prompt: prompt || undefined,
            saveToMemory: save_to_memory ?? existing.saveToMemory,
          };
          kanbanService.updateStage(project_id, stage);
          return `Stage "${id}" updated.`;
        })
    );

    server.tool(
      'spawn_stage_worker',
      "Spawn a stage worker sub-thread to execute the given stage inside the main thread's container and worktree. Only the task's main thread should call this. Only one stage worker may be live per task.",
      {
        project_id: z.string().describe('The project ID. Use AGENTOS_PROJECT_ID.'),
        task_id: z.string().describe('The task ID to run a stage for.'),
        stage: z.string().min(1).max(64).describe('Stage id to execute (must match a project stage).'),
        thread_id: z.string().describe('Caller (main thread) id. Use AGENTOS_THREAD_ID.'),
      },
      ({ project_id, task_id, stage, thread_id }) =>
        this.runJsonTool(async () => {
          const task = kanbanService.get(project_id, task_id);
          if (!task) throw new Error(`Task ${task_id} not found.`);
          if (!task.mainThreadId || task.mainThreadId !== thread_id) {
            throw new Error(
              `Only the task's main thread (${task.mainThreadId ?? 'unset'}) may spawn stage workers for task ${task_id}.`
            );
          }
          if (task.blockedBy.length > 0) {
            throw new Error(
              `Task ${task_id} is blocked by: ${task.blockedBy.join(', ')}. Resolve dependencies before spawning a worker.`
            );
          }
          const stageRow = kanbanService.listStages(project_id).find((s) => s.id === stage);
          if (!stageRow) throw new Error(`Stage "${stage}" is not defined for project ${project_id}.`);
          const existing = task.assignedThreadId ? threadStore.getThread(task.assignedThreadId) : null;
          if (existing && existing.status === 'running' && existing.parentThreadId === thread_id) {
            return {
              sub_thread_id: task.assignedThreadId,
              message: `Stage worker already running for task "${task.title}".`,
            };
          }

          // Resolve prompt: DB stage > project config > built-in default.
          let stagePrompt = stageRow.prompt && stageRow.prompt.trim().length > 0 ? stageRow.prompt : null;
          if (!stagePrompt) {
            const projectPath = getProject(project_id)?.path ?? null;
            const overrides: Record<string, string | undefined> = {};
            if (projectPath) {
              const { config } = await loadProjectConfig(projectPath);
              const stages = config?.kanban?.stages ?? {};
              for (const [sid, entry] of Object.entries(stages)) {
                overrides[sid] = entry?.prompt;
              }
            }
            stagePrompt = getStagePrompt(stage, overrides);
          }
          const workerFooter =
            `\n\nUse \`add_note\` to record progress or findings. When done, call ` +
            `\`report_stage_result\` with a summary of what you did. Do not move the task ` +
            `yourself — the main thread decides next steps.`;
          if (!stagePrompt) {
            const stageLabel = stageRow.label || stage;
            stagePrompt =
              `You are the **${stageLabel}** stage worker for a kanban task.\n\n` +
              `Complete the work required for this stage.` +
              workerFooter;
          }

          const childThreadId = await spawnStageWorker({
            projectId: project_id,
            task,
            stage,
            mainThreadId: thread_id,
            stagePrompt,
            provider: stageRow.provider,
            model: stageRow.model,
            effort: stageRow.effort,
            reasoning: stageRow.reasoning,
          });
          return { sub_thread_id: childThreadId };
        })
    );

    server.tool(
      'report_stage_result',
      'Sub-thread reports the result of its stage back to the main thread.',
      {
        project_id: z.string().describe('Use AGENTOS_PROJECT_ID.'),
        task_id: z.string(),
        thread_id: z.string().describe('Caller (sub-thread) id. Use AGENTOS_THREAD_ID.'),
        summary: z.string().min(1).max(10_000),
        suggested_next_stage: z.string().min(1).max(64).optional(),
        status: z.enum(['success', 'blocker', 'error']).optional(),
      },
      ({ project_id, task_id, thread_id, summary, suggested_next_stage, status }) =>
        this.runTool(async () => {
          const task = kanbanService.get(project_id, task_id);
          if (!task) throw new Error(`Task ${task_id} not found.`);
          const caller = threadStore.getThread(thread_id);
          if (!caller) {
            throw new Error(
              `Thread ${thread_id} not found. Pass the sub-thread ID from your boot instructions as thread_id — not a branch name, worktree path, or AGENTOS_THREAD_ID (which points at the main thread).`
            );
          }
          if (!task.mainThreadId) {
            throw new Error(`Task ${task_id} has no main thread — cannot report stage result.`);
          }
          if (thread_id === task.mainThreadId) {
            throw new Error(
              `thread_id=${thread_id} is the task's main thread, not a stage worker. You likely used AGENTOS_THREAD_ID; use the sub-thread ID from your boot instructions instead.`
            );
          }
          if (caller.parentThreadId !== task.mainThreadId) {
            throw new Error(
              `Thread ${thread_id} is not a sub-thread of task ${task_id}'s main thread (${task.mainThreadId}). This worker may have been orphaned by a main-thread restart.`
            );
          }
          const finalStatus = status ?? 'success';
          const stageId = caller.agentRole?.startsWith('stage-')
            ? caller.agentRole.slice('stage-'.length)
            : task.status;

          kanbanDb.addTaskEvent(
            project_id,
            task_id,
            'note',
            { kind: 'stage_complete', stage: stageId, status: finalStatus, summary, suggested_next_stage },
            thread_id
          );

          kanbanDb.assignTask(project_id, task_id, null);

          const injection = [
            `[STAGE COMPLETE] task=${task_id} stage=${stageId} status=${finalStatus}`,
            `summary: ${summary}`,
            `suggested_next_stage: ${suggested_next_stage ?? 'none'}`,
          ].join('\n');
          // Fire-and-forget: awaiting would reject if the main thread is stopped
          // or idle-pruned before the injection completes.
          void threadManager.sendInput(task.mainThreadId, injection, 'automation').catch((err: unknown) => {
            eventLogger.warn('kanban', 'report_stage_result: main-thread sendInput failed', {
              mainThreadId: task.mainThreadId,
              error: String(err),
            });
          });

          // Do NOT call stopThread here — it would kill the process before the MCP
          // server can deliver this return value back as a tool_result, causing the
          // final tool call to never be logged. All providers run in one-shot mode
          // (claude -p / codex exec / gemini --prompt) and exit naturally after the
          // turn completes.
          return `Stage "${stageId}" reported (${finalStatus}) for task ${task_id}. The main thread has been notified and will decide the next stage. Your turn is now complete — do not make any further tool calls.`;
        })
    );

    server.tool(
      'list_overdue_tasks',
      'List all non-done tasks whose due date has already passed.',
      { project_id: z.string().describe('The project ID. Use the AGENTOS_PROJECT_ID environment variable.') },
      ({ project_id }) => this.runJsonTool(() => kanbanService.listOverdue(project_id))
    );

    server.tool(
      'add_dependency',
      'Declare that task_id is blocked by blocks_id. Moving blocks_id to done will automatically remove this dependency. Rejects cycles and self-references.',
      {
        project_id: z.string().describe('The project ID. Use AGENTOS_PROJECT_ID.'),
        task_id: z.string().describe('The task that is blocked.'),
        blocks_id: z.string().describe('The task that must complete first.'),
      },
      ({ project_id, task_id, blocks_id }) =>
        this.runTool(() => {
          kanbanService.addDependency(project_id, task_id, blocks_id);
          return `Dependency added: task ${task_id} is now blocked by ${blocks_id}.`;
        })
    );

    server.tool(
      'get_blocked_tasks',
      'List all tasks in the project that have at least one unresolved blocker (blockedBy is non-empty).',
      {
        project_id: z.string().describe('The project ID. Use AGENTOS_PROJECT_ID.'),
      },
      ({ project_id }) => this.runJsonTool(() => kanbanService.getBlockedTasks(project_id))
    );

    server.tool(
      'remove_dependency',
      'Remove a blocking relationship so that task_id is no longer blocked by blocks_id. No-op if the dependency does not exist.',
      {
        project_id: z.string().describe('The project ID. Use AGENTOS_PROJECT_ID.'),
        task_id: z.string().describe('The task that was blocked.'),
        blocks_id: z.string().describe('The blocking task to remove.'),
      },
      ({ project_id, task_id, blocks_id }) =>
        this.runTool(() => {
          kanbanService.removeDependency(project_id, task_id, blocks_id);
          return `Dependency removed: task ${task_id} is no longer blocked by ${blocks_id}.`;
        })
    );

    server.tool(
      'list_dependencies',
      'List the tasks that a given task is blocked by, including their id, title, and current status.',
      {
        project_id: z.string().describe('The project ID. Use AGENTOS_PROJECT_ID.'),
        task_id: z.string().describe('The task to inspect.'),
      },
      ({ project_id, task_id }) =>
        this.runJsonTool(() => {
          const task = kanbanService.get(project_id, task_id);
          if (!task) throw new Error(`Task ${task_id} not found.`);
          const blockers = task.blockedBy
            .map((id) => kanbanService.get(project_id, id))
            .filter((t): t is KanbanTask => t != null)
            .map((t) => ({ id: t.id, title: t.title, status: t.status }));
          return { task_id, blocked_by: blockers };
        })
    );

    server.tool(
      'stop_stage_worker',
      "Force-stop the current stage worker for a task. Only the task's main thread should call this; use only if the worker appears stuck.",
      {
        project_id: z.string().describe('Use AGENTOS_PROJECT_ID.'),
        task_id: z.string(),
        thread_id: z.string().describe('Caller (main thread) id. Use AGENTOS_THREAD_ID.'),
        reason: z.string().max(1000).optional(),
      },
      ({ project_id, task_id, thread_id, reason }) =>
        this.runTool(async () => {
          const task = kanbanService.get(project_id, task_id);
          if (!task) throw new Error(`Task ${task_id} not found.`);
          if (task.mainThreadId !== thread_id) {
            throw new Error(`Only the task's main thread (${task.mainThreadId ?? 'unset'}) may stop its stage worker.`);
          }
          const workerId = task.assignedThreadId;
          if (!workerId) return `No stage worker currently running for task ${task_id}.`;
          await threadLifecycle.stopThread(workerId).catch((err) => {
            eventLogger.warn('kanban', 'stop_stage_worker: stopThread failed', {
              threadId: workerId,
              error: String(err),
            });
          });
          kanbanDb.assignTask(project_id, task_id, null);
          kanbanService.addNote(project_id, task_id, `Stage worker force-stopped: ${reason ?? '(no reason given)'}`);
          const injection = `[STAGE WORKER STOPPED] task=${task_id} worker=${workerId} reason=${reason ?? 'unspecified'}`;
          await threadManager.sendInput(thread_id, injection, 'automation');
          return `Stopped stage worker ${workerId} for task ${task_id}.`;
        })
    );
  }
}

export const kanbanMcpServer = new KanbanMcpServer();
