import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { app } from 'electron';
import {
  buildBackendEnv,
  buildEffortArgs,
  buildReasoningArgs,
  getApiKey,
  getPrimaryProvider,
  PROVIDER_CONFIGS,
  resolveEffectiveEffort,
  resolveEffectiveModel,
  resolveEffectiveReasoning,
} from '../utils/providerConfig';
import { hasUsableHostCodexAuth, hasUsableHostGeminiAuth } from './threadAuth';
import { loadProjectConfig } from '../config/projectConfig';
import { resolveInjectionPayload } from '../utils/memoryInjection';
import { readBundledSkillsPrompt } from '../utils/claudePlugins';
import { buildPersonalityPrompt } from '../personality/styleProfile';
import { eventLogger } from '../utils/eventLog';
import {
  getEffectiveBackendForProvider,
  getEffectiveBaseUrlForProvider,
  getEffectiveRunOnHost,
} from '../../shared/effectiveProjectSettings';
import type { Thread, Provider, AppSettings, ProjectConfigLookup, SandboxSecuritySettings } from '../../shared/types';
import { DEFAULT_SANDBOX_SETTINGS } from '../../shared/types';

export type ResolvedStartConfig = {
  projectConfigResult: ProjectConfigLookup & { path: string; warnings: string[] };
  effectiveSandbox: SandboxSecuritySettings;
  /** When true, run the provider CLI directly on the host with no Docker sandbox. */
  runOnHost: boolean;
  memoryEnabled: boolean;
  bootEnabled: boolean;
  personalityPrompt: string;
  injectionPayload: Awaited<ReturnType<typeof resolveInjectionPayload>>;
  extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  apiKey: string | undefined;
  backendEnv: Record<string, string>;
  useHeadless: boolean;
  useClaudeStreamJson: boolean;
  skipPermissions: boolean;
  providerArgs: string[];
};

// Resolves all configuration needed to start a thread:
// project config, sandbox settings, memory/boot/skill flags,
// injection payload, API key validation, and provider args.
//
// Throws if required API key is missing.
export async function resolveStartConfig(
  threadId: string,
  stored: Omit<Thread, 'logBuffer'>,
  provider: Provider,
  settings: AppSettings,
  options?: { forceClaudePlainText?: boolean }
): Promise<ResolvedStartConfig> {
  const projectRootPath = stored.projectPath ?? stored.workingDirectory;
  const projectConfigResult = await loadProjectConfig(projectRootPath);

  for (const warning of projectConfigResult.warnings) {
    eventLogger.warn('project-config', warning, {
      threadId,
      projectPath: projectRootPath,
      configPath: projectConfigResult.path,
    });
  }

  const effectiveSandbox: SandboxSecuritySettings = {
    ...DEFAULT_SANDBOX_SETTINGS,
    ...(settings.sandbox ?? {}),
    ...(projectConfigResult.config?.sandbox ?? {}),
    // Union array fields across all layers instead of last-writer-wins
    tmpfs: [
      ...new Set([
        ...DEFAULT_SANDBOX_SETTINGS.tmpfs,
        ...(settings.sandbox?.tmpfs ?? []),
        ...(projectConfigResult.config?.sandbox?.tmpfs ?? []),
      ]),
    ],
  };
  // Per-thread snapshot wins; otherwise project config overrides the app-level toggle; defaults to sandboxed (false).
  const runOnHost = stored.runOnHost ?? getEffectiveRunOnHost(settings, projectConfigResult.config);
  const memoryEnabled = projectConfigResult.config?.memory?.enabled ?? true;
  const bootEnabled = true;

  const userHome = app.getPath('home');
  const effectiveApiKeys = { ...(settings.apiKeys ?? {}), ...(projectConfigResult.config?.apiKeys ?? {}) };
  const effectiveBackend = getEffectiveBackendForProvider(provider, projectConfigResult.config, settings);
  const effectiveBaseUrl = getEffectiveBaseUrlForProvider(provider, projectConfigResult.config, settings);
  const apiKey = getApiKey(provider, effectiveApiKeys, effectiveBackend);
  // opencode picks its upstream provider from the model's `provider/` prefix and reads that
  // provider's key from the environment, so inject every configured key rather than a single one.
  const opencodeKeyEnv: Record<string, string> =
    provider === 'opencode'
      ? {
          ...(effectiveApiKeys.anthropic ? { ANTHROPIC_API_KEY: effectiveApiKeys.anthropic } : {}),
          ...(effectiveApiKeys.openai ? { OPENAI_API_KEY: effectiveApiKeys.openai } : {}),
          ...(effectiveApiKeys.google
            ? { GOOGLE_API_KEY: effectiveApiKeys.google, GOOGLE_GENERATIVE_AI_API_KEY: effectiveApiKeys.google }
            : {}),
        }
      : {};
  const backendEnv = { ...buildBackendEnv(provider, effectiveBackend, effectiveBaseUrl, apiKey), ...opencodeKeyEnv };
  if (effectiveBackend === 'openrouter' && !apiKey) {
    eventLogger.warn(
      'config',
      'OpenRouter backend selected but no OpenRouter API key is configured — session will likely fail at first API call',
      {
        threadId,
        provider,
      }
    );
  }
  const hasHostCodexAuth = provider === 'codex' ? hasUsableHostCodexAuth(userHome) : false;
  const hasHostGeminiAuth = provider === 'gemini' ? hasUsableHostGeminiAuth(userHome) : false;

  if (
    !apiKey &&
    effectiveBackend !== 'ollama' && // Ollama doesn't require a key
    provider !== 'claude' &&
    // opencode can auth via any of several provider keys (or `opencode auth login` creds), so it
    // never hard-fails on a missing Anthropic key — it just needs a key for its chosen model's provider.
    provider !== 'opencode' &&
    !(provider === 'codex' && hasHostCodexAuth) &&
    !(provider === 'gemini' && hasHostGeminiAuth)
  ) {
    const providerLabel = PROVIDER_CONFIGS[provider].displayName;
    const keyName = PROVIDER_CONFIGS[provider].apiKeyEnvVar;
    throw new Error(`${providerLabel} requires an API key. Set ${keyName} in Settings and retry.`);
  }
  if (provider === 'opencode' && Object.keys(opencodeKeyEnv).length === 0) {
    eventLogger.warn(
      'config',
      'opencode selected but no Anthropic/OpenAI/Google API key is configured — it will fall back to `opencode auth login` creds if present, otherwise fail at first API call',
      { threadId, provider }
    );
  }

  const useHeadless = PROVIDER_CONFIGS[provider].supportsHeadless;
  const useClaudeStreamJson =
    !useHeadless && provider === 'claude' && (settings.claudeStreamJson ?? true) && !options?.forceClaudePlainText;
  const skipPermissions = settings.skipPermissions ?? true;
  // Resolve effective model: project config > frozen thread snapshot > app providerOrder.
  const effectiveModel = resolveEffectiveModel(provider, stored.model, projectConfigResult.config, settings);
  const modelArgs = effectiveModel ? ['--model', effectiveModel] : [];
  const providerArgs =
    provider === 'claude'
      ? [
          ...(useClaudeStreamJson ? ['--output-format', 'stream-json'] : []),
          ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
          ...modelArgs,
          ...buildEffortArgs(resolveEffectiveEffort(projectConfigResult.config, settings, stored.effort)),
        ]
      : provider === 'codex'
        ? [
            ...modelArgs,
            ...buildReasoningArgs(resolveEffectiveReasoning(projectConfigResult.config, settings, stored.reasoning)),
          ]
        : [...modelArgs];

  const projectPersonality = projectConfigResult.config?.personality;
  const effectivePersonality =
    stored.personalityOverride && projectPersonality
      ? { ...projectPersonality, ...stored.personalityOverride }
      : projectPersonality;
  const personalityPrompt = buildPersonalityPrompt(effectivePersonality);
  const effectiveMemoryRootPath = settings.memory?.rootPath ?? path.join(userHome, '.agentos', 'memory', 'projects');
  let injectionPayload = await resolveInjectionPayload(
    effectiveMemoryRootPath,
    stored.projectId,
    { bootEnabled },
    { personalityPrompt }
  );

  // For codex/gemini: inject global ~/.claude/CLAUDE.md and bundled skills since
  // those providers don't natively load Claude plugins or the user's ~/.claude dir.
  if (provider !== 'claude') {
    const extraParts: string[] = [];

    const globalClaudeMdPath = path.join(userHome, '.claude', 'CLAUDE.md');
    try {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8').trim();
      if (content) extraParts.push(content);
    } catch {
      // not present — skip
    }

    const bundledSkillsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled-skills')
      : path.join(app.getAppPath(), 'resources', 'bundled-skills');
    const skillsPrompt = await readBundledSkillsPrompt(bundledSkillsDir);
    if (skillsPrompt) extraParts.push(skillsPrompt);

    if (extraParts.length > 0) {
      const extra = extraParts.join('\n\n');
      injectionPayload = {
        ...injectionPayload,
        payload: injectionPayload.payload ? `${injectionPayload.payload}\n\n${extra}` : extra,
      };
    }
  }

  const extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }> = [];
  if (injectionPayload.projectMemoryPath) {
    extraReadonlyMounts.push({
      hostPath: injectionPayload.projectMemoryPath,
      containerPath: '/agentos-memory',
    });
  }

  // If the working directory is a git worktree, mount the main .git directory at
  // the same absolute path so git commands inside Docker can resolve worktree refs.
  try {
    const workDir = stored.workingDirectory;
    const gitDir = execFileSync('git', ['-C', workDir, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
    const commonDir = execFileSync('git', ['-C', workDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim();
    if (gitDir !== commonDir && fs.existsSync(commonDir)) {
      extraReadonlyMounts.push({ hostPath: commonDir, containerPath: commonDir, readOnly: false });
    }
  } catch {
    /* not a git repo or git unavailable */
  }

  return {
    projectConfigResult,
    effectiveSandbox,
    runOnHost,
    memoryEnabled,
    bootEnabled,
    personalityPrompt,
    injectionPayload,
    extraReadonlyMounts,
    apiKey,
    backendEnv,
    useHeadless,
    useClaudeStreamJson,
    skipPermissions,
    providerArgs,
  };
}

export function getPrimaryProviderForSettings(settings: AppSettings): Provider {
  return getPrimaryProvider(settings);
}
