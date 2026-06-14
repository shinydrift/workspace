import { z } from 'zod';
import type { AppSettings } from '../../shared/types';

/** Full validated schema for AppSettings patches. Rejects unknown keys. */
const providerEnum = z.enum(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']);

export const AppSettingsPatchSchema = z
  .object({
    claudeStreamJson: z.boolean().optional(),
    skipPermissions: z.boolean().optional(),
    agents: z
      .object({
        providerOrder: z
          .array(
            z.object({
              provider: providerEnum,
              backend: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
              model: z.string().optional(),
              baseUrl: z.string().optional(),
              effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
              reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
            })
          )
          .optional(),
        lastProvider: providerEnum.optional(),
        queueSilenceFallbackMs: z.number().int().min(0).optional(),
        commandOverrides: z.partialRecord(providerEnum, z.string()).optional(),
        autopilot: z
          .object({
            enabled: z.boolean().optional(),
            maxConsecutiveTurns: z.number().int().min(1).max(100).optional(),
            transcriptMessages: z.number().int().min(1).max(200).optional(),
            plannerProvider: providerEnum.optional(),
            plannerModel: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    maxLogBufferSize: z.number().int().min(0).optional(),
    logRetentionDays: z.number().int().min(1).optional(),
    persistDebugLogs: z.boolean().optional(),
    devMode: z.boolean().optional(),
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
        github: z.string().optional(),
      })
      .optional(),
    tailscale: z
      .object({
        authKey: z.string().nullable().optional(),
        funnel: z.boolean().optional(),
      })
      .optional(),
    memory: z
      .object({
        enabled: z.boolean().optional(),
        rootPath: z.string().nullable().optional(),
        extraPaths: z.array(z.string()).optional(),
        embeddingProvider: z.enum(['auto', 'openai', 'google', 'voyage', 'mistral', 'local']).optional(),
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
      })
      .optional(),
    webhookPort: z.number().int().min(1).max(65535).optional(),
    runOnHost: z.boolean().optional(),
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
    containers: z
      .object({
        pruneIdleHours: z.number().min(0).optional(),
        pruneMaxAgeDays: z.number().min(0).optional(),
      })
      .optional(),
    worktree: z
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
    env: z
      .object({
        safelist: z.array(z.string()).optional(),
        vars: z.record(z.string(), z.string()).optional(),
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
