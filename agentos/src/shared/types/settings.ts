import type { Provider, ProviderEntry } from './provider';

export type EmbeddingProvider = 'auto' | 'openai' | 'google' | 'voyage' | 'mistral' | 'local';

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  openrouter?: string;
  voyage?: string;
  mistral?: string;
  github?: string;
}

export interface TailscaleSettings {
  authKey?: string | null;
  funnel?: boolean;
}

export interface ContainersConfig {
  pruneIdleHours?: number;
  pruneMaxAgeDays?: number;
}

export interface EnvConfig {
  safelist?: string[];
  vars?: Record<string, string>;
}

export interface AgentsConfig {
  providerOrder: ProviderEntry[];
  lastProvider?: Provider;
  queueSilenceFallbackMs?: number;
  /**
   * Per-provider override for the CLI command used to launch a provider. The value is
   * whitespace-split into a command + prefix args, e.g. `"aifx agent claude"` launches
   * `aifx agent claude …` instead of `claude …`. Applies everywhere a provider is spawned
   * (host + container exec, council, autopilot, kanban). Unset providers fall back to their
   * default binary. Under Docker the command must already exist inside the sandbox image.
   */
  commandOverrides?: Partial<Record<Provider, string>>;
  autopilot?: AutopilotSettings;
}

export interface MemoryConfig {
  enabled?: boolean;
  rootPath?: string | null;
  extraPaths?: string[];
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  localModelPath?: string | null;
  // Search tuning
  maxResults?: number; // default 8
  minScore?: number; // default 0.5
  vectorWeight?: number; // default 0.7
  textWeight?: number; // default 0.3
  codeVectorWeight?: number; // default 0.55; overrides vectorWeight for code search only
  codeTextWeight?: number; // default 0.45; overrides textWeight for code search only
  decayHalfLifeDays?: number; // default 45
  codeDecayHalfLifeDays?: number; // default 180; set 0 to disable code decay
  mmrLambda?: number; // default 0.7
  sessionRetentionDays?: number; // default undefined (no pruning)
  // Decay / graph controls (project-level memory features)
  decayEnabled?: boolean;
  decayMinScore?: number;
  graphEnabled?: boolean;
  graphBoost?: number;
}

/**
 * The app-owned configuration surface that a project may selectively override.
 * `AppSettings` is the concrete base; `ProjectConfig` is a deep-partial of this
 * (plus project-only fields). Both sides share these names and structures.
 */
export interface BaseConfig {
  /**
   * When true, threads run the provider CLI directly on the host machine with NO sandbox
   * isolation, instead of inside a Docker container. The agent gets full read/write access
   * to the host with `--dangerously-skip-permissions`. Requires the provider CLI on PATH.
   * Project config may override this per-project. Default: false.
   */
  runOnHost?: boolean;
  sandbox?: SandboxSecuritySettings;
  agents: AgentsConfig;
  apiKeys?: ApiKeys;
  tailscale?: TailscaleSettings;
  worktree?: WorktreeSettings;
  containers?: ContainersConfig;
  env?: EnvConfig;
  memory?: MemoryConfig;
  recording?: RecordingSettings;
}

export interface AppSettings extends BaseConfig {
  claudeStreamJson: boolean;
  skipPermissions: boolean;
  maxLogBufferSize: number;
  logRetentionDays?: number;
  persistDebugLogs: boolean;
  devMode: boolean;
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  webhookPort?: number;
  slack?: SlackSettings;
  voice?: VoiceSettings;
  voiceFlow?: VoiceFlowSettings;
  meetingProjectPath?: string;
  /** When true, all MCP server requests require a valid bearer token even from localhost. Default: false. */
  mcpRequireAuth?: boolean;
}

export interface VoiceFlowSettings {
  /** Key name from uiohook-napi's UiohookKey, e.g. 'ShiftLeft', 'F13'. Default: 'Alt'. */
  key?: string;
  /** STT model to use for transcription. Default: 'base.en'. */
  model?: 'base.en' | 'small.en' | 'medium.en' | 'large-v3-turbo-q5_0';
}

export interface RecordingTemplate {
  id: string;
  name: string;
  content: string;
}

export interface RecordingSettings {
  templates?: RecordingTemplate[];
  activeTemplateId?: string; // undefined = use built-in default
}

export const RECORDING_DEFAULT_TEMPLATE_ID = 'default';

export interface BigFiveTraits {
  openness: number; // 1–5 scale
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number; // 1 = stable/steady, 5 = reactive/volatile
}

export interface PersonaPreset {
  id: string;
  label: string;
  description: string;
  traits?: BigFiveTraits;
}

export interface PersonalitySnapshot {
  agentStyle: string;
  autopilotInstructions: string;
  bigFive?: BigFiveTraits;
  generatedAt: number;
  messageCount?: number;
}

export interface PersonalitySettings {
  agentStyle: string;
  autopilotInstructions: string;
  bigFive?: BigFiveTraits;
  activePresetId?: string;
  generatedAt?: number;
  /** Number of user messages analysed in the last LLM-derived refresh. */
  messageCount?: number;
  /** Last 3 LLM-derived snapshots, newest first. Used for rollback. */
  history?: PersonalitySnapshot[];
}

export const DEFAULT_PRESET_ID = 'default';
export const CUSTOM_PRESET_ID = 'custom';

export const DEFAULT_PERSONALITY_SETTINGS: PersonalitySettings = {
  agentStyle: '',
  autopilotInstructions: '',
  activePresetId: DEFAULT_PRESET_ID,
};

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'default',
    label: 'Balanced',
    description: 'Neutral across all traits — no trait influence on tone',
    traits: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  },
  {
    id: 'concise-technical',
    label: 'Concise & Technical',
    description: 'Thorough and organized, reserved, states disagreement plainly',
    traits: { openness: 3, conscientiousness: 5, extraversion: 1, agreeableness: 2, neuroticism: 2 },
  },
  {
    id: 'warm-collaborative',
    label: 'Warm & Collaborative',
    description: 'Warm and expressive, empathetic, emotionally steady',
    traits: { openness: 3, conscientiousness: 3, extraversion: 5, agreeableness: 5, neuroticism: 1 },
  },
  {
    id: 'creative-explorer',
    label: 'Creative Explorer',
    description: 'Curious and imaginative, warm and expressive',
    traits: { openness: 5, conscientiousness: 3, extraversion: 4, agreeableness: 3, neuroticism: 3 },
  },
  {
    id: CUSTOM_PRESET_ID,
    label: 'Custom',
    description: 'Manually set each trait with the sliders below',
  },
];

export function getPreset(id: string): PersonaPreset | undefined {
  return PERSONA_PRESETS.find((p) => p.id === id);
}

export interface AutopilotSettings {
  enabled?: boolean;
  maxConsecutiveTurns: number;
  transcriptMessages: number;
  plannerProvider?: Provider;
  plannerModel?: string;
}

export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = {
  enabled: false,
  maxConsecutiveTurns: 10,
  transcriptMessages: 25,
};

export interface VoiceSettings {
  ttsEnabled: boolean;
}

export interface SlackSettings {
  enabled: boolean;
  botToken: string | null;
  appToken: string | null;
  watchedChannelIds: string[];
  channelWorkspaceMap: Record<string, string>;
  requireMention: boolean;
  defaultWorkingDirectory: string | null;
}

export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
  enabled: false,
  botToken: null,
  appToken: null,
  watchedChannelIds: [],
  channelWorkspaceMap: {},
  requireMention: false,
  defaultWorkingDirectory: null,
};

export type WorktreeSettings = {
  autoCreate: boolean;
  pruneOnStop: boolean;
};

export const DEFAULT_WORKTREE_SETTINGS: WorktreeSettings = {
  autoCreate: true,
  pruneOnStop: true,
};

export type ContainerPruneSettings = {
  idleHours: number;
  maxAgeDays: number;
};

export const DEFAULT_CONTAINER_PRUNE_SETTINGS: ContainerPruneSettings = {
  idleHours: 24,
  maxAgeDays: 7,
};

export type SandboxSecuritySettings = {
  readOnlyRoot: boolean; // default: false — opt-in after per-CLI write-path testing
  dropAllCapabilities: boolean; // default: true
  noNewPrivileges: boolean; // default: true
  network: 'none' | 'bridge' | 'host'; // default: 'bridge' — CLIs need internet for API calls
  memory?: string; // e.g. "2g", "512m" — optional
  cpus?: string; // e.g. "2.0" — optional
  tmpfs: string[]; // default: ['/tmp', '/var/tmp']
};

export const DEFAULT_SANDBOX_SETTINGS: SandboxSecuritySettings = {
  readOnlyRoot: false,
  dropAllCapabilities: true,
  noNewPrivileges: true,
  network: 'bridge',
  tmpfs: ['/tmp', '/var/tmp'],
};

/** Settings broadcast to renderer windows: credential fields are stripped, env keeps only its safelist. */
export type PublicSettings = Omit<AppSettings, 'apiKeys' | 'slack' | 'tailscale' | 'env'> & {
  env?: { safelist?: string[] };
};

export interface SlackThreadBinding {
  key: string;
  threadId?: string;
  channelId: string;
  threadTs: string;
  createdAt: number;
  lastInboundTs?: string; // kept for backwards compat with existing stored data
}
