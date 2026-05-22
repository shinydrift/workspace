import path from 'path';
import { getStore } from '../store/index';
import { getProject } from '../threads/db';
import * as threadStore from '../threads/threadStore';
import { loadProjectConfigSync } from '../config/projectConfig';
import type { SyncScope } from './sync/core';

export function resolveSyncScope(
  projectId: string | null | undefined,
  threadId: string | null | undefined,
  homeDir: string
): SyncScope {
  const settings = getStore().get('settings');
  const targetThread = threadId ? threadStore.getThread(threadId) : undefined;
  const resolvedProjectId = projectId?.trim() || targetThread?.projectId;
  if (!resolvedProjectId) throw new Error('AgentOS memory requires a projectId or threadId.');
  const projectPath = getProject(resolvedProjectId)?.path ?? null;
  return {
    projectId: resolvedProjectId,
    projectPath,
    memoryRootPath: settings.memoryRootPath ?? path.join(homeDir, '.agentos', 'memory', 'projects'),
    threads: threadStore.getThreadsByProject(resolvedProjectId),
    extraMemoryPaths: [
      ...(settings.extraMemoryPaths ?? []),
      ...(projectPath ? (loadProjectConfigSync(projectPath)?.memory?.extraPaths ?? []) : []),
    ],
  };
}
