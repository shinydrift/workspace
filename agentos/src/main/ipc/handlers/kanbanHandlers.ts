import { z } from 'zod';
import { IPC_CHANNELS, IPC_EVENTS } from '../../../shared/types';
import type { KanbanTaskStatus, KanbanTaskMovedEvent, KanbanClassOfService } from '../../../shared/types/kanban';
import { kanbanService, kanbanEvents } from '../../kanban/service';
import { getProject } from '../../threads/db';
import { defineHandler } from '../ipcResponse';
import { shortId, threadId, ProjectIdSchema } from './schemas';
import { broadcastToWindows } from '../../sessions/broadcaster';
import { worktreeWorkerClient } from '../../utils/worktreeWorkerClientDefaults';
import { slackBridge } from '../../integrations/slackBridge';

const statusEnum = z.string().min(1).max(64);
const ProjectIdTaskId = z.object({ projectId: shortId, taskId: shortId });

export function registerKanbanHandlers(): void {
  // Wire up kanban event → IPC broadcast for live UI updates
  kanbanEvents.on('task:moved', (event: KanbanTaskMovedEvent) => {
    broadcastToWindows(IPC_EVENTS.KANBAN_TASK_MOVED, event);
  });

  defineHandler(
    IPC_CHANNELS.KANBAN_LIST,
    z.object({ projectId: shortId, status: statusEnum.optional() }),
    ({ projectId, status }) => kanbanService.list(projectId, status as KanbanTaskStatus)
  );

  defineHandler(IPC_CHANNELS.KANBAN_GET, ProjectIdTaskId, ({ projectId, taskId }) =>
    kanbanService.get(projectId, taskId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_CREATE,
    z.object({
      projectId: shortId,
      title: z.string().min(1).max(256),
      description: z.string().max(50_000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      classOfService: z.enum(['expedite', 'standard', 'intangible']).optional(),
      skillTags: z.array(z.string().max(64)).max(20).optional(),
      parentTaskId: z.string().optional(),
      status: statusEnum.optional(),
    }),
    (req) => {
      const task = kanbanService.create(req as Parameters<typeof kanbanService.create>[0]);
      broadcastToWindows(IPC_EVENTS.KANBAN_TASK_CREATED, task);
      return task;
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_MOVE,
    z.object({ projectId: shortId, taskId: shortId, status: statusEnum, reason: z.string().max(1024).optional() }),
    ({ projectId, taskId, status, reason }) =>
      kanbanService.move(projectId, taskId, status as KanbanTaskStatus, null, reason)
  );

  defineHandler(IPC_CHANNELS.KANBAN_DELETE, ProjectIdTaskId, ({ projectId, taskId }) => {
    kanbanService.delete(projectId, taskId);
    broadcastToWindows(IPC_EVENTS.KANBAN_TASK_DELETED, { projectId, taskId });
  });

  defineHandler(
    IPC_CHANNELS.KANBAN_UPDATE_PROGRESS,
    z.object({
      projectId: shortId,
      taskId: shortId,
      progress: z.number().int().min(0).max(100),
      note: z.string().max(10_000).optional(),
    }),
    ({ projectId, taskId, progress, note }) => {
      kanbanService.updateProgress(projectId, taskId, progress, note);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_ASSIGN,
    z.object({ projectId: shortId, taskId: shortId, threadId }),
    ({ projectId, taskId, threadId }) => {
      const task = kanbanService.assignThread(projectId, taskId, threadId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_ADD_NOTE,
    z.object({
      projectId: shortId,
      taskId: shortId,
      content: z.string().min(1).max(50_000),
      threadId: threadId.optional(),
    }),
    ({ projectId, taskId, content, threadId }) => {
      const note = kanbanService.addNote(projectId, taskId, content, threadId);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
      return note;
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_ADD_REVIEW,
    z.object({
      projectId: shortId,
      taskId: shortId,
      verdict: z.enum(['approved', 'changes_requested']),
      summary: z.string().max(10_000).optional(),
      threadId: threadId.optional(),
    }),
    ({ projectId, taskId, verdict, summary, threadId }) => {
      kanbanService.addReview(projectId, taskId, verdict, summary, threadId);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_SET_BLOCKER,
    z.object({
      projectId: shortId,
      taskId: shortId,
      blocked: z.boolean(),
      summary: z.string().max(10_000).optional(),
      threadId: threadId.optional(),
    }),
    ({ projectId, taskId, blocked, summary, threadId }) => {
      kanbanService.setBlocker(projectId, taskId, blocked, summary, threadId);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(IPC_CHANNELS.KANBAN_GET_NOTES, ProjectIdTaskId, ({ projectId, taskId }) =>
    kanbanService.getNotes(projectId, taskId)
  );

  defineHandler(IPC_CHANNELS.KANBAN_LIST_EVENTS, ProjectIdTaskId, ({ projectId, taskId }) =>
    kanbanService.listEvents(projectId, taskId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_EDIT_NOTE,
    z.object({ projectId: shortId, eventId: z.string().min(1), newText: z.string().min(1).max(50_000) }),
    ({ projectId, eventId, newText }) => kanbanService.editNote(projectId, eventId, newText)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_DELETE_NOTE,
    z.object({ projectId: shortId, eventId: z.string().min(1) }),
    ({ projectId, eventId }) => kanbanService.deleteNote(projectId, eventId)
  );

  defineHandler(IPC_CHANNELS.KANBAN_GET_GIT_SUMMARY, ProjectIdTaskId, ({ projectId, taskId }) => {
    const task = kanbanService.get(projectId, taskId);
    const projectPath = getProject(projectId)?.path;
    if (!task || !projectPath) return null;
    return worktreeWorkerClient.getTaskGitSummary(projectPath, {
      branch: task.branch,
      worktreePath: task.worktreePath,
    });
  });

  defineHandler(IPC_CHANNELS.KANBAN_GET_WIP_LIMITS, ProjectIdSchema, ({ projectId }) =>
    kanbanService.getWipLimits(projectId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_SET_WIP_LIMIT,
    z.object({ projectId: shortId, status: statusEnum, maxTasks: z.number().int().positive().max(50) }),
    ({ projectId, status, maxTasks }) => {
      kanbanService.setWipLimit(projectId, status as KanbanTaskStatus, maxTasks);
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_LIST_SUBTASKS,
    z.object({ projectId: shortId, parentTaskId: shortId }),
    ({ projectId, parentTaskId }) => kanbanService.listSubtasks(projectId, parentTaskId)
  );

  defineHandler(IPC_CHANNELS.KANBAN_LIST_STAGES, ProjectIdSchema, ({ projectId }) =>
    kanbanService.listStages(projectId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_DELETE_STAGE,
    z.object({ projectId: shortId, stageId: z.string().min(1).max(64) }),
    ({ projectId, stageId }) => {
      kanbanService.deleteStage(projectId, stageId);
      broadcastToWindows(IPC_EVENTS.KANBAN_STAGES_UPDATED, { projectId });
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_UPDATE_STAGE,
    z.object({
      projectId: shortId,
      stage: z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(128),
        description: z.string().max(2000),
        order: z.number().int().min(0),
      }),
    }),
    ({ projectId, stage }) => {
      kanbanService.updateStage(projectId, stage);
      broadcastToWindows(IPC_EVENTS.KANBAN_STAGES_UPDATED, { projectId });
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_RENAME_STAGE,
    z.object({
      projectId: shortId,
      oldId: z.string().min(1).max(64),
      newId: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Stage id must be a kebab-case slug (no leading/trailing hyphen).'),
    }),
    ({ projectId, oldId, newId }) => {
      kanbanService.renameStage(projectId, oldId, newId);
      broadcastToWindows(IPC_EVENTS.KANBAN_STAGES_UPDATED, { projectId });
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_GET_CFD_DATA,
    z.object({ projectId: shortId, days: z.number().int().min(1).max(90) }),
    ({ projectId, days }) => kanbanService.getCfdData(projectId, days)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_UPDATE_CLASS,
    z.object({
      projectId: shortId,
      taskId: shortId,
      classOfService: z.enum(['expedite', 'standard', 'intangible']),
    }),
    ({ projectId, taskId, classOfService }) => {
      const task = kanbanService.updateClassOfService(projectId, taskId, classOfService as KanbanClassOfService);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
      return task;
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_SET_DUE_DATE,
    z.object({ projectId: shortId, taskId: shortId, dueAt: z.number().int().positive().nullable() }),
    ({ projectId, taskId, dueAt }) => {
      const task = kanbanService.setDueDate(projectId, taskId, dueAt);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
      return task;
    }
  );

  defineHandler(IPC_CHANNELS.KANBAN_LIST_OVERDUE, ProjectIdSchema, ({ projectId }) =>
    kanbanService.listOverdue(projectId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_ADD_DEPENDENCY,
    z.object({ projectId: shortId, taskId: shortId, blocksId: shortId }),
    ({ projectId, taskId, blocksId }) => {
      kanbanService.addDependency(projectId, taskId, blocksId);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_REMOVE_DEPENDENCY,
    z.object({ projectId: shortId, taskId: shortId, blocksId: shortId }),
    ({ projectId, taskId, blocksId }) => {
      kanbanService.removeDependency(projectId, taskId, blocksId);
      const task = kanbanService.get(projectId, taskId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
    }
  );

  defineHandler(IPC_CHANNELS.KANBAN_GET_BLOCKED_TASKS, z.object({ projectId: shortId }), ({ projectId }) =>
    kanbanService.getBlockedTasks(projectId)
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_UPDATE_PRIORITY,
    z.object({ projectId: shortId, taskId: shortId, priority: z.enum(['low', 'medium', 'high', 'critical']) }),
    ({ projectId, taskId, priority }) => {
      const task = kanbanService.updatePriority(projectId, taskId, priority);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
      return task;
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_ASSIGN_THREAD,
    z.object({ projectId: shortId, taskId: shortId, threadId: threadId.nullable() }),
    ({ projectId, taskId, threadId }) => {
      const task = kanbanService.assignThread(projectId, taskId, threadId);
      if (task) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, task);
      return task;
    }
  );

  defineHandler(
    IPC_CHANNELS.KANBAN_SHARE_SLACK_UPDATE,
    z.object({
      projectId: shortId,
      taskId: shortId,
      message: z.string().min(1).max(3500),
      channelId: z.string().min(1).max(128).optional(),
    }),
    async ({ projectId, taskId, message, channelId }) => {
      const task = kanbanService.get(projectId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      const storedChannelId =
        typeof task.metadata.slackShareChannelId === 'string' ? task.metadata.slackShareChannelId : undefined;
      const storedThreadTs =
        typeof task.metadata.slackShareThreadTs === 'string' ? task.metadata.slackShareThreadTs : undefined;
      const targetChannelId = storedChannelId ?? channelId;
      if (!targetChannelId) throw new Error('No Slack channel specified');

      const postedTs = await slackBridge.sendChannelNotification(targetChannelId, message, storedThreadTs);
      if (postedTs === null) throw new Error('Failed to post Slack message — check Slack integration settings');

      const rootThreadTs = storedThreadTs ?? postedTs;
      kanbanService.patchMetadata(projectId, taskId, {
        slackShareChannelId: targetChannelId,
        slackShareThreadTs: rootThreadTs,
      });

      const updated = kanbanService.get(projectId, taskId);
      if (updated) broadcastToWindows(IPC_EVENTS.KANBAN_TASK_UPDATED, updated);

      return { ok: true, threadTs: rootThreadTs, channelId: targetChannelId };
    }
  );
}
