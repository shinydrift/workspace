import type { Provider, ProviderEntry } from './provider';

export interface AppSettings {
  claudeStreamJson: boolean;
  skipPermissions: boolean;
  providerOrder: ProviderEntry[];
  lastProvider?: Provider;
  maxLogBufferSize: number;
  logRetentionDays?: number;
  queueSilenceFallbackMs?: number;
  persistDebugLogs: boolean;
  devMode: boolean;
  memoryRootPath: string | null;
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
    openrouter?: string;
    voyage?: string;
    mistral?: string;
  };
  embeddingProvider?: 'auto' | 'openai' | 'google' | 'voyage' | 'mistral' | 'local';
  embeddingModel?: string;
  localModelPath?: string | null;
  memorySearch?: MemorySearchSettings;
  extraMemoryPaths?: string[];
  tailscaleAuthKey?: string | null;
  tailscaleFunnel?: boolean;
  webhookPort?: number;
  githubToken?: string | null;
  slack?: SlackSettings;
  sandbox?: SandboxSecuritySettings;
  containerPrune?: ContainerPruneSettings;
  worktrees?: WorktreeSettings;
  voice?: VoiceSettings;
  envSafelist?: string[];
  envVars?: Record<string, string>;
  autopilot?: AutopilotSettings;
  meetingProjectPath?: string;
  recording?: RecordingSettings;
  voiceFlow?: VoiceFlowSettings;
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

export interface MemorySearchSettings {
  maxResults?: number; // default 8
  minScore?: number; // default 0.5
  vectorWeight?: number; // default 0.7
  textWeight?: number; // default 0.3
  codeVectorWeight?: number; // default 0.55; overrides vectorWeight for code search only
  codeTextWeight?: number; // default 0.45; overrides textWeight for code search only
  halfLifeDays?: number; // default 45
  codeDecayHalfLifeDays?: number; // default 180; set 0 to disable code decay
  mmrLambda?: number; // default 0.7
  sessionRetentionDays?: number; // default undefined (no pruning)
}

export type PublicSettings = Omit<AppSettings, 'apiKeys' | 'slack' | 'githubToken' | 'tailscaleAuthKey' | 'envVars'>;

export interface SlackThreadBinding {
  key: string;
  threadId?: string;
  channelId: string;
  threadTs: string;
  createdAt: number;
  lastInboundTs?: string; // kept for backwards compat with existing stored data
}
