import { EventEmitter } from 'node:events';
import * as kanbanDb from './db';
import { TERMINAL_STATUSES } from './db';
import * as threadStore from '../threads/threadStore';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { worktreeWorkerClient } from '../utils/worktreeWorkerClientDefaults';
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskEvent,
  KanbanTaskNote,
  KanbanTaskReviewVerdict,
  KanbanTaskStatus,
  KanbanWipLimit,
  KanbanCreateRequest,
  KanbanTaskCreatedEvent,
  KanbanTaskMovedEvent,
  KanbanTaskUnblockedEvent,
  KanbanClassOfService,
  CfdSnapshot,
} from '../../shared/types/kanban';

export const kanbanEvents = new EventEmitter();

const DEFAULT_WIP_LIMITS: Partial<Record<KanbanTaskStatus, number>> = {
  implementing: 5,
  reviewing: 3,
};

class KanbanService {
  // ── Tasks ──────────────────────────────────────────────────────────────────

  create(req: KanbanCreateRequest): KanbanTask {
    // Reject unknown statuses — same guard as move() — prevents tasks from landing
    // in ghost columns that don't exist in the project's stage config.
    if (req.status !== undefined && !TERMINAL_STATUSES.has(req.status)) {
      const stage = kanbanDb.getStageByStatus(req.projectId, req.status);
      if (!stage) {
        const valid = kanbanDb
          .listStages(req.projectId)
          .map((s) => s.id)
          .concat([...TERMINAL_STATUSES])
          .join(', ');
        throw new Error(`Invalid status "${req.status}" for project ${req.projectId}. Valid statuses: ${valid}.`);
      }
    }
    const task = kanbanDb.createTask(req);
    kanbanDb.addTaskEvent(task.projectId, task.id, 'created', {
      title: task.title,
      status: task.status,
      priority: task.priority,
    });
    const event: KanbanTaskCreatedEvent = { taskId: task.id, projectId: task.projectId, task };
    kanbanEvents.emit('task:created', event);
    return task;
  }

  get(projectId: string, taskId: string): KanbanTask | null {
    return kanbanDb.getTask(projectId, taskId);
  }

  list(projectId: string, status?: KanbanTaskStatus): KanbanTask[] {
    return kanbanDb.listTasks(projectId, status);
  }

  move(
    projectId: string,
    taskId: string,
    newStatus: KanbanTaskStatus,
    actorThreadId: string | null,
    reason?: string
  ): KanbanTask {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Reject unknown statuses — prevents typos / prompt drift from landing tasks in
    // ghost columns that don't exist in the project's stage config.
    if (newStatus !== task.status && !TERMINAL_STATUSES.has(newStatus)) {
      const stage = kanbanDb.getStageByStatus(projectId, newStatus);
      if (!stage) {
        const valid = kanbanDb
          .listStages(projectId)
          .map((s) => s.id)
          .concat([...TERMINAL_STATUSES])
          .join(', ');
        throw new Error(`Invalid status "${newStatus}" for task ${taskId}. Valid statuses: ${valid}.`);
      }
    }

    // Expedite tasks bypass WIP limits entirely
    // Compute WIP limit (if any) before entering the atomic transaction
    let maxAllowed: number | undefined;
    if (task.classOfService !== 'expedite' && newStatus !== task.status) {
      const wipLimits = kanbanDb.getWipLimits(projectId);
      const limitEntry = wipLimits.find((w) => w.status === newStatus);
      const defaultLimit = DEFAULT_WIP_LIMITS[newStatus];
      maxAllowed = limitEntry?.maxTasks ?? defaultLimit;
    }

    // Atomically check WIP limit and move — prevents TOCTOU race between agents
    const updated = kanbanDb.moveTaskAtomic(projectId, taskId, newStatus, maxAllowed);
    if (!updated) throw new Error(`Failed to move task ${taskId}`);

    kanbanDb.addTaskEvent(projectId, taskId, 'moved', {
      fromStatus: task.status,
      toStatus: newStatus,
      reason: reason ?? null,
    });

    if (reason) {
      kanbanDb.addNote(projectId, taskId, `Moved to ${newStatus}: ${reason}`);
    }

    const event: KanbanTaskMovedEvent = {
      taskId,
      projectId,
      fromStatus: task.status,
      toStatus: newStatus,
      task: updated,
      actorThreadId,
    };
    kanbanEvents.emit('task:moved', event);

    // Auto-close parent task when all its subtasks are terminal.
    if (TERMINAL_STATUSES.has(newStatus) && task.parentTaskId) {
      const siblings = kanbanDb.listSubtasks(projectId, task.parentTaskId);
      const allTerminal = siblings.every((s) => s.id === taskId || TERMINAL_STATUSES.has(s.status));
      if (allTerminal) {
        const parent = kanbanDb.getTask(projectId, task.parentTaskId);
        if (parent && !TERMINAL_STATUSES.has(parent.status)) {
          try {
            this.move(projectId, task.parentTaskId, 'done', actorThreadId, 'All subtasks completed.');
          } catch (err) {
            eventLogger.warn('kanban-service', 'Auto-close parent failed', {
              parentTaskId: task.parentTaskId,
              reason: getErrorMessage(err),
            });
          }
        }
      }
    }

    // Auto-unblock: remove this task as a blocker from all dependents.
    if (TERMINAL_STATUSES.has(newStatus)) {
      const dependents = kanbanDb.getDependents(projectId, taskId);
      for (const dependentId of dependents) {
        kanbanDb.removeDependency(projectId, dependentId, taskId);
        const remaining = kanbanDb.getDependencies(projectId, dependentId);
        if (remaining.length === 0) {
          kanbanDb.addNote(projectId, dependentId, `Unblocked: dependency on "${task.title}" resolved.`);
          const event: KanbanTaskUnblockedEvent = {
            taskId: dependentId,
            projectId,
            mainThreadId: kanbanDb.getTaskMainThreadId(projectId, dependentId),
            resolvedBlockerTitle: task.title,
          };
          kanbanEvents.emit('task:unblocked', event);
        }
      }
    }

    return updated;
  }

  updateDescription(projectId: string, taskId: string, description: string): void {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return;
    kanbanDb.updateTaskDescription(projectId, taskId, description);
    kanbanDb.addTaskEvent(projectId, taskId, 'updated', { field: 'description' });
  }

  updateProgress(projectId: string, taskId: string, progress: number, note?: string, threadId?: string): void {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return;
    kanbanDb.updateProgress(projectId, taskId, progress);
    kanbanDb.addTaskEvent(
      projectId,
      taskId,
      'progress',
      {
        previousProgress: task.progress,
        progress,
        note: note ?? null,
      },
      threadId
    );
    if (note) {
      kanbanDb.addNote(projectId, taskId, note, threadId);
    }
  }

  assignThread(projectId: string, taskId: string, threadId: string | null): KanbanTask | null {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return null;
    kanbanDb.assignTask(projectId, taskId, threadId);
    kanbanDb.addTaskEvent(
      projectId,
      taskId,
      'assigned',
      { previousThreadId: task.assignedThreadId, threadId },
      threadId ?? undefined
    );
    return kanbanDb.getTask(projectId, taskId);
  }

  updatePriority(projectId: string, taskId: string, priority: KanbanTask['priority']): KanbanTask | null {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return null;
    const updated = kanbanDb.updateTaskPriority(projectId, taskId, priority);
    if (updated) {
      kanbanDb.addTaskEvent(projectId, taskId, 'updated', {
        field: 'priority',
        previousPriority: task.priority,
        priority,
      });
    }
    return updated;
  }

  listSubtasks(projectId: string, parentTaskId: string): KanbanTask[] {
    return kanbanDb.listSubtasks(projectId, parentTaskId);
  }

  delete(projectId: string, taskId: string): void {
    const task = kanbanDb.getTask(projectId, taskId);
    if (task?.worktreePath) {
      // Fire-and-forget best-effort cleanup; the DB delete below is the source of truth.
      void worktreeWorkerClient.removeSessionWorktree(task.worktreePath).catch(() => {});
    }
    kanbanDb.deleteTask(projectId, taskId);
  }

  updateClassOfService(projectId: string, taskId: string, classOfService: KanbanClassOfService): KanbanTask | null {
    return kanbanDb.updateTaskClassOfService(projectId, taskId, classOfService);
  }

  setDueDate(projectId: string, taskId: string, dueAt: number | null): KanbanTask | null {
    return kanbanDb.setTaskDueDate(projectId, taskId, dueAt);
  }

  listOverdue(projectId: string): KanbanTask[] {
    return kanbanDb.listOverdueTasks(projectId);
  }

  patchMetadata(projectId: string, taskId: string, patch: Record<string, unknown>): KanbanTask | null {
    return kanbanDb.patchTaskMetadata(projectId, taskId, patch);
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  addNote(projectId: string, taskId: string, content: string, threadId?: string): KanbanTaskNote {
    const note = kanbanDb.addNote(projectId, taskId, content, threadId);
    kanbanDb.addTaskEvent(projectId, taskId, 'note', { noteId: note.id, content: note.content }, threadId);
    return note;
  }

  addReview(
    projectId: string,
    taskId: string,
    verdict: KanbanTaskReviewVerdict,
    summary?: string,
    threadId?: string
  ): void {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return;
    kanbanDb.addTaskEvent(projectId, taskId, 'review', { verdict, summary: summary ?? null }, threadId);

    if (verdict === 'changes_requested' && !TERMINAL_STATUSES.has(task.status)) {
      try {
        // Find the stage immediately before the current one so the task goes back to
        // the right column regardless of how stages are named or ordered.
        const stages = kanbanDb.listStages(projectId);
        const currentOrder = stages.find((s) => s.id === task.status)?.order ?? Infinity;
        const predecessor = stages
          .filter((s) => !TERMINAL_STATUSES.has(s.id) && s.order < currentOrder)
          .sort((a, b) => b.order - a.order)[0];
        const targetStatus = (predecessor?.id ?? 'implementing') as KanbanTaskStatus;
        this.move(projectId, taskId, targetStatus, threadId ?? null, `Changes requested: ${summary ?? 'see review'}`);
      } catch (err) {
        // WIP limit full or move failed — leave in current status rather than losing the review signal
        eventLogger.warn('kanban-service', 'Auto-reroute after changes_requested failed', {
          taskId,
          reason: getErrorMessage(err),
        });
      }
    }
    // Auto-progress on 'approved' is driven by the task's main thread via the kanban-orchestrator skill.
  }

  setBlocker(projectId: string, taskId: string, blocked: boolean, summary?: string, threadId?: string): void {
    const task = kanbanDb.getTask(projectId, taskId);
    if (!task) return;
    kanbanDb.addTaskEvent(projectId, taskId, 'blocker', { blocked, summary: summary ?? null }, threadId);
  }

  addDependency(projectId: string, taskId: string, blocksId: string): void {
    kanbanDb.addDependency(projectId, taskId, blocksId);
  }

  removeDependency(projectId: string, taskId: string, blocksId: string): void {
    kanbanDb.removeDependency(projectId, taskId, blocksId);
  }

  getBlockedTasks(projectId: string): KanbanTask[] {
    return kanbanDb.getBlockedTasksFromDb(projectId);
  }

  deleteNote(projectId: string, eventId: string): void {
    kanbanDb.deleteNoteEvent(projectId, eventId);
  }

  editNote(projectId: string, eventId: string, newText: string): KanbanTaskEvent | null {
    return kanbanDb.editNoteEvent(projectId, eventId, newText);
  }

  getNotes(projectId: string, taskId: string): KanbanTaskNote[] {
    return kanbanDb.getNotes(projectId, taskId);
  }

  listEvents(projectId: string, taskId: string): KanbanTaskEvent[] {
    return kanbanDb.listTaskEvents(projectId, taskId);
  }

  // ── Stages ─────────────────────────────────────────────────────────────────

  listStages(projectId: string): KanbanStage[] {
    return kanbanDb.ensureDefaultStages(projectId);
  }

  updateStage(projectId: string, stage: KanbanStage): void {
    kanbanDb.upsertStage(projectId, stage);
  }

  // A stage worker's label/role (`stage-<id>`) is frozen at spawn and never migrated, so a
  // worker that outlives its stage renders as a phantom stage on the board and may still fire
  // report_stage_result for a stage that no longer exists. Block rename/delete while such a
  // worker is live. "Live" = running, or still its task's assignedThreadId (covers a hung or
  // just-settled worker whose assignment hasn't been cleared yet — the status-only check missed
  // these).
  private assertStageNotInUse(projectId: string, stageId: string, verb: 'rename' | 'delete'): void {
    const role = `stage-${stageId}`;
    const worker = threadStore.getThreadsByProject(projectId).find((t) => {
      if (t.agentRole !== role) return false;
      if (t.status === 'running') return true;
      return !!t.taskId && kanbanDb.getTask(projectId, t.taskId)?.assignedThreadId === t.id;
    });
    if (worker) {
      throw new Error(
        `Cannot ${verb} stage "${stageId}" while a stage worker is assigned (thread ${worker.id}). Stop the worker first.`
      );
    }
  }

  renameStage(projectId: string, oldId: string, newId: string, overrides?: Partial<KanbanStage>): void {
    this.assertStageNotInUse(projectId, oldId, 'rename');
    kanbanDb.renameStage(projectId, oldId, newId, overrides);
  }

  deleteStage(projectId: string, stageId: string): void {
    this.assertStageNotInUse(projectId, stageId, 'delete');
    kanbanDb.deleteStage(projectId, stageId);
  }

  // ── WIP limits ─────────────────────────────────────────────────────────────

  getWipLimits(projectId: string): KanbanWipLimit[] {
    return kanbanDb.getWipLimits(projectId);
  }

  setWipLimit(projectId: string, status: KanbanTaskStatus, maxTasks: number): void {
    kanbanDb.setWipLimit(projectId, status, maxTasks);
  }

  // ── CFD ────────────────────────────────────────────────────────────────────

  getCfdData(projectId: string, days: number): CfdSnapshot[] {
    return kanbanDb.getCfdData(projectId, days);
  }
}

export const kanbanService = new KanbanService();
