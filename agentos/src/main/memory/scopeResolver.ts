import path from 'path';
import {
  runtimeSettings,
  runtimeProject,
  runtimeThread,
  runtimeThreadsByProject,
  runtimeProjectConfigSync,
} from './runtime';
import type { SyncScope } from './sync/core';

export function resolveSyncScope(
  projectId: string | null | undefined,
  threadId: string | null | undefined,
  homeDir: string
): SyncScope {
  const settings = runtimeSettings();
  const targetThread = threadId ? runtimeThread(threadId) : null;
  const resolvedProjectId = projectId?.trim() || targetThread?.projectId;
  if (!resolvedProjectId) throw new Error('AgentOS memory requires a projectId or threadId.');
  const projectPath = runtimeProject(resolvedProjectId)?.path ?? null;
  return {
    projectId: resolvedProjectId,
    projectPath,
    memoryRootPath: settings.memory?.rootPath ?? path.join(homeDir, '.agentos', 'memory', 'projects'),
    threads: runtimeThreadsByProject(resolvedProjectId),
    extraMemoryPaths: [
      ...(settings.memory?.extraPaths ?? []),
      ...(projectPath ? (runtimeProjectConfigSync(projectPath)?.memory?.extraPaths ?? []) : []),
    ],
  };
}
