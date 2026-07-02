/**
 * Canonical config schema — the single source of truth for both config layers.
 *
 * App settings (electron-store, secrets encrypted) and project config (plaintext
 * `.agentos/config.json`) share these block schemas. Adding or renaming a setting
 * is a one-file edit here: TypeScript types (`z.infer`), validation, and the merge
 * surface all follow.
 *
 * Two parse modes over one schema:
 *  - App: `appSettingsPatchSchema.parse(raw)` throws at the IPC boundary.
 *  - Project: `parseProjectConfig(raw)` warns-and-ignores via leaf-level `.catch`.
 */
import { z } from 'zod';
import { normalizeProviderOrder } from '../types/provider';

// ── Enums ─────────────────────────────────────────────────────────────────────
const providerEnum = z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']);
const backendEnum = z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']);
const effortEnum = z.enum(['low', 'medium', 'high', 'extra-high', 'max']);
const reasoningEnum = z.enum(['low', 'medium', 'high', 'extra-high']);
const embeddingProviderEnum = z.enum(['auto', 'openai', 'google', 'voyage', 'mistral', 'local']);
export type EmbeddingProvider = z.infer<typeof embeddingProviderEnum>;

// ── Leaf / block schemas (app-strict; match the interface requiredness) ─────────

const providerEntrySchema = z.object({
  provider: providerEnum,
  backend: backendEnum.optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  effort: effortEnum.optional(),
  reasoning: reasoningEnum.optional(),
});

const apiKeysSchema = z.object({
  anthropic: z.string().optional(),
  openai: z.string().optional(),
  google: z.string().optional(),
  openrouter: z.string().optional(),
  voyage: z.string().optional(),
  mistral: z.string().optional(),
  github: z.string().optional(),
});
export type ApiKeys = z.infer<typeof apiKeysSchema>;

const tailscaleSchema = z.object({
  authKey: z.string().nullable().optional(),
  funnel: z.boolean().optional(),
});
export type TailscaleSettings = z.infer<typeof tailscaleSchema>;

const containersSchema = z.object({
  pruneIdleHours: z.number().min(0).optional(),
  pruneMaxAgeDays: z.number().min(0).optional(),
});
export type ContainersConfig = z.infer<typeof containersSchema>;

const envSchema = z.object({
  safelist: z.array(z.string()).optional(),
  vars: z.record(z.string(), z.string()).optional(),
});
export type EnvConfig = z.infer<typeof envSchema>;

const autopilotSchema = z.object({
  enabled: z.boolean().optional(),
  maxConsecutiveTurns: z.number().int().min(1).max(100),
  transcriptMessages: z.number().int().min(1).max(200),
  plannerProvider: providerEnum.optional(),
  plannerModel: z.string().optional(),
});
export type AutopilotSettings = z.infer<typeof autopilotSchema>;

const agentsSchema = z.object({
  providerOrder: z.array(providerEntrySchema),
  lastProvider: providerEnum.optional(),
  queueSilenceFallbackMs: z.number().int().min(0).optional(),
  commandOverrides: z.partialRecord(providerEnum, z.string()).optional(),
  autopilot: autopilotSchema.optional(),
});
export type AgentsConfig = z.infer<typeof agentsSchema>;

const memorySchema = z.object({
  enabled: z.boolean().optional(),
  rootPath: z.string().nullable().optional(),
  extraPaths: z.array(z.string()).optional(),
  embeddingProvider: embeddingProviderEnum.optional(),
  embeddingModel: z.string().optional(),
  localModelPath: z.string().nullable().optional(),
  maxResults: z.number().int().min(1).optional(),
  minScore: z.number().min(0).max(1).optional(),
  vectorWeight: z.number().min(0).max(1).optional(),
  textWeight: z.number().min(0).max(1).optional(),
  codeVectorWeight: z.number().min(0).max(1).optional(),
  codeTextWeight: z.number().min(0).max(1).optional(),
  decayHalfLifeDays: z.number().min(0).optional(),
  codeDecayHalfLifeDays: z.number().min(0).optional(),
  mmrLambda: z.number().min(0).max(1).optional(),
  sessionRetentionDays: z.number().min(0).optional(),
  decayEnabled: z.boolean().optional(),
  decayMinScore: z.number().min(0).max(1).optional(),
  graphEnabled: z.boolean().optional(),
  graphBoost: z.number().min(0).optional(),
});
export type MemoryConfig = z.infer<typeof memorySchema>;

const sandboxSchema = z.object({
  readOnlyRoot: z.boolean(),
  dropAllCapabilities: z.boolean(),
  noNewPrivileges: z.boolean(),
  network: z.enum(['none', 'bridge', 'host']),
  memory: z.string().optional(),
  cpus: z.string().optional(),
  tmpfs: z.array(z.string()),
});
export type SandboxSecuritySettings = z.infer<typeof sandboxSchema>;

const worktreeSchema = z.object({
  autoCreate: z.boolean(),
  pruneOnStop: z.boolean(),
});
export type WorktreeSettings = z.infer<typeof worktreeSchema>;

const recordingTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
});
export type RecordingTemplate = z.infer<typeof recordingTemplateSchema>;

const recordingSchema = z.object({
  templates: z.array(recordingTemplateSchema).optional(),
  activeTemplateId: z.string().optional(),
});
export type RecordingSettings = z.infer<typeof recordingSchema>;

const slackSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().nullable(),
  appToken: z.string().nullable(),
  watchedChannelIds: z.array(z.string()),
  channelWorkspaceMap: z.record(z.string(), z.string()),
  requireMention: z.boolean(),
  defaultWorkingDirectory: z.string().nullable(),
});
export type SlackSettings = z.infer<typeof slackSchema>;

const voiceSchema = z.object({
  ttsEnabled: z.boolean(),
});
export type VoiceSettings = z.infer<typeof voiceSchema>;

const voiceFlowSchema = z.object({
  key: z.string().optional(),
  model: z.enum(['base.en', 'small.en', 'medium.en', 'large-v3-turbo-q5_0']).optional(),
});
export type VoiceFlowSettings = z.infer<typeof voiceFlowSchema>;

const bigFiveSchema = z.object({
  openness: z.number(),
  conscientiousness: z.number(),
  extraversion: z.number(),
  agreeableness: z.number(),
  neuroticism: z.number(),
});
export type BigFiveTraits = z.infer<typeof bigFiveSchema>;

const personalitySnapshotSchema = z.object({
  agentStyle: z.string(),
  autopilotInstructions: z.string(),
  bigFive: bigFiveSchema.optional(),
  generatedAt: z.number(),
  messageCount: z.number().optional(),
});
export type PersonalitySnapshot = z.infer<typeof personalitySnapshotSchema>;

const personalitySchema = z.object({
  agentStyle: z.string(),
  autopilotInstructions: z.string(),
  bigFive: bigFiveSchema.optional(),
  activePresetId: z.string().optional(),
  generatedAt: z.number().optional(),
  messageCount: z.number().optional(),
  history: z.array(personalitySnapshotSchema).optional(),
});
export type PersonalitySettings = z.infer<typeof personalitySchema>;

// ── App settings: base config + app-only fields ─────────────────────────────────

const baseConfigSchema = z.object({
  runOnHost: z.boolean().optional(),
  sandbox: sandboxSchema.optional(),
  agents: agentsSchema,
  apiKeys: apiKeysSchema.optional(),
  tailscale: tailscaleSchema.optional(),
  worktree: worktreeSchema.optional(),
  containers: containersSchema.optional(),
  env: envSchema.optional(),
  memory: memorySchema.optional(),
  recording: recordingSchema.optional(),
});

const appSettingsSchema = baseConfigSchema.extend({
  claudeStreamJson: z.boolean(),
  skipPermissions: z.boolean(),
  maxLogBufferSize: z.number().int().min(0),
  logRetentionDays: z.number().int().min(1).optional(),
  persistDebugLogs: z.boolean(),
  devMode: z.boolean(),
  theme: z.enum(['dark', 'light', 'system']),
  fontSize: z.number().min(8).max(72),
  webhookPort: z.number().int().min(1).max(65535).optional(),
  slack: slackSchema.optional(),
  voice: voiceSchema.optional(),
  voiceFlow: voiceFlowSchema.optional(),
  meetingProjectPath: z.string().optional(),
  // Continuous capture: always-on rolling 5-minute segments. Off by default (privacy).
  continuousCaptureEnabled: z.boolean().optional(),
  mcpRequireAuth: z.boolean().optional(),
  editor: z.object({ label: z.string(), command: z.string(), args: z.string().optional() }).optional(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/**
 * Validated schema for AppSettings patches: top-level keys optional, nested objects
 * keep their requiredness. Unknown top-level keys are rejected (`.strict()` throws at
 * the IPC boundary). Replaces the previously hand-maintained patch schema.
 */
export const appSettingsPatchSchema = appSettingsSchema.partial().strict();

// ── Project config: deep-partial of the base surface + project-only blocks ──────

// Memory fields a project may override — excludes app-only fields (root path,
// embedding provider/model, local model path) so they are never advertised as
// per-project overridable.
const projectMemorySchema = z.object({
  enabled: z.boolean().optional(),
  extraPaths: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
  vectorWeight: z.number().min(0).max(1).optional(),
  textWeight: z.number().min(0).max(1).optional(),
  codeVectorWeight: z.number().min(0).max(1).optional(),
  codeTextWeight: z.number().min(0).max(1).optional(),
  decayHalfLifeDays: z.number().optional(),
  codeDecayHalfLifeDays: z.number().min(0).max(3650).optional(),
  mmrLambda: z.number().min(0).max(1).optional(),
  sessionRetentionDays: z.number().min(0).max(3650).optional(),
  decayEnabled: z.boolean().optional(),
  decayMinScore: z.number().optional(),
  graphEnabled: z.boolean().optional(),
  graphBoost: z.number().optional(),
});
export type ProjectMemoryConfig = z.infer<typeof projectMemorySchema>;

// Project agents: providerOrder is normalized (accepts legacy string form); autopilot
// is narrowed to the two fields a project may override (the old validator's behavior),
// so the generic merge can never let a project flip the app-only `enabled`/`planner*`.
const projectAgentsSchema = z.object({
  providerOrder: z
    .preprocess((v) => {
      if (v === undefined) return undefined;
      const normalized = normalizeProviderOrder(v);
      return normalized.length > 0 ? normalized : undefined;
    }, z.array(providerEntrySchema).optional())
    .catch(undefined),
  queueSilenceFallbackMs: z.number().optional().catch(undefined),
  autopilot: z
    .object({
      maxConsecutiveTurns: z.number().optional().catch(undefined),
      transcriptMessages: z.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const kanbanSchema = z.object({
  enabled: z.boolean().optional().catch(undefined),
  stages: z
    .record(z.string(), z.object({ prompt: z.string().optional().catch(undefined) }))
    .optional()
    .catch(undefined),
});

// Migrate legacy personality shape and apply the validator's coercions:
// legacy `profile` → `agentStyle`; `enabled === false` omits personality entirely;
// `bigFive` is all-five-traits-or-omitted; `history` is capped at 3 snapshots.
function migratePersonality(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  if (raw.enabled === false) return undefined;
  const out: Record<string, unknown> = { agentStyle: '', autopilotInstructions: '' };
  if (typeof raw.agentStyle === 'string') out.agentStyle = raw.agentStyle;
  else if (typeof raw.profile === 'string') out.agentStyle = raw.profile;
  if (typeof raw.autopilotInstructions === 'string') out.autopilotInstructions = raw.autopilotInstructions;
  if (typeof raw.activePresetId === 'string') out.activePresetId = raw.activePresetId;
  if (typeof raw.generatedAt === 'number') out.generatedAt = raw.generatedAt;
  if (typeof raw.messageCount === 'number') out.messageCount = raw.messageCount;
  if (isRecord(raw.bigFive)) {
    const bf = coerceBigFive(raw.bigFive);
    if (bf) out.bigFive = bf;
  }
  if (Array.isArray(raw.history)) {
    out.history = raw.history
      .filter((h): h is Record<string, unknown> => isRecord(h) && typeof h.generatedAt === 'number')
      .map((h) => {
        const snap: Record<string, unknown> = {
          agentStyle: typeof h.agentStyle === 'string' ? h.agentStyle : '',
          autopilotInstructions: typeof h.autopilotInstructions === 'string' ? h.autopilotInstructions : '',
          generatedAt: h.generatedAt,
        };
        if (typeof h.messageCount === 'number') snap.messageCount = h.messageCount;
        if (isRecord(h.bigFive)) {
          const bf = coerceBigFive(h.bigFive);
          if (bf) snap.bigFive = bf;
        }
        return snap;
      })
      .slice(0, 3);
  }
  return out;
}

const BIG_FIVE_TRAITS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
function coerceBigFive(bf: Record<string, unknown>): Record<string, number> | undefined {
  const traits: Record<string, number> = {};
  for (const k of BIG_FIVE_TRAITS) {
    if (typeof bf[k] === 'number' && Number.isFinite(bf[k])) traits[k] = bf[k] as number;
  }
  return BIG_FIVE_TRAITS.every((k) => k in traits) ? traits : undefined;
}

// Each block is `.catch(undefined)`: an invalid value drops that block (warn-and-ignore)
// without failing the whole parse. Granularity is block-level — a single bad leaf drops
// its block (the old validator dropped individual leaves); this is sanctioned simplification.
const projectConfigSchema = z.object({
  version: z.literal(1).optional().catch(undefined),
  runOnHost: z.boolean().optional().catch(undefined),
  sandbox: sandboxSchema.partial().optional().catch(undefined),
  kanban: kanbanSchema.optional().catch(undefined),
  memory: projectMemorySchema.optional().catch(undefined),
  worktree: worktreeSchema.partial().optional().catch(undefined),
  env: envSchema.optional().catch(undefined),
  apiKeys: apiKeysSchema.optional().catch(undefined),
  tailscale: tailscaleSchema.optional().catch(undefined),
  agents: projectAgentsSchema.optional().catch(undefined),
  containers: containersSchema.optional().catch(undefined),
  personality: z.preprocess(migratePersonality, personalitySchema).optional().catch(undefined),
  recording: recordingSchema.optional().catch(undefined),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Top-level keys a project config may carry (drives the IPC `updateProjectConfig` enum). */
export const PROJECT_CONFIG_KEYS = [
  'version',
  'runOnHost',
  'sandbox',
  'kanban',
  'memory',
  'worktree',
  'env',
  'apiKeys',
  'tailscale',
  'agents',
  'containers',
  'personality',
  'recording',
] as const;

const ALLOWED_TOP_LEVEL_KEYS = new Set<string>(PROJECT_CONFIG_KEYS);
const LEGACY_IGNORED_KEYS = new Set<string>(['failover']);

export type ProjectConfigParseResult = { config: ProjectConfig; warnings: string[] };

/**
 * Parse a raw project config with warn-and-ignore semantics: invalid values are
 * dropped (never fatal), unknown keys are stripped, and a best-effort list of
 * warnings is returned. Lenient coercions (provider order, personality) are applied.
 */
export function parseProjectConfig(raw: unknown): ProjectConfigParseResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    warnings.push('Expected top-level object');
    return { config: {}, warnings };
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key) && !LEGACY_IGNORED_KEYS.has(key)) {
      warnings.push(`Unknown top-level key "${key}" ignored`);
    }
  }
  if (isRecord(raw.apiKeys) && ('tailscaleAuthKey' in raw.apiKeys || 'tailscaleFunnel' in raw.apiKeys)) {
    warnings.push('"apiKeys.tailscaleAuthKey"/"apiKeys.tailscaleFunnel" moved to the "tailscale" block — ignored here');
  }

  const result = projectConfigSchema.safeParse(raw);
  // Every field is lenient (`.catch`), so a parse failure is not expected; fall back to {}.
  const parsed = result.success ? (result.data as Record<string, unknown>) : {};
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined) config[k] = v;
  }

  // Warn for values present in the raw input but dropped as invalid (block-level).
  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    if (key in raw && config[key] === undefined) {
      warnings.push(`Invalid "${key}" ignored`);
    }
  }

  return { config: config as ProjectConfig, warnings };
}

// ── helpers ─────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
