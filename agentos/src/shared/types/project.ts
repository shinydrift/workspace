import type { BaseConfig, MemoryConfig, PersonalitySettings } from './settings';

/** Deep-partial that leaves arrays (e.g. providerOrder) intact rather than partialising their elements. */
export type DeepPartial<T> = T extends (infer _U)[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Memory fields a project may override. Excludes app-only settings (the memory root
 * path and embedding provider/model) — those are global and not honoured per-project,
 * so the type does not advertise them as overridable.
 */
export type ProjectMemoryConfig = Omit<
  MemoryConfig,
  'rootPath' | 'embeddingProvider' | 'embeddingModel' | 'localModelPath'
>;

/**
 * Per-project overrides. Inherits the app's `BaseConfig` surface as a deep-partial
 * (every overridable key optional, same names/structure as `AppSettings`) and adds
 * project-only fields. `memory` is narrowed to the project-overridable subset.
 */
export type ProjectConfig = DeepPartial<Omit<BaseConfig, 'memory'>> & {
  memory?: DeepPartial<ProjectMemoryConfig>;
  version?: 1;
  kanban?: {
    enabled?: boolean;
    stages?: Record<string, { prompt?: string }>;
  };
  personality?: PersonalitySettings;
};

export interface SavedProject {
  id: string;
  name: string;
  path: string;
  /**
   * Optional repo-root-relative working directory. When set, the repo root (`path`)
   * is still mounted as the project root, but the agent runs inside this subdirectory —
   * lets one monorepo back several projects/Slack channels scoped to different packages.
   */
  subdir?: string;
  createdAt: number;
  lastUsedAt: number;
  dockerfileHash?: string;
}
