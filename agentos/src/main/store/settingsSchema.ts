import { z } from 'zod';
import type { AppSettings } from '../../shared/types';

/** Full validated schema for AppSettings patches. Rejects unknown keys. */
export const AppSettingsPatchSchema = z
  .object({
    claudeStreamJson: z.boolean().optional(),
    skipPermissions: z.boolean().optional(),
    providerOrder: z
      .array(
        z.object({
          provider: z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']),
          backend: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
          model: z.string().optional(),
          baseUrl: z.string().optional(),
          effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
          reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
        })
      )
      .optional(),
    lastProvider: z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']).optional(),
    maxLogBufferSize: z.number().int().min(0).optional(),
    logRetentionDays: z.number().int().min(1).optional(),
    queueSilenceFallbackMs: z.number().int().min(0).optional(),
    persistDebugLogs: z.boolean().optional(),
    devMode: z.boolean().optional(),
    memoryRootPath: z.string().nullable().optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    fontSize: z.number().min(8).max(72).optional(),
    apiKeys: z
      .object({
        anthropic: z.string().optional(),
        openai: z.string().optional(),
        google: z.string().optional(),
        openrouter: z.string().optional(),
        voyage: z.string().optional(),
        mistral: z.string().optional(),
      })
      .optional(),
    embeddingProvider: z.enum(['auto', 'openai', 'google', 'voyage', 'mistral', 'local']).optional(),
    embeddingModel: z.string().optional(),
    localModelPath: z.string().nullable().optional(),
    memorySearch: z
      .object({
        maxResults: z.number().int().min(1).optional(),
        minScore: z.number().min(0).max(1).optional(),
        vectorWeight: z.number().min(0).max(1).optional(),
        textWeight: z.number().min(0).max(1).optional(),
        codeVectorWeight: z.number().min(0).max(1).optional(),
        codeTextWeight: z.number().min(0).max(1).optional(),
        halfLifeDays: z.number().min(0).optional(),
        codeDecayHalfLifeDays: z.number().min(0).optional(),
        mmrLambda: z.number().min(0).max(1).optional(),
        sessionRetentionDays: z.number().min(0).optional(),
      })
      .optional(),
    extraMemoryPaths: z.array(z.string()).optional(),
    tailscaleAuthKey: z.string().nullable().optional(),
    tailscaleFunnel: z.boolean().optional(),
    webhookPort: z.number().int().min(1).max(65535).optional(),
    githubToken: z.string().nullable().optional(),
    runOnHost: z.boolean().optional(),
    providerCommandOverrides: z
      .partialRecord(z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']), z.string())
      .optional(),
    slack: z
      .object({
        enabled: z.boolean(),
        botToken: z.string().nullable(),
        appToken: z.string().nullable(),
        watchedChannelIds: z.array(z.string()),
        channelWorkspaceMap: z.record(z.string(), z.string()),
        requireMention: z.boolean(),
        defaultWorkingDirectory: z.string().nullable(),
      })
      .optional(),
    sandbox: z
      .object({
        readOnlyRoot: z.boolean(),
        dropAllCapabilities: z.boolean(),
        noNewPrivileges: z.boolean(),
        network: z.enum(['none', 'bridge', 'host']),
        memory: z.string().optional(),
        cpus: z.string().optional(),
        tmpfs: z.array(z.string()),
      })
      .optional(),
    containerPrune: z
      .object({
        idleHours: z.number().min(0),
        maxAgeDays: z.number().min(0),
      })
      .optional(),
    worktrees: z
      .object({
        autoCreate: z.boolean(),
        pruneOnStop: z.boolean(),
      })
      .optional(),
    voice: z
      .object({
        ttsEnabled: z.boolean(),
      })
      .optional(),
    envSafelist: z.array(z.string()).optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    autopilot: z
      .object({
        enabled: z.boolean().optional(),
        maxConsecutiveTurns: z.number().int().min(1).max(100).optional(),
        transcriptMessages: z.number().int().min(1).max(200).optional(),
        plannerProvider: z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']).optional(),
        plannerModel: z.string().optional(),
      })
      .optional(),
    meetingProjectPath: z.string().optional(),
    recording: z
      .object({
        templates: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              content: z.string(),
            })
          )
          .optional(),
        activeTemplateId: z.string().optional(),
      })
      .optional(),
    voiceFlow: z
      .object({
        key: z.string().optional(),
        model: z.enum(['base.en', 'small.en', 'medium.en', 'large-v3-turbo-q5_0']).optional(),
      })
      .optional(),
    mcpRequireAuth: z.boolean().optional(),
  })
  .strict();

// ── Compile-time parity: every key in the schema must exist on AppSettings ──
// A full structural check would be ideal but zod 4's `.nullable()` inference
// presents required-nullable fields as optional, which doesn't structurally
// match the source-of-truth interface (see settingsHandlers.ts). This key-set
// check catches the most common drift (renamed schema field, dropped from
// AppSettings, or vice versa) without needing the value types to align.
type _SchemaKeys = keyof z.infer<typeof AppSettingsPatchSchema>;
type _SchemaKeysOutsideAppSettings = Exclude<_SchemaKeys, keyof AppSettings>;
type _NoDrift = [_SchemaKeysOutsideAppSettings] extends [never] ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _parity: _NoDrift = true;
