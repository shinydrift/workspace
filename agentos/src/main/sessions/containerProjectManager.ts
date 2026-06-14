import path from 'path';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { app } from 'electron';
import { nanoid } from 'nanoid';
import { computeContainerConfigHash, shouldPruneContainer } from '../utils/docker';
import { inspectContainer, removeContainer as removeDockerContainer } from '../utils/dockerCleanup';
import {
  readContainerRegistry,
  removeContainerRegistryEntry,
  touchContainerRegistryEntry,
} from '../utils/containerRegistry';
import { loadProjectConfig } from '../config/projectConfig';
import { resolveInjectionPayload } from '../utils/memoryInjection';
import { eventLogger } from '../utils/eventLog';
import { getStore } from '../store/index';
import {
  getProject,
  getProjectByPath,
  getAllProjects,
  saveProjectToDb,
  updateProjectLastUsed,
  deleteProjectFromDb,
} from '../threads/db';
import * as threadStore from '../threads/threadStore';
import { PROVIDER_CONFIGS } from '../utils/providerConfig';
import type { Thread, SavedProject, ContainerSummary, AppSettings, Provider } from '../../shared/types';
import { getEffectiveContainerPruneSettings } from '../../shared/effectiveProjectSettings';

// ---------------------------------------------------------------------------
// Container pruning
// ---------------------------------------------------------------------------

export async function pruneContainersIfNeeded(
  lastPruneAtMs: number,
  opts?: { force?: boolean }
): Promise<{ pruned: string[]; errors: string[]; newLastPruneAt: number }> {
  const settings = getStore().get('settings');
  const threadsArr = threadStore.getAllThreads();
  const threads = Object.fromEntries(threadsArr.map((t) => [t.id, t]));
  const now = Date.now();

  if (!opts?.force && now - lastPruneAtMs < 5 * 60 * 1000) {
    return { pruned: [], errors: [], newLastPruneAt: lastPruneAtMs };
  }

  const registry = await readContainerRegistry();
  const pruned: string[] = [];
  const errors: string[] = [];

  for (const entry of registry.entries) {
    const thread = threads[entry.threadId];
    const projectRootPath = thread?.projectPath ?? thread?.workingDirectory;
    const projectConfigResult = projectRootPath ? await loadProjectConfig(projectRootPath) : null;
    const pruneSettings = getEffectiveContainerPruneSettings(settings, projectConfigResult?.config ?? null);
    if (pruneSettings.idleHours === 0 && pruneSettings.maxAgeDays === 0) {
      continue;
    }
    if (!shouldPruneContainer(entry, now, pruneSettings.idleHours, pruneSettings.maxAgeDays)) {
      continue;
    }
    try {
      await removeDockerContainer(entry.containerName);
      pruned.push(entry.containerName);
    } catch (error) {
      const message = getErrorMessage(error);
      errors.push(`${entry.containerName}: ${message}`);
    } finally {
      await removeContainerRegistryEntry(entry.containerName).catch((err) => {
        eventLogger.warn('project', 'failed to remove registry entry', { error: String(err) });
      });
    }
  }

  if (pruned.length > 0 || errors.length > 0) {
    eventLogger.info('docker', 'Container prune completed', {
      prunedCount: pruned.length,
      errorCount: errors.length,
    });
  }

  return { pruned, errors, newLastPruneAt: now };
}

export async function removeContainerByName(containerName: string): Promise<void> {
  await removeDockerContainer(containerName).catch((err) => {
    eventLogger.warn('project', 'failed to remove docker container', { error: String(err) });
  });
  await removeContainerRegistryEntry(containerName).catch((err) => {
    eventLogger.warn('project', 'failed to remove registry entry', { error: String(err) });
  });
}

// ---------------------------------------------------------------------------
// Container summaries
// ---------------------------------------------------------------------------

function resolveProviderArgs(provider: Provider, settings: AppSettings): string[] {
  if (PROVIDER_CONFIGS[provider].supportsHeadless) return [];
  if (provider !== 'claude') return [];
  const useClaudeStreamJson = settings.claudeStreamJson ?? true;
  const skipPermissions = settings.skipPermissions ?? true;
  return [
    ...(useClaudeStreamJson ? ['--output-format', 'stream-json'] : []),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
  ];
}

export async function listContainerSummaries(): Promise<ContainerSummary[]> {
  const settings = getStore().get('settings');
  const registry = await readContainerRegistry();

  const summaries = await Promise.all(
    registry.entries.map(async (entry) => {
      const state = await inspectContainer(entry.containerName);
      const thread = threadStore.getThread(entry.threadId);
      const project = thread?.projectId ? getProject(thread.projectId) : undefined;
      const expectedImage = state.image ?? entry.image;
      const provider = thread?.provider ?? 'claude';
      const providerArgs = resolveProviderArgs(provider, settings);
      const projectRootPath = thread?.projectPath ?? project?.path ?? thread?.workingDirectory;
      const projectConfigResult = projectRootPath ? await loadProjectConfig(projectRootPath) : null;
      const bootEnabled = true;
      const effectiveSandbox = {
        ...(settings.sandbox ?? {}),
        ...(projectConfigResult?.config?.sandbox ?? {}),
      };
      const effectiveMemoryRootPath =
        settings.memory?.rootPath ?? path.join(app.getPath('home'), '.agentos', 'memory', 'projects');
      const injection = thread?.projectId
        ? await resolveInjectionPayload(effectiveMemoryRootPath, thread.projectId, { bootEnabled })
        : null;
      const extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }> = [];
      if (injection?.projectMemoryPath) {
        extraReadonlyMounts.push({ hostPath: injection.projectMemoryPath, containerPath: '/agentos-memory' });
      }
      const expectedConfigHash = thread
        ? computeContainerConfigHash({
            threadId: entry.threadId,
            workingDirectory: thread.workingDirectory,
            imageName: expectedImage,
            provider,
            sandbox: effectiveSandbox,
            providerArgs,
            extraReadonlyMounts,
            dockerfileHash: project?.dockerfileHash,
          })
        : null;
      const currentConfigHash = state.labels['agentos.configHash'] ?? entry.configHash ?? null;
      return {
        containerName: entry.containerName,
        threadId: entry.threadId,
        createdAtMs: entry.createdAtMs,
        lastUsedAtMs: entry.lastUsedAtMs,
        image: state.image ?? entry.image,
        running: state.running,
        exists: state.exists,
        imageMatch: (state.image ?? entry.image) === entry.image,
        currentConfigHash,
        expectedConfigHash,
        drift: Boolean(expectedConfigHash && currentConfigHash && expectedConfigHash !== currentConfigHash),
        orphaned: !thread,
      } satisfies ContainerSummary;
    })
  );

  return summaries.sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);
}

export async function touchContainerFromActivity(
  lastRegistryTouchByThread: Map<string, number>,
  threadId: string,
  force = false
): Promise<void> {
  const now = Date.now();
  const last = lastRegistryTouchByThread.get(threadId) ?? 0;
  if (!force && now - last < 60_000) return;
  lastRegistryTouchByThread.set(threadId, now);
  await touchContainerRegistryEntry(`agentos-session-${threadId}`, now).catch((err) => {
    eventLogger.warn('project', 'failed to touch container registry', { error: String(err) });
  });
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

export function saveProject(pathValue: string, name?: string): SavedProject {
  const now = Date.now();
  const existing = getProjectByPath(pathValue);
  if (existing) {
    const updated: SavedProject = {
      ...existing,
      name: name?.trim() || existing.name,
      lastUsedAt: now,
    };
    saveProjectToDb(updated);
    return updated;
  }

  const id = nanoid();
  const saved: SavedProject = {
    id,
    name: name?.trim() || path.basename(pathValue),
    path: pathValue,
    createdAt: now,
    lastUsedAt: now,
  };
  saveProjectToDb(saved);
  return saved;
}

export function listProjects(): SavedProject[] {
  return getAllProjects();
}

export function deleteProject(projectId: string): void {
  deleteProjectFromDb(projectId);
}

export function touchProject(pathValue: string): void {
  const existing = getProjectByPath(pathValue);
  if (!existing) return;
  updateProjectLastUsed(existing.id);
}

export function pruneOrphanProjects(threads: Record<string, Omit<Thread, 'pid' | 'logBuffer'>>): void {
  const referencedProjectIds = new Set(Object.values(threads).map((thread) => thread.projectId));
  const referencedPaths = new Set(
    Object.values(threads).map((thread) => thread.projectPath ?? thread.workingDirectory)
  );

  let removed = 0;
  for (const project of getAllProjects()) {
    const keep = referencedProjectIds.has(project.id) || referencedPaths.has(project.path);
    if (!keep) {
      deleteProjectFromDb(project.id);
      removed += 1;
    }
  }
  if (removed > 0) {
    eventLogger.info('thread', 'Pruned orphan projects from store', { removed });
  }
}
