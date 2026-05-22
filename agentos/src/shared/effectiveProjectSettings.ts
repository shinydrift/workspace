import {
  DEFAULT_AUTOPILOT_SETTINGS,
  DEFAULT_CONTAINER_PRUNE_SETTINGS,
  DEFAULT_PROVIDER_ORDER,
  DEFAULT_WORKTREE_SETTINGS,
  PROVIDER_MODELS,
  normalizeProviderOrder,
  type AppSettings,
  type AutopilotSettings,
  type ClaudeEffort,
  type CodexReasoning,
  type ContainerPruneSettings,
  type ProjectConfig,
  type Provider,
  type ProviderBackend,
  type ProviderEntry,
  type WorktreeSettings,
} from './types';

export { DEFAULT_BACKEND } from './types';

export function getAppProviderOrder(settings: AppSettings): ProviderEntry[] {
  const normalized = normalizeProviderOrder(settings.providerOrder);
  return normalized.length > 0 ? normalized : [...DEFAULT_PROVIDER_ORDER];
}

export function getProjectProviderOrder(projectConfig?: ProjectConfig | null): ProviderEntry[] {
  return normalizeProviderOrder(projectConfig?.agents?.providerOrder);
}

export function getEffectiveProviderOrder(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): ProviderEntry[] {
  const projectOrder = getProjectProviderOrder(projectConfig);
  return projectOrder.length > 0 ? projectOrder : getAppProviderOrder(settings);
}

export function getEffectivePrimaryProviderEntry(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): ProviderEntry {
  return getEffectiveProviderOrder(settings, projectConfig)[0] ?? { provider: 'claude' };
}

export function getEffectivePrimaryProvider(settings: AppSettings, projectConfig?: ProjectConfig | null): Provider {
  return getEffectivePrimaryProviderEntry(settings, projectConfig).provider;
}

export function getEffectiveModelForProvider(
  provider: Provider,
  storedModel: string | undefined | null,
  projectConfig: ProjectConfig | null | undefined,
  settings: AppSettings
): string | undefined {
  const projectModel = getProjectProviderOrder(projectConfig).find((entry) => entry.provider === provider)?.model;
  if (projectModel) return projectModel;
  if (storedModel) return storedModel;
  return getAppProviderOrder(settings).find((entry) => entry.provider === provider)?.model;
}

// Precedence: project config > thread snapshot > app settings.
export function getEffectiveEffortForProvider(
  projectConfig: ProjectConfig | null | undefined,
  settings: AppSettings,
  storedEffort?: ClaudeEffort | null
): ClaudeEffort | undefined {
  const projectEffort = getProjectProviderOrder(projectConfig).find((e) => e.provider === 'claude')?.effort;
  if (projectEffort) return projectEffort;
  if (storedEffort) return storedEffort;
  return getAppProviderOrder(settings).find((e) => e.provider === 'claude')?.effort;
}

// Precedence: project config > app settings.
export function getEffectiveBackendForProvider(
  provider: Provider,
  projectConfig: ProjectConfig | null | undefined,
  settings: AppSettings
): ProviderBackend | undefined {
  const projectEntry = getProjectProviderOrder(projectConfig).find((e) => e.provider === provider);
  if (projectEntry?.backend) return projectEntry.backend;
  return getAppProviderOrder(settings).find((e) => e.provider === provider)?.backend;
}

// Precedence: project config > app settings.
export function getEffectiveBaseUrlForProvider(
  provider: Provider,
  projectConfig: ProjectConfig | null | undefined,
  settings: AppSettings
): string | undefined {
  const projectEntry = getProjectProviderOrder(projectConfig).find((e) => e.provider === provider);
  if (projectEntry?.baseUrl) return projectEntry.baseUrl;
  return getAppProviderOrder(settings).find((e) => e.provider === provider)?.baseUrl;
}

// Precedence: project config > thread snapshot > app settings.
export function getEffectiveReasoningForProvider(
  projectConfig: ProjectConfig | null | undefined,
  settings: AppSettings,
  storedReasoning?: CodexReasoning | null
): CodexReasoning | undefined {
  const projectReasoning = getProjectProviderOrder(projectConfig).find((e) => e.provider === 'codex')?.reasoning;
  if (projectReasoning) return projectReasoning;
  if (storedReasoning) return storedReasoning;
  return getAppProviderOrder(settings).find((e) => e.provider === 'codex')?.reasoning;
}

export function getEffectiveQueueSilenceFallbackMs(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): number {
  return Math.max(200, projectConfig?.agents?.queueSilenceFallbackMs ?? settings.queueSilenceFallbackMs ?? 1_500);
}

export function getEffectiveAutopilotSettings(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): AutopilotSettings {
  const app = { ...DEFAULT_AUTOPILOT_SETTINGS, ...(settings.autopilot ?? {}) };
  return {
    enabled: app.enabled,
    maxConsecutiveTurns: Math.max(
      1,
      Math.floor(projectConfig?.agents?.autopilotMaxConsecutiveTurns ?? app.maxConsecutiveTurns)
    ),
    transcriptMessages: Math.max(
      1,
      Math.floor(projectConfig?.agents?.autopilotTranscriptMessages ?? app.transcriptMessages)
    ),
    plannerProvider: projectConfig?.agents?.autopilotPlannerProvider ?? app.plannerProvider,
    plannerModel: (() => {
      const provider = projectConfig?.agents?.autopilotPlannerProvider ?? app.plannerProvider;
      const model = projectConfig?.agents?.autopilotPlannerModel ?? app.plannerModel;
      return provider && model && PROVIDER_MODELS[provider]?.includes(model) ? model : undefined;
    })(),
  };
}

export function getEffectiveWorktreeSettings(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): WorktreeSettings {
  const app = { ...DEFAULT_WORKTREE_SETTINGS, ...(settings.worktrees ?? {}) };
  return {
    autoCreate: projectConfig?.worktree?.autoCreate ?? app.autoCreate,
    pruneOnStop: projectConfig?.worktree?.pruneOnStop ?? app.pruneOnStop,
  };
}

export function getEffectiveContainerPruneSettings(
  settings: AppSettings,
  projectConfig?: ProjectConfig | null
): ContainerPruneSettings {
  const app = { ...DEFAULT_CONTAINER_PRUNE_SETTINGS, ...(settings.containerPrune ?? {}) };
  return {
    idleHours: Math.max(0, Math.floor(projectConfig?.containers?.pruneIdleHours ?? app.idleHours)),
    maxAgeDays: Math.max(0, Math.floor(projectConfig?.containers?.pruneMaxAgeDays ?? app.maxAgeDays)),
  };
}
