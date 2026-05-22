import { personalityRefreshJobId } from '../../shared/types';
import { getAllProjects, getAutomationJob } from '../threads/db';
import { loadProjectConfig } from '../config/projectConfig';
import { automationService } from '../automations/service';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

const CRON_SCHEDULE = '0 12 * * *';
const CATCH_UP_THRESHOLD_MS = 25 * 60 * 60 * 1000;

export function syncPersonalityRefresh(projectId: string, enable: boolean): void {
  const jobId = personalityRefreshJobId(projectId);
  if (!enable) {
    automationService.removeSystemJob(jobId, 'personality-disabled');
    return;
  }
  automationService.ensureSystemJob({
    id: jobId,
    name: 'Personality Refresh',
    projectId,
    trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: CRON_SCHEDULE } },
    instructions: '/personality-refresh',
    isSystem: true,
    enabled: true,
    deleteAfterRun: false,
  });
}

// Walk saved projects and align the hidden personality-refresh job with each project's config.
// Covers: stale state after an upgrade, manual store edits, config corruption, or app closed at noon.
export async function reconcilePersonalityRefresh(): Promise<void> {
  const projects = getAllProjects();
  await Promise.all(
    projects.map(async (project) => {
      try {
        const { config } = await loadProjectConfig(project.path);
        const enabled = !!config?.personality;
        const jobId = personalityRefreshJobId(project.id);
        const existing = getAutomationJob(jobId);
        if (!enabled && !existing) return;
        syncPersonalityRefresh(project.id, enabled);
        if (enabled) {
          const job = getAutomationJob(jobId);
          if (!job?.lastRunAt || Date.now() - job.lastRunAt > CATCH_UP_THRESHOLD_MS) {
            automationService.runNow(jobId).catch((err) =>
              eventLogger.warn('automation', 'Personality refresh catch-up failed', {
                projectId: project.id,
                error: getErrorMessage(err),
              })
            );
          }
        }
      } catch (err) {
        eventLogger.warn('automation', 'Personality refresh reconcile failed', {
          projectId: project.id,
          error: getErrorMessage(err),
        });
      }
    })
  );
}
