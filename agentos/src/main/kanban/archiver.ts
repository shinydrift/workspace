import { getAllProjects } from '../threads/db';
import { listTasksDoneOlderThan } from './db';
import { kanbanService } from './service';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

const ARCHIVE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function archiveOldDoneTasks(): void {
  const cutoff = Date.now() - ARCHIVE_AFTER_MS;
  for (const project of getAllProjects()) {
    try {
      const tasks = listTasksDoneOlderThan(project.id, cutoff);
      for (const task of tasks) {
        try {
          kanbanService.move(project.id, task.id, 'archived', null, 'Auto-archived after 5 days in done.');
          eventLogger.info('kanban-archiver', 'Auto-archived task', { taskId: task.id, projectId: project.id });
        } catch (err) {
          eventLogger.warn('kanban-archiver', 'Failed to archive task', {
            taskId: task.id,
            projectId: project.id,
            error: getErrorMessage(err),
          });
        }
      }
    } catch (err) {
      eventLogger.warn('kanban-archiver', 'Failed to check project for stale done tasks', {
        projectId: project.id,
        error: getErrorMessage(err),
      });
    }
  }
}

export function startKanbanArchiver(): () => void {
  archiveOldDoneTasks();
  const timer = setInterval(archiveOldDoneTasks, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
