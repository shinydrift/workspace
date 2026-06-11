export type Provider = 'claude' | 'claude-interactive' | 'codex' | 'gemini' | 'pi';

export const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  'claude-interactive': 'Claude (interactive)',
  codex: 'Codex',
  gemini: 'Gemini',
  pi: 'Pi',
};

export const PROVIDERS: Provider[] = ['claude', 'claude-interactive', 'codex', 'gemini', 'pi'];

// Backend = the API server the harness CLI talks to.
// 'anthropic' | 'openai' | 'google' are the native defaults for each harness.
// 'ollama' and 'openrouter' are alternative backends usable with claude and codex harnesses.
export type ProviderBackend = 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';

export const PROVIDER_BACKEND_LABEL: Record<ProviderBackend, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

// Which backends are valid for each harness.
export const HARNESS_BACKENDS: Record<Provider, ProviderBackend[]> = {
  claude: ['anthropic', 'ollama', 'openrouter'],
  'claude-interactive': ['anthropic'],
  codex: ['openai', 'ollama', 'openrouter'],
  gemini: ['google'],
  pi: ['anthropic'],
};

// Native default backend per harness — used when backend is undefined.
export const DEFAULT_BACKEND: Record<Provider, ProviderBackend> = {
  claude: 'anthropic',
  'claude-interactive': 'anthropic',
  codex: 'openai',
  gemini: 'google',
  pi: 'anthropic',
};

// Hardcoded model lists per provider, surfaced in the Provider Priority UI.
// First entry is treated as the provider's default when no model is selected.
export const PROVIDER_MODELS: Record<Provider, string[]> = {
  claude: [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-7-1m',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  'claude-interactive': [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-7-1m',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
  gemini: ['gemini-3.5-flash', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  // Pi is model-agnostic and accepts any model string — free-text input is used in the UI.
  pi: [],
};

// User-friendly display names sourced from each provider's official documentation.
export const MODEL_LABEL: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-7-1m': 'Opus 4.7 1M',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 mini',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

// Effort levels for Claude Code CLI (--effort flag).
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'extra-high' | 'max';

export const CLAUDE_EFFORT_LABEL: Record<ClaudeEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra high',
  max: 'Max',
};

export const CLAUDE_EFFORT_VALUES: ClaudeEffort[] = ['low', 'medium', 'high', 'extra-high', 'max'];

// Reasoning levels for Codex CLI (--reasoning flag).
export type CodexReasoning = 'low' | 'medium' | 'high' | 'extra-high';

export const CODEX_REASONING_LABEL: Record<CodexReasoning, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra High',
};

export const CODEX_REASONING_VALUES: CodexReasoning[] = ['low', 'medium', 'high', 'extra-high'];

export interface ProviderEntry {
  provider: Provider;
  // Which API backend to use. Defaults to the harness's native backend when absent.
  backend?: ProviderBackend;
  // When undefined, the CLI is launched without --model and uses its own default.
  // Free text is allowed when backend is 'ollama' or 'openrouter'.
  model?: string;
  // Custom base URL for the backend (e.g. remote Ollama, non-default port).
  // Ignored when backend is undefined or a native backend.
  baseUrl?: string;
  // Claude-only: maps to --effort flag. Ignored for other providers.
  effort?: ClaudeEffort;
  // Codex-only: maps to --reasoning flag. Ignored for other providers.
  reasoning?: CodexReasoning;
}

export const DEFAULT_PROVIDER_ORDER: ProviderEntry[] = [
  { provider: 'claude' },
  { provider: 'codex' },
  { provider: 'gemini' },
];

const VALID_PROVIDERS: ReadonlySet<string> = new Set(['claude', 'claude-interactive', 'codex', 'gemini', 'pi']);
const VALID_CLAUDE_EFFORT: ReadonlySet<string> = new Set(CLAUDE_EFFORT_VALUES);
const VALID_CODEX_REASONING: ReadonlySet<string> = new Set(CODEX_REASONING_VALUES);

// Accepts both the legacy `Provider[]` shape and the new `ProviderEntry[]` shape.
// Returns a fresh array of valid entries. Unknown providers, backends, effort, and reasoning values are dropped.
// Model validation is skipped for ollama/openrouter backends — any non-empty string is accepted.
export function normalizeProviderOrder(raw: unknown): ProviderEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProviderEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (VALID_PROVIDERS.has(item)) out.push({ provider: item as Provider });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as {
        provider?: unknown;
        backend?: unknown;
        model?: unknown;
        baseUrl?: unknown;
        effort?: unknown;
        reasoning?: unknown;
      };
      if (typeof obj.provider !== 'string' || !VALID_PROVIDERS.has(obj.provider)) continue;
      const provider = obj.provider as Provider;

      // Validate backend: must be a value valid for this harness.
      const backend =
        typeof obj.backend === 'string' && (HARNESS_BACKENDS[provider] as string[]).includes(obj.backend)
          ? (obj.backend as ProviderBackend)
          : undefined;

      // Allow free-text model for ollama/openrouter, and always for pi (model-agnostic).
      const isOpenBackend = backend === 'ollama' || backend === 'openrouter' || provider === 'pi';
      const model =
        typeof obj.model === 'string' && obj.model.length > 0
          ? isOpenBackend || PROVIDER_MODELS[provider].includes(obj.model)
            ? obj.model
            : undefined
          : undefined;

      const baseUrl = typeof obj.baseUrl === 'string' && obj.baseUrl.length > 0 ? obj.baseUrl : undefined;

      const effort =
        (provider === 'claude' || provider === 'claude-interactive') &&
        typeof obj.effort === 'string' &&
        VALID_CLAUDE_EFFORT.has(obj.effort)
          ? (obj.effort as ClaudeEffort)
          : undefined;
      const reasoning =
        provider === 'codex' && typeof obj.reasoning === 'string' && VALID_CODEX_REASONING.has(obj.reasoning)
          ? (obj.reasoning as CodexReasoning)
          : undefined;
      out.push({ provider, backend, model, baseUrl, effort, reasoning });
    }
  }
  return out;
}
