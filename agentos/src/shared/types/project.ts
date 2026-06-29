// `ProjectConfig` / `ProjectMemoryConfig` are inferred from the canonical schema
// (single source of truth) — see src/shared/config/schema.ts.
export type { ProjectConfig, ProjectMemoryConfig } from '../config/schema';

/** Deep-partial that leaves arrays (e.g. providerOrder) intact rather than partialising their elements. */
export type DeepPartial<T> = T extends (infer _U)[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

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
