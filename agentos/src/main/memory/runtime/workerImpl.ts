import { loadProjectConfigSync } from '../../config/projectConfig';
import type { AppSettings, SavedProject } from '../../../shared/types';
import type { MemoryRuntime, RuntimeThread, LogLevel } from '../runtime';

export interface WorkerRuntimeBridge {
  sendEvent: (channel: string, payload: unknown) => void;
}

export interface WorkerRuntimeSnapshot {
  settings: AppSettings;
  projects: SavedProject[];
  threads: RuntimeThread[];
}

export interface WorkerMemoryRuntime extends MemoryRuntime {
  applySettings(next: AppSettings): void;
  applyProjects(next: SavedProject[]): void;
  applyThreads(next: RuntimeThread[]): void;
}

export function createWorkerMemoryRuntime(
  initial: WorkerRuntimeSnapshot,
  bridge: WorkerRuntimeBridge
): WorkerMemoryRuntime {
  let settings = initial.settings;
  let projects = initial.projects;
  let threads = initial.threads;
  const settingsListeners = new Set<(s: AppSettings) => void>();

  const projectsById = new Map<string, SavedProject>();
  const threadsById = new Map<string, RuntimeThread>();
  const threadsByProject = new Map<string, RuntimeThread[]>();

  const rebuildProjectIndex = (): void => {
    projectsById.clear();
    for (const p of projects) projectsById.set(p.id, p);
  };
  const rebuildThreadIndex = (): void => {
    threadsById.clear();
    threadsByProject.clear();
    for (const t of threads) {
      threadsById.set(t.id, t);
      const arr = threadsByProject.get(t.projectId) ?? [];
      arr.push(t);
      threadsByProject.set(t.projectId, arr);
    }
  };

  rebuildProjectIndex();
  rebuildThreadIndex();

  return {
    getSettings: () => settings,
    onSettingsChange: (cb) => {
      settingsListeners.add(cb);
      return () => {
        settingsListeners.delete(cb);
      };
    },
    getProjects: () => projects,
    getProject: (id) => projectsById.get(id) ?? null,
    getThread: (id) => threadsById.get(id) ?? null,
    getThreadsByProject: (projectId) => threadsByProject.get(projectId) ?? [],
    getAllThreads: () => threads,
    loadProjectConfigSync: (p) => loadProjectConfigSync(p),
    broadcastEvent: (channel, payload) => bridge.sendEvent(channel, payload),
    log: (level: LogLevel, subsystem, msg, meta) => bridge.sendEvent('runtime:log', { level, subsystem, msg, meta }),
    applySettings: (next) => {
      settings = next;
      for (const cb of settingsListeners) {
        try {
          cb(next);
        } catch {
          /* one listener throwing must not block the rest */
        }
      }
    },
    applyProjects: (next) => {
      projects = next;
      rebuildProjectIndex();
    },
    applyThreads: (next) => {
      threads = next;
      rebuildThreadIndex();
    },
  };
}
