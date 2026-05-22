import { promises as fsPromises } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type { Thread, CreateThreadRequest } from '../../shared/types';
import { getEffectiveWorktreeSettings } from '../../shared/effectiveProjectSettings';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import {
  getPrimaryProviderEntry,
  resolveEffectiveEffort,
  resolveEffectiveModel,
  resolveEffectiveReasoning,
} from '../utils/providerConfig';
import { createSessionWorktree, removeSessionWorktree } from '../utils/worktree';
import { eventLogger } from '../utils/eventLog';
import { loadProjectConfig } from '../config/projectConfig';
import { integrationContextManager } from '../integrations/IntegrationContextManager';
import { analyticsService } from '../analytics/service';
import { saveProject as saveProjectFn, touchProject as touchProjectFn } from './containerProjectManager';
import { broadcastThreadCreated, broadcastThreadDeleted } from './broadcaster';
import type { ThreadOutputManager } from './threadOutput';
import type { ThreadStateService } from './ThreadStateService';

export class ThreadFactory {
  constructor(
    private readonly output: ThreadOutputManager,
    private readonly getSessDataDir: () => string,
    private readonly teardownRuntime: (threadId: string, reason: string) => void,
    private readonly stateService: ThreadStateService
  ) {}

  async createThread(req: CreateThreadRequest): Promise<Thread> {
    const store = getStore();
    const id = nanoid();
    const now = Date.now();
    const callerManagedWorktree = req.projectPath != null && req.projectPath !== req.workingDirectory;
    const projectPath = req.projectPath ?? req.workingDirectory;
    const project = saveProjectFn(projectPath, req.projectName);
    const projectConfigResult = await loadProjectConfig(projectPath);
    const settings = store.get('settings');
    const primaryEntry = getPrimaryProviderEntry(settings, projectConfigResult.config);
    const provider = req.provider ?? primaryEntry.provider;
    const model = req.model ?? resolveEffectiveModel(provider, undefined, projectConfigResult.config, settings);
    const effort =
      provider === 'claude' ? (req.effort ?? resolveEffectiveEffort(projectConfigResult.config, settings)) : undefined;
    const reasoning =
      provider === 'codex'
        ? (req.reasoning ?? resolveEffectiveReasoning(projectConfigResult.config, settings))
        : undefined;

    let workingDirectory = callerManagedWorktree ? req.workingDirectory : projectPath;
    let usingWorktree = callerManagedWorktree;
    if (!callerManagedWorktree) {
      const effectiveWorktree = getEffectiveWorktreeSettings(settings, projectConfigResult.config);
      if (effectiveWorktree.autoCreate) {
        const worktreePath = await createSessionWorktree(projectPath, req.name, id);
        if (worktreePath) {
          workingDirectory = worktreePath;
          usingWorktree = true;
        }
      }
    }

    touchProjectFn(projectPath);

    const thread: Omit<Thread, 'logBuffer'> = {
      id,
      name: req.name,
      projectId: project.id,
      workingDirectory,
      projectPath,
      usingWorktree,
      provider,
      model,
      effort,
      reasoning,
      status: 'stopped',
      createdAt: now,
      lastActiveAt: now,
      queueDepth: 0,
      promptHistory: [],
      autopilotEnabled: false,
      autopilotState: 'idle',
      autopilotConsecutiveTurns: 0,
    };

    threadStore.saveThread({ ...thread, promptHistory: [] });
    this.output.initLogBuffer(id);
    eventLogger.info('thread', `Thread created: ${req.name}`, {
      threadId: id,
      provider: thread.provider,
      projectId: thread.projectId,
      projectPath,
      usingWorktree,
      projectConfigPath: projectConfigResult.path,
      projectConfigExists: projectConfigResult.exists,
      projectConfigWarnings: projectConfigResult.warnings,
    });

    broadcastThreadCreated({ ...thread, logBuffer: [] });
    return { ...thread, logBuffer: [] };
  }

  deleteThread(threadId: string): void {
    this.teardownRuntime(threadId, 'Thread deleted while waiting for command completion');
    const thread = threadStore.getThread(threadId);
    this.cleanupWorktree(thread);
    threadStore.deleteThread(threadId);
    this.output.deleteThreadFiles(threadId);
    // Fire-and-forget: DB row is already deleted and broadcast sent; errors are logged not thrown.
    void fsPromises
      .rm(path.join(this.getSessDataDir(), threadId), { recursive: true, force: true })
      .catch((err: unknown) =>
        eventLogger.warn('thread', 'Session data cleanup failed', { threadId, error: String(err) })
      );
    integrationContextManager.clearAll(threadId);
    analyticsService.deleteThreadAnalytics(threadId);
    broadcastThreadDeleted(threadId);
    eventLogger.info('thread', `Thread deleted: ${threadId}`, { threadId });
  }

  archiveThread(threadId: string): void {
    this.teardownRuntime(threadId, 'Thread archived while waiting for command completion');
    const thread = threadStore.getThread(threadId);
    this.cleanupWorktree(thread);
    if (thread) {
      this.stateService.setArchived(threadId);
    }
    eventLogger.info('thread', `Thread archived: ${threadId}`, { threadId });
  }

  private cleanupWorktree(thread: Omit<Thread, 'logBuffer'> | undefined): void {
    if (thread?.usingWorktree && thread.workingDirectory) {
      removeSessionWorktree(thread.workingDirectory);
    }
  }
}
