import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type { SaveProjectRequest, ProjectConfigOpenResult, ProjectConfig } from '../../../shared/types';
import { threadManager, threadLifecycle } from '../../sessions/ThreadManager';
import {
  ensureProjectConfig,
  loadProjectConfig,
  updateProjectConfig,
  PROJECT_CONFIG_KEYS,
} from '../../config/projectConfig';
import { slackBridge } from '../../integrations/slackBridge';
import { listProjects, saveProject, deleteProject } from '../../sessions/containerProjectManager';
import * as threadStore from '../../threads/threadStore';
import { analyticsService } from '../../analytics/service';
import { deleteProjectDb } from '../../memory/db';
import { getErrorMessage } from '../../../shared/utils/errorMessage';
import { eventLogger } from '../../utils/eventLog';
import { filePath, shortName, ProjectIdSchema } from './schemas';
import { handleIpc } from '../ipcResponse';
import {
  broadcastProjectSaved,
  broadcastProjectDeleted,
  broadcastProjectConfigUpdated,
} from '../../sessions/broadcaster';
import { automationService } from '../../automations/service';
import { syncPersonalityRefresh } from '../../personality/automation';
import { getProjectByPath } from '../../threads/db';

const SaveProjectSchema: z.ZodType<SaveProjectRequest> = z.object({
  path: filePath,
  name: shortName.optional(),
});

const ProjectPathSchema = z.object({ projectPath: filePath });

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, () => handleIpc(() => listProjects()));

  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (e, raw) =>
    handleIpc(() => {
      const req = SaveProjectSchema.parse(raw);
      const project = saveProject(req.path, req.name);
      broadcastProjectSaved(project, e.sender);
      return project;
    })
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, (e, raw) =>
    handleIpc(() => {
      const { projectId } = ProjectIdSchema.parse(raw);
      // Cascade first: stop any scheduled automation from firing mid-delete
      // and hitting a half-torn-down project.
      automationService.removeByProjectId(projectId, 'project-deleted');
      // Cascade: delete all threads belonging to this project
      const threads = threadStore.getThreadsByProject(projectId);
      const failedThreadIds: string[] = [];
      for (const thread of threads) {
        try {
          threadLifecycle.deleteThread(thread.id);
        } catch (err) {
          eventLogger.warn('project', 'Failed to delete thread during project delete', {
            threadId: thread.id,
            error: getErrorMessage(err),
          });
          failedThreadIds.push(thread.id);
        }
      }
      // Cascade: delete project-level analytics data and memory DB
      analyticsService.deleteProjectAnalytics(projectId);
      deleteProjectDb(projectId);
      deleteProject(projectId);
      broadcastProjectDeleted(projectId, e.sender);
      eventLogger.info('project', 'Project deleted', { projectId, failedThreadCount: failedThreadIds.length });
      return failedThreadIds.length > 0 ? { failedThreadIds } : undefined;
    })
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_CONFIG, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath } = ProjectPathSchema.parse(raw);
      const result = await threadManager.getProjectConfig(projectPath);
      if (result.warnings.length > 0) {
        eventLogger.warn('config', 'Project config warnings on load', { projectPath, warnings: result.warnings });
      }
      return result;
    })
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE_CONFIG, (e, raw) =>
    handleIpc(async () => {
      const { projectPath, key, updates } = z
        .object({ projectPath: filePath, key: z.enum(PROJECT_CONFIG_KEYS), updates: z.record(z.string(), z.unknown()) })
        .parse(raw);
      await updateProjectConfig(projectPath, key as keyof ProjectConfig, updates);
      if (key === 'personality') {
        const project = getProjectByPath(projectPath);
        if (project) {
          // Read the post-update config as the source of truth — the patch
          // may be partial (e.g. only agentStyle) and doesn't carry the full
          // personality state needed to decide whether to sync the cron job.
          const { config } = await loadProjectConfig(projectPath);
          const enable = !!config?.personality;
          syncPersonalityRefresh(project.id, enable);
        }
      }
      broadcastProjectConfigUpdated(projectPath, key, e.sender);
    })
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_INIT_CONFIG, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath } = ProjectPathSchema.parse(raw);
      const result = await ensureProjectConfig(projectPath);
      return {
        created: result.created,
        lookup: {
          config: result.lookup.config,
          exists: result.lookup.exists,
          path: result.lookup.path,
          warnings: result.lookup.warnings,
        },
      };
    })
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN_CONFIG, (_e, raw) =>
    handleIpc(async (): Promise<ProjectConfigOpenResult> => {
      const { projectPath } = ProjectPathSchema.parse(raw);
      const result = await ensureProjectConfig(projectPath);
      const openError = await shell.openPath(result.lookup.path);
      if (openError) {
        return { ok: false, error: openError };
      }
      return { ok: true };
    })
  );

  ipcMain.handle(IPC_CHANNELS.SLACK_LIST_CHANNELS, () => handleIpc(() => slackBridge.listDiscoverableChannels()));
}
