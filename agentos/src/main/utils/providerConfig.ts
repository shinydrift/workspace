import type {
  AppSettings,
  ClaudeEffort,
  CodexReasoning,
  ProjectConfig,
  Provider,
  ProviderBackend,
  ProviderEntry,
} from '../../shared/types';
import { DEFAULT_BACKEND } from '../../shared/types';
import {
  getEffectiveEffortForProvider,
  getEffectiveModelForProvider,
  getEffectiveProviderOrder,
  getEffectivePrimaryProvider,
  getEffectivePrimaryProviderEntry,
  getEffectiveReasoningForProvider,
} from '../../shared/effectiveProjectSettings';

export const PROVIDER_CONFIGS: Record<
  Provider,
  {
    binaryName: string;
    apiKeyEnvVar: string;
    displayName: string;
    supportsHeadless: boolean;
    sessionConfigDir: string;
  }
> = {
  claude: {
    binaryName: 'claude',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    displayName: 'Claude',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.claude',
  },
  'claude-interactive': {
    binaryName: 'claude',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    displayName: 'Claude (interactive)',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.claude',
  },
  codex: {
    binaryName: 'codex',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    displayName: 'Codex',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.codex',
  },
  gemini: {
    binaryName: 'gemini',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    displayName: 'Gemini',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.gemini',
  },
  pi: {
    binaryName: 'pi',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    displayName: 'Pi',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.pi/agent',
  },
};

/**
 * Resolves the CLI command + prefix args used to launch `provider`. When a non-blank override
 * is configured (e.g. `"aifx agent claude"`), it is whitespace-split into the executable plus
 * leading args (`{ command: 'aifx', prefixArgs: ['agent', 'claude'] }`). Otherwise falls back to
 * the provider's default binary with no prefix args.
 */
export function resolveProviderCommand(
  provider: Provider,
  overrides?: Partial<Record<Provider, string>>
): { command: string; prefixArgs: string[] } {
  const tokens = overrides?.[provider]?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length > 0) {
    const [command, ...prefixArgs] = tokens;
    return { command, prefixArgs };
  }
  return { command: PROVIDER_CONFIGS[provider].binaryName, prefixArgs: [] };
}

export function getOrderEntries(settings: AppSettings, projectConfig?: ProjectConfig | null): ProviderEntry[] {
  return getEffectiveProviderOrder(settings, projectConfig);
}

export function getPrimaryProviderEntry(settings: AppSettings, projectConfig?: ProjectConfig | null): ProviderEntry {
  return getEffectivePrimaryProviderEntry(settings, projectConfig);
}

export function getPrimaryProvider(settings: AppSettings, projectConfig?: ProjectConfig | null): Provider {
  return getEffectivePrimaryProvider(settings, projectConfig);
}

// Returns the model selected for `provider` in the priority list (first occurrence),
// or undefined if the provider isn't listed or has no model set.
export function getModelForProvider(
  settings: AppSettings,
  provider: Provider,
  projectConfig?: ProjectConfig | null
): string | undefined {
  const entry = getEffectiveProviderOrder(settings, projectConfig).find((e) => e.provider === provider);
  return entry?.model;
}

// Resolves the model to launch the provider's CLI with.
// Precedence: project providerOrder > frozen thread snapshot > app-level providerOrder > undefined (CLI default).
// The thread snapshot takes precedence over app settings so a user-picked model on a thread isn't
// silently changed by later settings edits, but threads with no snapshot still pick up app settings.
export function resolveEffectiveModel(
  provider: Provider,
  storedModel: string | undefined | null,
  projectConfig: ProjectConfig | null,
  settings: AppSettings
): string | undefined {
  return getEffectiveModelForProvider(provider, storedModel, projectConfig, settings);
}

export function getApiKey(
  provider: Provider,
  apiKeys?: { anthropic?: string; openai?: string; google?: string; openrouter?: string },
  backend?: ProviderBackend
): string | undefined {
  if (!apiKeys) return undefined;
  const effectiveBackend = backend ?? DEFAULT_BACKEND[provider];
  switch (effectiveBackend) {
    case 'openrouter':
      return apiKeys.openrouter;
    case 'ollama':
      return undefined; // Ollama doesn't auth
    case 'anthropic':
      return apiKeys.anthropic;
    case 'openai':
      return apiKeys.openai;
    case 'google':
      return apiKeys.google;
  }
}

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// Returns the env vars needed to redirect a harness CLI to a non-native backend.
// Returns an empty object for native backends (anthropic / openai / google).
export function buildBackendEnv(
  provider: Provider,
  backend: ProviderBackend | undefined,
  baseUrl: string | undefined,
  apiKey: string | undefined
): Record<string, string> {
  const effectiveBackend = backend ?? DEFAULT_BACKEND[provider];
  if (effectiveBackend === 'ollama') {
    const url = baseUrl?.replace(/\/$/, '') || OLLAMA_DEFAULT_BASE_URL;
    if (provider === 'claude') {
      // ANTHROPIC_AUTH_TOKEN is sufficient; no key needed for local Ollama.
      return {
        ANTHROPIC_BASE_URL: url,
        ANTHROPIC_AUTH_TOKEN: 'ollama',
      };
    }
    if (provider === 'codex') {
      return {
        OPENAI_BASE_URL: `${url}/v1`,
        OPENAI_API_KEY: 'ollama',
      };
    }
    throw new Error(`buildBackendEnv: unsupported provider "${provider}" for backend "ollama"`);
  }
  if (effectiveBackend === 'openrouter') {
    if (provider === 'claude') {
      // ANTHROPIC_API_KEY='' clears the native Anthropic key that sandbox.ts may have
      // injected earlier; ANTHROPIC_AUTH_TOKEN carries the OpenRouter key as bearer auth.
      return {
        ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: apiKey ?? '',
        ANTHROPIC_API_KEY: '',
      };
    }
    if (provider === 'codex') {
      return {
        OPENAI_BASE_URL: `${OPENROUTER_BASE_URL}/v1`,
        OPENAI_API_KEY: apiKey ?? '',
      };
    }
    throw new Error(`buildBackendEnv: unsupported provider "${provider}" for backend "openrouter"`);
  }
  // Native backends (anthropic / openai / google) need no env overrides
  return {};
}

/**
 * Build the CLI argv suffix that selects a non-default model for a given provider.
 * Returns an empty array when no model is specified, so callers can spread unconditionally.
 * Used by council sub-threads where each member runs the same provider with a specific model variant.
 */
export function buildModelArgs(provider: Provider, model?: string): string[] {
  if (!model) return [];
  switch (provider) {
    case 'claude':
      return ['--model', model];
    case 'codex':
      return ['-m', model];
    case 'gemini':
      return ['--model', model];
    case 'pi':
      return ['--model', model];
  }
}

/** Build the CLI argv for Claude's --effort flag. Returns [] when unset. */
export function buildEffortArgs(effort?: ClaudeEffort): string[] {
  return effort ? ['--effort', effort] : [];
}

/** Build the CLI argv for Codex's --reasoning flag. Returns [] when unset. */
export function buildReasoningArgs(reasoning?: CodexReasoning): string[] {
  return reasoning ? ['--reasoning', reasoning] : [];
}

export function resolveEffectiveEffort(
  projectConfig: ProjectConfig | null,
  settings: AppSettings,
  storedEffort?: ClaudeEffort | null
): ClaudeEffort | undefined {
  return getEffectiveEffortForProvider(projectConfig, settings, storedEffort);
}

export function resolveEffectiveReasoning(
  projectConfig: ProjectConfig | null,
  settings: AppSettings,
  storedReasoning?: CodexReasoning | null
): CodexReasoning | undefined {
  return getEffectiveReasoningForProvider(projectConfig, settings, storedReasoning);
}

// Public OAuth client IDs — not secrets. Can be overridden via env for rotation without a release.
export const OAUTH = {
  claude: {
    clientId: process.env.CLAUDE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  },
  codex: {
    clientId: process.env.CODEX_OAUTH_CLIENT_ID ?? 'app_EMoamEEZ73f0CkXaXp7hrann',
    tokenUrl: 'https://auth.openai.com/oauth/token',
  },
  // Gemini CLI "installed application" credentials — public by design per Google OAuth2 spec.
  gemini: {
    clientId:
      process.env.GEMINI_OAUTH_CLIENT_ID ?? '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
    clientSecret: process.env.GEMINI_OAUTH_CLIENT_SECRET ?? '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',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
};
