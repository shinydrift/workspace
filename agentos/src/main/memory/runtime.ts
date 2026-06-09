import type { AppSettings, SavedProject } from '../../shared/types';

export type RuntimeThread = { id: string; name: string; projectId: string };
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Minimal slice of ProjectConfig the memory subsystem reads. Keep it loose —
// scopeResolver only needs memory.extraPaths; search/engine.ts reads its own
// config from disk directly.
export type RuntimeProjectConfig = { memory?: { extraPaths?: string[] } } | null;

export interface MemoryRuntime {
  getSettings(): AppSettings;
  onSettingsChange(cb: (settings: AppSettings) => void): () => void;
  getProjects(): SavedProject[];
  getProject(id: string): SavedProject | null;
  getThread(id: string): RuntimeThread | null;
  getThreadsByProject(projectId: string): RuntimeThread[];
  getAllThreads(): RuntimeThread[];
  loadProjectConfigSync(projectPath: string): RuntimeProjectConfig;
  broadcastEvent(channel: string, payload: unknown): void;
  log(level: LogLevel, subsystem: string, msg: string, meta?: Record<string, unknown>): void;
}

let activeRuntime: MemoryRuntime | null = null;

export function installMemoryRuntime(impl: MemoryRuntime): void {
  activeRuntime = impl;
}

function rt(): MemoryRuntime {
  if (!activeRuntime) throw new Error('Memory runtime not installed. Call installMemoryRuntime() first.');
  return activeRuntime;
}

export const runtimeSettings = (): AppSettings => rt().getSettings();
export const runtimeOnSettingsChange = (cb: (s: AppSettings) => void): (() => void) => rt().onSettingsChange(cb);
export const runtimeProjects = (): SavedProject[] => rt().getProjects();
export const runtimeProject = (id: string): SavedProject | null => rt().getProject(id);
export const runtimeThread = (id: string): RuntimeThread | null => rt().getThread(id);
export const runtimeThreadsByProject = (id: string): RuntimeThread[] => rt().getThreadsByProject(id);
export const runtimeAllThreads = (): RuntimeThread[] => rt().getAllThreads();
export const runtimeProjectConfigSync = (p: string): RuntimeProjectConfig => rt().loadProjectConfigSync(p);
export const runtimeBroadcast = (channel: string, payload: unknown): void => rt().broadcastEvent(channel, payload);
export const runtimeLog = (level: LogLevel, subsystem: string, msg: string, meta?: Record<string, unknown>): void =>
  rt().log(level, subsystem, msg, meta);

export const runtimeLogger = {
  debug: (s: string, m: string, x?: Record<string, unknown>) => runtimeLog('debug', s, m, x),
  info: (s: string, m: string, x?: Record<string, unknown>) => runtimeLog('info', s, m, x),
  warn: (s: string, m: string, x?: Record<string, unknown>) => runtimeLog('warn', s, m, x),
  error: (s: string, m: string, x?: Record<string, unknown>) => runtimeLog('error', s, m, x),
};
