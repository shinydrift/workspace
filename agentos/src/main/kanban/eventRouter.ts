import * as threadStore from '../threads/threadStore';
import { kanbanEvents, kanbanService } from './service';
import * as kanbanDb from './db';
import { TERMINAL_STATUSES, BACKLOG_STATUS } from './db';
import { createMainThread } from './taskMain';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type {
  KanbanTask,
  KanbanTaskCreatedEvent,
  KanbanTaskMovedEvent,
  KanbanTaskUnblockedEvent,
} from '../../shared/types/kanban';

// Injected at startup — avoids circular dep with ThreadManager
type SendInputFn = (threadId: string, input: string, source: string) => Promise<void>;
type SaveToMemoryFn = (projectId: string, task: KanbanTask) => Promise<void>;

class KanbanEventRouter {
  private sendInput: SendInputFn | null = null;
  private saveToMemoryFn: SaveToMemoryFn | null = null;

  init(callbacks: { sendInput: SendInputFn; saveToMemory?: SaveToMemoryFn }): void {
    if (this.sendInput) return; // idempotent
    this.sendInput = callbacks.sendInput;
    this.saveToMemoryFn = callbacks.saveToMemory ?? null;
    kanbanEvents.on('task:moved', (event: KanbanTaskMovedEvent) => {
      void this.onTaskMoved(event);
    });
    kanbanEvents.on('task:created', (event: KanbanTaskCreatedEvent) => {
      void this.onTaskCreated(event);
    });
    kanbanEvents.on('task:unblocked', (event: KanbanTaskUnblockedEvent) => {
      void this.onTaskUnblocked(event);
    });
  }

  private async onTaskCreated(event: KanbanTaskCreatedEvent): Promise<void> {
    const { task } = event;
    // Skip terminal tasks (created as done/archived), backlog tasks (no worker until
    // manually moved out), and tasks that already have an orchestrator.
    if (TERMINAL_STATUSES.has(task.status) || task.status === BACKLOG_STATUS || task.mainThreadId != null) return;
    try {
      await createMainThread(event.projectId, task);
    } catch (err) {
      eventLogger.error('kanban-router', 'Failed to create main thread for task', {
        taskId: task.id,
        projectId: event.projectId,
        error: getErrorMessage(err),
      });
    }
  }

  private async onTaskMoved(event: KanbanTaskMovedEvent): Promise<void> {
    const { task, fromStatus, toStatus, actorThreadId } = event;

    // When a backlog task is moved to an active stage for the first time, spawn its main thread.
    if (fromStatus === BACKLOG_STATUS && !TERMINAL_STATUSES.has(toStatus) && task.mainThreadId == null) {
      try {
        await createMainThread(event.projectId, task);
      } catch (err) {
        eventLogger.error('kanban-router', 'Failed to create main thread on backlog exit', {
          taskId: task.id,
          projectId: event.projectId,
          error: getErrorMessage(err),
        });
      }
    }

    // Look up the destination stage for research report saving
    const stage = kanbanDb.getStageByStatus(event.projectId, toStatus);

    const saveReport =
      this.saveToMemoryFn && stage?.saveToMemory
        ? this.saveToMemoryFn(event.projectId, task).catch((err: unknown) => {
            eventLogger.error('kanban-router', 'Failed to save task output to memory', {
              taskId: task.id,
              error: getErrorMessage(err),
            });
            try {
              kanbanService.addNote(
                event.projectId,
                task.id,
                `Task output could not be saved to memory (${getErrorMessage(err)}). Retrieve it from task notes manually.`
              );
            } catch {
              /* best-effort */
            }
          })
        : Promise.resolve();

    // Notify the main thread of external moves (e.g. human drag-and-drop). The main
    // thread uses this to decide whether to spawn a worker for the new stage.
    // Skip self-notification when the main thread itself initiated the move — it
    // already knows and the extra turn wastes context.
    const selfMove = actorThreadId !== null && actorThreadId === task.mainThreadId;
    const notifyMain =
      !selfMove && task.mainThreadId && this.isThreadRunning(task.mainThreadId) && this.sendInput
        ? (() => {
            const message = [
              `[KANBAN EVENT] Task moved externally`,
              `task_id: ${task.id}`,
              `from: ${fromStatus} → to: ${toStatus}`,
            ].join('\n');
            return this.sendInput!(task.mainThreadId!, `${message}\n`, 'automation').catch((err: unknown) => {
              eventLogger.warn('kanban-router', 'Failed to notify main thread of task move', {
                taskId: task.id,
                threadId: task.mainThreadId,
                error: getErrorMessage(err),
              });
            });
          })()
        : Promise.resolve();

    await Promise.all([saveReport, notifyMain]);
  }

  private async onTaskUnblocked(event: KanbanTaskUnblockedEvent): Promise<void> {
    const { taskId, mainThreadId, resolvedBlockerTitle } = event;
    if (!mainThreadId || !this.sendInput) return;

    const thread = threadStore.getThread(mainThreadId);
    // Don't restart threads the user intentionally stopped or that are in an error state.
    if (!thread || thread.status === 'archived' || thread.status === 'error') return;

    // Use 'user' source so ThreadInputService restarts the thread's PTY if it exited
    // while waiting for the blocker to resolve (blockers can take days).
    const message = [
      `[KANBAN EVENT] Task unblocked`,
      `task_id: ${taskId}`,
      `reason: dependency on "${resolvedBlockerTitle}" is now complete. Call get_task to verify blockedBy is empty, then resume from step 1.`,
    ].join('\n');
    await this.sendInput(mainThreadId, `${message}\n`, 'user').catch((err: unknown) => {
      eventLogger.warn('kanban-router', 'Failed to notify main thread of task unblock', {
        taskId,
        threadId: mainThreadId,
        error: getErrorMessage(err),
      });
    });
  }

  /** Returns true only if the thread exists and is actively running (not stopped/idle/error/archived). */
  private isThreadRunning(threadId: string | null): boolean {
    if (!threadId) return false;
    const thread = threadStore.getThread(threadId);
    return !!thread && thread.status === 'running';
  }
}

export const kanbanEventRouter = new KanbanEventRouter();
