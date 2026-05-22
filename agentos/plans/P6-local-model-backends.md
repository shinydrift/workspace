# P6 — Local & Open-Source Model Backends (Ollama + OpenRouter)

## Goal

Let any thread's provider entry point its CLI harness (claude or codex) at a non-native backend: Ollama (local) or OpenRouter (cloud aggregator). Gemini stays native-only.

---

## Data Model

### New: `ProviderBackend` type (`src/shared/types/provider.ts`)

```typescript
export type ProviderBackend = 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';

// Which backends are valid per harness:
export const HARNESS_BACKENDS: Record<Provider, ProviderBackend[]> = {
  claude: ['anthropic', 'ollama', 'openrouter'],
  codex:  ['openai',   'ollama', 'openrouter'],
  gemini: ['google'],
};

// Native default per harness (backend=undefined falls back to this):
export const DEFAULT_BACKEND: Record<Provider, ProviderBackend> = {
  claude: 'anthropic',
  codex:  'openai',
  gemini: 'google',
};

export const PROVIDER_BACKEND_LABEL: Record<ProviderBackend, string> = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  google:     'Google',
  ollama:     'Ollama',
  openrouter: 'OpenRouter',
};
```

### Updated `ProviderEntry`

```typescript
export interface ProviderEntry {
  provider:  Provider;           // harness: 'claude' | 'codex' | 'gemini'
  backend?:  ProviderBackend;    // NEW — defaults to native if absent
  model?:    string;             // free-text allowed when backend=ollama|openrouter
  baseUrl?:  string;             // NEW — Ollama host override (default http://localhost:11434)
  effort?:   ClaudeEffort;       // claude only
  reasoning?: CodexReasoning;    // codex only
}
```

### `normalizeProviderOrder` changes
- Accept `backend` field; drop unknown values via `HARNESS_BACKENDS`.
- Model validation: skip `PROVIDER_MODELS` check when `backend === 'ollama' || backend === 'openrouter'`; allow any non-empty string.
- Accept `baseUrl` as a string; drop if not a string.

---

## API Key Storage

### `src/shared/types/settings.ts` — `AppSettings.apiKeys`
```typescript
apiKeys?: {
  anthropic?:  string;
  openai?:     string;
  google?:     string;
  openrouter?: string;   // NEW
  voyage?:     string;
  mistral?:    string;
};
```

### `src/shared/types/project.ts` — `ProjectConfig.apiKeys`
```typescript
apiKeys?: {
  ...
  openrouter?: string;   // NEW
};
```

### `src/main/config/projectConfig.ts`
- Add `'openrouter'` to the `stringKeys` list inside the `apiKeys` validation block.

---

## Backend → Env Var Mapping

Default base URLs (baked in, overridable via `baseUrl` on the entry):

| Backend    | Default base URL                     |
|------------|--------------------------------------|
| ollama     | `http://localhost:11434`             |
| openrouter | `https://openrouter.ai/api`          |

Env vars injected per harness+backend combo:

| Harness | Backend    | Env vars injected                                                                 |
|---------|----------|-----------------------------------------------------------------------------------|
| claude  | ollama     | `ANTHROPIC_BASE_URL=<url>`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=`   |
| claude  | openrouter | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<or_key>`  |
| codex   | ollama     | `OPENAI_BASE_URL=<url>/v1`, `OPENAI_API_KEY=ollama`                              |
| codex   | openrouter | `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_API_KEY=<or_key>`        |

---

## Implementation Steps

### Step 1 — Types (no runtime effect)
File: `src/shared/types/provider.ts`
- Add `ProviderBackend`, `HARNESS_BACKENDS`, `DEFAULT_BACKEND`, `PROVIDER_BACKEND_LABEL`
- Add `backend?`, `baseUrl?` to `ProviderEntry`
- Update `normalizeProviderOrder`

Files: `src/shared/types/settings.ts`, `src/shared/types/project.ts`
- Add `openrouter?` to `apiKeys`

Verify: `npx tsc --noEmit` passes.

### Step 2 — providerConfig.ts: getApiKey + backend env builder
File: `src/main/utils/providerConfig.ts`
- Update `getApiKey` signature: `getApiKey(provider, apiKeys, backend?)` — returns `openrouter` key when `backend === 'openrouter'`, else existing logic.
- Add `buildBackendEnv(provider, backend, baseUrl, apiKey)` helper — returns `Record<string, string>` of env vars to inject (empty for native backends).

### Step 3 — threadStartConfig.ts: resolve + inject backend env
File: `src/main/sessions/threadStartConfig.ts`
- After resolving `apiKey`, resolve the effective `ProviderEntry` for the primary provider.
- Call `buildBackendEnv` with resolved backend/baseUrl/key.
- Merge result into the `extraEnv` block already built in `resolveStartConfig` — it flows through `buildThreadLaunchArgs` → `buildDockerRunArgs` → container env.
- No changes needed to `buildDockerRunArgs` or `buildThreadLaunchArgs`.

### Step 4 — projectConfig.ts: accept openrouter key
File: `src/main/config/projectConfig.ts`
- Add `'openrouter'` to string key list in `apiKeys` block.

### Step 5 — Settings UI: OpenRouter key
File: `src/renderer/components/settings/KeysTab.tsx`
- Add `SecretField` for OpenRouter API key, between OpenAI and Google sections.
- Wire to `keys.openrouter` / `keys.setOpenrouter` (follow same pattern as other keys).

File: `src/renderer/contexts/SettingsContext.tsx` (or wherever key state lives)
- Add `openrouter` key getter/setter following the same pattern as `anthropic`, `openai`.

### Step 6 — ProviderModelBadges: backend column + free-text model
File: `src/renderer/components/threads/ProviderModelBadges.tsx`
- Add `backend?`, `baseUrl?` props + `onBackendChange`, `onBaseUrlChange` callbacks.
- Add "Backend" column in the popover (between Provider and Model).
  - Only shows backends valid for current harness via `HARNESS_BACKENDS[provider]`.
- Model column: when `backend === 'ollama' || backend === 'openrouter'`, render a controlled text input instead of the button list.
- When backend=ollama: show a "Base URL" text input below (collapsed/inline, placeholder `http://localhost:11434`).
- Summary label includes backend when non-native: `Claude · Ollama · qwen3:8b`.

### Step 7 — ProviderPriorityList: pass new props
File: `src/renderer/components/settings/ProviderPriorityList.tsx`
- Add `onBackendChange` and `onBaseUrlChange` to the `ProviderModelBadges` call.
- Wire them to update the entry's `backend` and `baseUrl` fields.

### Step 8 — AgentsTab / project config UI (if provider priority exposed there)
- Same wiring as Step 7 wherever `ProviderPriorityList` appears in project-level settings.

---

## Files Touched (summary)

| File | Change |
|------|--------|
| `src/shared/types/provider.ts` | New types, updated ProviderEntry, updated normalizeProviderOrder |
| `src/shared/types/settings.ts` | Add `openrouter?` to apiKeys |
| `src/shared/types/project.ts` | Add `openrouter?` to apiKeys |
| `src/main/utils/providerConfig.ts` | Update getApiKey, add buildBackendEnv |
| `src/main/sessions/threadStartConfig.ts` | Resolve + inject backend env vars |
| `src/main/config/projectConfig.ts` | Accept openrouter key |
| `src/renderer/components/settings/KeysTab.tsx` | OpenRouter key field |
| `src/renderer/contexts/SettingsContext.tsx` | openrouter key state |
| `src/renderer/components/threads/ProviderModelBadges.tsx` | Backend column, free-text model, baseUrl input |
| `src/renderer/components/settings/ProviderPriorityList.tsx` | Wire new ProviderModelBadges props |

---

## What Does NOT Change

- `buildDockerRunArgs` — no new params; backend env flows via existing `extraEnv`
- `buildDockerExecArgs` — no changes; base URL is baked into container env at start
- `headlessRunner.ts` — no changes; API key and model already resolved upstream
- Effort/reasoning — unchanged; remains harness-level, passed through regardless of backend
- Gemini — no changes; no backend override mechanism exists for it
- Provider failover logic — no changes; failover still operates on the harness level

---

## Acceptance Criteria

1. A claude entry with `backend: 'ollama'` starts a container with `ANTHROPIC_BASE_URL=http://localhost:11434` and `ANTHROPIC_AUTH_TOKEN=ollama` in its env.
2. A codex entry with `backend: 'openrouter'` and an OpenRouter key starts with `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and `OPENAI_API_KEY=<key>`.
3. `normalizeProviderOrder` accepts any string model when backend=ollama|openrouter.
4. Native entries (no backend) behave identically to current behaviour.
5. `npx tsc --noEmit` and `npx eslint` pass with zero new errors.
