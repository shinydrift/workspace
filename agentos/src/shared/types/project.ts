import type { Provider, ProviderEntry } from './provider';
import type { PersonalitySettings, RecordingTemplate, SandboxSecuritySettings } from './settings';

export type ProjectConfig = {
  version?: 1;
  provider?: Provider;
  /** Run threads on the host with no sandbox. Overrides the app-level runOnHost setting. */
  runOnHost?: boolean;
  sandbox?: Partial<SandboxSecuritySettings>;
  kanban?: {
    enabled?: boolean;
    stages?: Record<string, { prompt?: string }>;
  };
  memory?: {
    enabled?: boolean;
    decayEnabled?: boolean;
    decayHalfLifeDays?: number;
    decayMinScore?: number;
    graphEnabled?: boolean;
    graphBoost?: number;
    extraPaths?: string[];
    // Search tuning overrides (inherit from app settings when absent)
    maxResults?: number;
    minScore?: number;
    vectorWeight?: number;
    textWeight?: number;
    mmrLambda?: number;
    sessionRetentionDays?: number;
    codeVectorWeight?: number;
    codeTextWeight?: number;
    codeDecayHalfLifeDays?: number;
  };
  worktree?: {
    autoCreate?: boolean;
    pruneOnStop?: boolean;
  };
  env?: {
    safelist?: string[];
    vars?: Record<string, string>;
  };
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
    openrouter?: string;
    voyage?: string;
    mistral?: string;
    github?: string;
    tailscaleAuthKey?: string;
    tailscaleFunnel?: boolean;
  };
  agents?: {
    providerOrder?: ProviderEntry[];
    queueSilenceFallbackMs?: number;
    autopilotMaxConsecutiveTurns?: number;
    autopilotTranscriptMessages?: number;
    autopilotPlannerProvider?: Provider;
    autopilotPlannerModel?: string;
  };
  containers?: {
    pruneIdleHours?: number;
    pruneMaxAgeDays?: number;
  };
  personality?: PersonalitySettings;
  recording?: {
    templates?: RecordingTemplate[];
    activeTemplateId?: string;
  };
};

export interface SavedProject {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastUsedAt: number;
  dockerfileHash?: string;
}
