import type {
  AppSettings,
  PersonalitySettings,
  BigFiveTraits,
  AutopilotSettings,
  SlackSettings,
  WorktreeSettings,
  SandboxSecuritySettings,
} from '../config/schema';

// Config-shape types are inferred from the canonical schema (single source of truth).
export type {
  EmbeddingProvider,
  ApiKeys,
  TailscaleSettings,
  ContainersConfig,
  EnvConfig,
  AgentsConfig,
  MemoryConfig,
  AppSettings,
  VoiceFlowSettings,
  RecordingTemplate,
  RecordingSettings,
  BigFiveTraits,
  PersonalitySnapshot,
  PersonalitySettings,
  AutopilotSettings,
  VoiceSettings,
  SlackSettings,
  WorktreeSettings,
  SandboxSecuritySettings,
} from '../config/schema';

export interface PersonaPreset {
  id: string;
  label: string;
  description: string;
  traits?: BigFiveTraits;
}

export const RECORDING_DEFAULT_TEMPLATE_ID = 'default';

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

export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = {
  enabled: false,
  maxConsecutiveTurns: 10,
  transcriptMessages: 25,
};

export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
  enabled: false,
  botToken: null,
  appToken: null,
  watchedChannelIds: [],
  channelWorkspaceMap: {},
  requireMention: false,
  defaultWorkingDirectory: null,
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

/**
 * Messaging medium an AgentOS thread can echo to. Slack is the only one wired today; the
 * binding carries this discriminator so the outbound echo layer (see MediumPoster) can dispatch
 * per medium without the rest of the code knowing which one. Add a value here when wiring a new one.
 */
export type Medium = 'slack';

export interface SlackThreadBinding {
  key: string;
  /** Which messaging medium this binding echoes to. Existing rows default to 'slack'. */
  medium: Medium;
  threadId?: string;
  channelId: string;
  /** Reply anchor within the channel. Absent = channel-scoped: echoes post as new top-level messages. */
  threadTs?: string;
  createdAt: number;
  lastInboundTs?: string; // kept for backwards compat with existing stored data
}
