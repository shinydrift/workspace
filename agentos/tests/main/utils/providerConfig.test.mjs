/**
 * Tests for utils/providerConfig.ts — PROVIDER_CONFIGS, getPrimaryProvider, getApiKey.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from providerConfig.ts ───────────────────────────────────────────

const DEFAULT_BACKEND = { claude: 'anthropic', codex: 'openai', gemini: 'google' };
const HARNESS_BACKENDS = {
  claude: ['anthropic', 'ollama', 'openrouter'],
  codex: ['openai', 'ollama', 'openrouter'],
  gemini: ['google'],
};

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

function buildBackendEnv(provider, backend, baseUrl, apiKey) {
  const effectiveBackend = backend ?? DEFAULT_BACKEND[provider];
  if (effectiveBackend === 'ollama') {
    const url = (baseUrl?.replace(/\/$/, '')) || OLLAMA_DEFAULT_BASE_URL;
    if (provider === 'claude') return { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: 'ollama' };
    if (provider === 'codex') return { OPENAI_BASE_URL: `${url}/v1`, OPENAI_API_KEY: 'ollama' };
  }
  if (effectiveBackend === 'openrouter') {
    if (provider === 'claude') {
      return {
        ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: apiKey ?? '',
        ANTHROPIC_API_KEY: '',
      };
    }
    if (provider === 'codex') {
      return { OPENAI_BASE_URL: `${OPENROUTER_BASE_URL}/v1`, OPENAI_API_KEY: apiKey ?? '' };
    }
  }
  return {};
}

const PROVIDER_CONFIGS = {
  claude: {
    binaryName: 'claude',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    displayName: 'Claude',
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
};

const DEFAULT_PROVIDER_ORDER = [{ provider: 'claude' }, { provider: 'codex' }, { provider: 'gemini' }];
const VALID_PROVIDERS = new Set(['claude', 'codex', 'gemini']);
const PROVIDER_MODELS = {
  claude: ['claude-opus-4-7', 'claude-opus-4-7-1m', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  codex: ['o3', 'o4-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o'],
  gemini: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
};

function normalizeProviderOrder(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (VALID_PROVIDERS.has(item)) out.push({ provider: item });
      continue;
    }
    if (item && typeof item === 'object' && typeof item.provider === 'string' && VALID_PROVIDERS.has(item.provider)) {
      const model =
        typeof item.model === 'string' && PROVIDER_MODELS[item.provider].includes(item.model) ? item.model : undefined;
      out.push({ provider: item.provider, model });
    }
  }
  return out;
}

function getPrimaryProvider(settings) {
  const normalized = normalizeProviderOrder(settings.providerOrder);
  const order = normalized.length > 0 ? normalized : DEFAULT_PROVIDER_ORDER;
  return order[0]?.provider ?? 'claude';
}

function getApiKey(provider, apiKeys, backend) {
  if (!apiKeys) return undefined;
  const effectiveBackend = backend ?? DEFAULT_BACKEND[provider];
  if (effectiveBackend === 'openrouter') return apiKeys.openrouter;
  if (effectiveBackend === 'ollama') return undefined;
  if (provider === 'claude') return apiKeys.anthropic;
  if (provider === 'codex') return apiKeys.openai;
  return apiKeys.google;
}

// ── PROVIDER_CONFIGS ──────────────────────────────────────────────────────────

test('all three providers are defined', () => {
  assert.ok('claude' in PROVIDER_CONFIGS);
  assert.ok('codex' in PROVIDER_CONFIGS);
  assert.ok('gemini' in PROVIDER_CONFIGS);
});

test('claude config has correct binary name', () => {
  assert.equal(PROVIDER_CONFIGS.claude.binaryName, 'claude');
});

test('codex config has correct binary name', () => {
  assert.equal(PROVIDER_CONFIGS.codex.binaryName, 'codex');
});

test('gemini config has correct binary name', () => {
  assert.equal(PROVIDER_CONFIGS.gemini.binaryName, 'gemini');
});

test('claude uses ANTHROPIC_API_KEY env var', () => {
  assert.equal(PROVIDER_CONFIGS.claude.apiKeyEnvVar, 'ANTHROPIC_API_KEY');
});

test('codex uses OPENAI_API_KEY env var', () => {
  assert.equal(PROVIDER_CONFIGS.codex.apiKeyEnvVar, 'OPENAI_API_KEY');
});

test('gemini uses GOOGLE_API_KEY env var', () => {
  assert.equal(PROVIDER_CONFIGS.gemini.apiKeyEnvVar, 'GOOGLE_API_KEY');
});

test('all providers support headless mode', () => {
  for (const cfg of Object.values(PROVIDER_CONFIGS)) {
    assert.equal(cfg.supportsHeadless, true);
  }
});

test('each provider has a session config dir', () => {
  for (const cfg of Object.values(PROVIDER_CONFIGS)) {
    assert.ok(typeof cfg.sessionConfigDir === 'string' && cfg.sessionConfigDir.length > 0);
  }
});

test('session config dirs are distinct', () => {
  const dirs = Object.values(PROVIDER_CONFIGS).map((c) => c.sessionConfigDir);
  const unique = new Set(dirs);
  assert.equal(unique.size, dirs.length);
});

// ── getPrimaryProvider ────────────────────────────────────────────────────────

test('getPrimaryProvider returns first of providerOrder (legacy string array)', () => {
  const result = getPrimaryProvider({ providerOrder: ['gemini', 'claude'] });
  assert.equal(result, 'gemini');
});

test('getPrimaryProvider returns first of providerOrder (entry array)', () => {
  const result = getPrimaryProvider({ providerOrder: [{ provider: 'gemini', model: 'gemini-3-pro-preview' }, { provider: 'claude' }] });
  assert.equal(result, 'gemini');
});

test('normalizeProviderOrder allows duplicate providers with different models', () => {
  const out = normalizeProviderOrder([
    { provider: 'claude', model: 'claude-opus-4-7' },
    { provider: 'claude', model: 'claude-sonnet-4-6' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].model, 'claude-opus-4-7');
  assert.equal(out[1].model, 'claude-sonnet-4-6');
});

test('normalizeProviderOrder drops invalid models', () => {
  const out = normalizeProviderOrder([{ provider: 'claude', model: 'not-a-real-model' }]);
  assert.equal(out[0].model, undefined);
});

test('getPrimaryProvider defaults to claude with no settings', () => {
  const result = getPrimaryProvider({});
  assert.equal(result, 'claude');
});

test('getPrimaryProvider defaults to claude with empty providerOrder', () => {
  const result = getPrimaryProvider({ providerOrder: [] });
  assert.equal(result, 'claude');
});

test('getPrimaryProvider defaults to claude with non-array providerOrder', () => {
  const result = getPrimaryProvider({ providerOrder: 'claude' });
  assert.equal(result, 'claude');
});

test('getPrimaryProvider uses default order: claude first', () => {
  const result = getPrimaryProvider({ providerOrder: DEFAULT_PROVIDER_ORDER });
  assert.equal(result, 'claude');
});

test('getPrimaryProvider handles single-element order', () => {
  const result = getPrimaryProvider({ providerOrder: [{ provider: 'codex' }] });
  assert.equal(result, 'codex');
});

// ── getApiKey ─────────────────────────────────────────────────────────────────

test('getApiKey returns anthropic key for claude', () => {
  const result = getApiKey('claude', { anthropic: 'sk-claude', openai: 'sk-openai', google: 'gk' });
  assert.equal(result, 'sk-claude');
});

test('getApiKey returns openai key for codex', () => {
  const result = getApiKey('codex', { anthropic: 'sk-claude', openai: 'sk-openai', google: 'gk' });
  assert.equal(result, 'sk-openai');
});

test('getApiKey returns google key for gemini', () => {
  const result = getApiKey('gemini', { anthropic: 'sk-claude', openai: 'sk-openai', google: 'gk' });
  assert.equal(result, 'gk');
});

test('getApiKey returns undefined when apiKeys is undefined', () => {
  assert.equal(getApiKey('claude', undefined), undefined);
});

test('getApiKey returns undefined when key is missing', () => {
  assert.equal(getApiKey('claude', {}), undefined);
});

test('getApiKey returns undefined for gemini with no google key', () => {
  assert.equal(getApiKey('gemini', { anthropic: 'sk' }), undefined);
});

test('getApiKey returns undefined for ollama backend regardless of provider', () => {
  assert.equal(getApiKey('claude', { anthropic: 'sk-real' }, 'ollama'), undefined);
  assert.equal(getApiKey('codex', { openai: 'sk-real' }, 'ollama'), undefined);
});

test('getApiKey returns openrouter key for openrouter backend', () => {
  const keys = { anthropic: 'sk-ant', openai: 'sk-oai', openrouter: 'sk-or-v1-x' };
  assert.equal(getApiKey('claude', keys, 'openrouter'), 'sk-or-v1-x');
  assert.equal(getApiKey('codex', keys, 'openrouter'), 'sk-or-v1-x');
});

test('getApiKey returns native key when no backend specified', () => {
  const keys = { anthropic: 'sk-ant', openai: 'sk-oai', openrouter: 'sk-or' };
  assert.equal(getApiKey('claude', keys, undefined), 'sk-ant');
  assert.equal(getApiKey('codex', keys, undefined), 'sk-oai');
});

// ── buildBackendEnv ───────────────────────────────────────────────────────────

test('buildBackendEnv returns {} for native claude', () => {
  assert.deepEqual(buildBackendEnv('claude', undefined, undefined, 'sk-ant'), {});
  assert.deepEqual(buildBackendEnv('claude', 'anthropic', undefined, 'sk-ant'), {});
});

test('buildBackendEnv returns {} for native codex', () => {
  assert.deepEqual(buildBackendEnv('codex', undefined, undefined, 'sk-oai'), {});
  assert.deepEqual(buildBackendEnv('codex', 'openai', undefined, 'sk-oai'), {});
});

test('buildBackendEnv returns {} for gemini', () => {
  assert.deepEqual(buildBackendEnv('gemini', undefined, undefined, 'gk'), {});
});

test('buildBackendEnv claude+ollama uses default URL when baseUrl absent', () => {
  const env = buildBackendEnv('claude', 'ollama', undefined, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'ollama');
  assert.equal('ANTHROPIC_API_KEY' in env, false, 'must not inject ANTHROPIC_API_KEY');
});

test('buildBackendEnv claude+ollama uses custom baseUrl', () => {
  const env = buildBackendEnv('claude', 'ollama', 'http://192.168.1.5:11434/', undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://192.168.1.5:11434');
});

test('buildBackendEnv codex+ollama appends /v1 to URL', () => {
  const env = buildBackendEnv('codex', 'ollama', undefined, undefined);
  assert.equal(env.OPENAI_BASE_URL, 'http://localhost:11434/v1');
  assert.equal(env.OPENAI_API_KEY, 'ollama');
});

test('buildBackendEnv codex+ollama custom URL appends /v1 and strips trailing slash', () => {
  const env = buildBackendEnv('codex', 'ollama', 'http://remote:11434/', undefined);
  assert.equal(env.OPENAI_BASE_URL, 'http://remote:11434/v1');
});

test('buildBackendEnv claude+openrouter sets bearer token and clears api key', () => {
  const env = buildBackendEnv('claude', 'openrouter', undefined, 'sk-or-v1-x');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-or-v1-x');
  assert.equal(env.ANTHROPIC_API_KEY, '');
});

test('buildBackendEnv claude+openrouter uses empty string when key missing', () => {
  const env = buildBackendEnv('claude', 'openrouter', undefined, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, '');
});

test('buildBackendEnv codex+openrouter sets OPENAI vars', () => {
  const env = buildBackendEnv('codex', 'openrouter', undefined, 'sk-or-v1-x');
  assert.equal(env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(env.OPENAI_API_KEY, 'sk-or-v1-x');
});

// ── resolveProviderCommand ──────────────────────────────────────────────────────

function resolveProviderCommand(provider, overrides) {
  const tokens = overrides?.[provider]?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length > 0) {
    const [command, ...prefixArgs] = tokens;
    return { command, prefixArgs };
  }
  return { command: PROVIDER_CONFIGS[provider].binaryName, prefixArgs: [] };
}

test('resolveProviderCommand falls back to default binary when overrides absent', () => {
  assert.deepEqual(resolveProviderCommand('claude', undefined), { command: 'claude', prefixArgs: [] });
  assert.deepEqual(resolveProviderCommand('codex', {}), { command: 'codex', prefixArgs: [] });
});

test('resolveProviderCommand falls back to default binary when override is blank/whitespace', () => {
  assert.deepEqual(resolveProviderCommand('claude', { claude: '' }), { command: 'claude', prefixArgs: [] });
  assert.deepEqual(resolveProviderCommand('claude', { claude: '   ' }), { command: 'claude', prefixArgs: [] });
});

test('resolveProviderCommand single-token override yields command with no prefix args', () => {
  assert.deepEqual(resolveProviderCommand('claude', { claude: 'aifx' }), { command: 'aifx', prefixArgs: [] });
});

test('resolveProviderCommand multi-token override splits into command + prefix args', () => {
  assert.deepEqual(resolveProviderCommand('claude', { claude: 'aifx agent claude' }), {
    command: 'aifx',
    prefixArgs: ['agent', 'claude'],
  });
});

test('resolveProviderCommand collapses extra/leading/trailing whitespace', () => {
  assert.deepEqual(resolveProviderCommand('codex', { codex: '  aifx   agent  codex  ' }), {
    command: 'aifx',
    prefixArgs: ['agent', 'codex'],
  });
});

test('resolveProviderCommand only applies the override for the matching provider', () => {
  const overrides = { claude: 'aifx agent claude' };
  assert.deepEqual(resolveProviderCommand('codex', overrides), { command: 'codex', prefixArgs: [] });
});
