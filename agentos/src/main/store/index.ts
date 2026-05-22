import { EventEmitter } from 'node:events';
import { safeStorage } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  DEFAULT_CONTAINER_PRUNE_SETTINGS,
  DEFAULT_PROVIDER_ORDER,
  DEFAULT_SLACK_SETTINGS,
  normalizeProviderOrder,
  type AppSettings,
} from '../../shared/types';

interface StoreSchema {
  settings: AppSettings;
  meta: {
    sandboxImageHash?: string;
    sandboxImageBuiltAt?: number;
    apiKeysEncrypted?: boolean; // legacy flag — superseded by secretsEncryptedV2
    secretsEncryptedV2?: boolean; // covers apiKeys + tailscaleAuthKey + githubToken + slack tokens
  };
}

const defaults: StoreSchema = {
  meta: {},
  settings: {
    claudeStreamJson: true,
    skipPermissions: true,
    providerOrder: [...DEFAULT_PROVIDER_ORDER],
    maxLogBufferSize: 2000,
    logRetentionDays: 30,
    queueSilenceFallbackMs: 1_500,
    persistDebugLogs: false,
    devMode: false,
    memoryRootPath: null,
    theme: 'dark',
    fontSize: 14,
    apiKeys: {},
    embeddingProvider: 'local',
    slack: { ...DEFAULT_SLACK_SETTINGS },
    containerPrune: { ...DEFAULT_CONTAINER_PRUNE_SETTINGS },
    autopilot: { ...DEFAULT_AUTOPILOT_SETTINGS },
  },
};

// ── Secret field encryption ────────────────────────────────────────────────────

const ENCRYPTED_PREFIX = 'enc:';

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptSecret(value: string): string {
  if (!value || !isEncryptionAvailable()) return value;
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch (err) {
    console.error('[store] Failed to encrypt secret:', err);
    return value;
  }
}

function decryptSecret(value: string): string {
  if (!value?.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'));
  } catch {
    // Return empty string rather than leaking the ciphertext blob to callers.
    return '';
  }
}

function transformApiKeys(keys: AppSettings['apiKeys'], fn: (v: string) => string): AppSettings['apiKeys'] {
  if (!keys) return keys;
  const result: NonNullable<AppSettings['apiKeys']> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (typeof v === 'string') (result as Record<string, string>)[k] = fn(v);
  }
  return result;
}

// Applies fn to all secret string fields: apiKeys.*, tailscaleAuthKey, githubToken,
// slack.botToken, slack.appToken.
function transformSecrets(settings: AppSettings, fn: (v: string) => string): AppSettings {
  const result = { ...settings };
  if (result.apiKeys) result.apiKeys = transformApiKeys(result.apiKeys, fn);
  if (typeof result.tailscaleAuthKey === 'string') result.tailscaleAuthKey = fn(result.tailscaleAuthKey);
  if (typeof result.githubToken === 'string') result.githubToken = fn(result.githubToken);
  if (result.slack) {
    const slack = { ...result.slack };
    if (typeof slack.botToken === 'string') slack.botToken = fn(slack.botToken);
    if (typeof slack.appToken === 'string') slack.appToken = fn(slack.appToken);
    result.slack = slack;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

let store: Store<StoreSchema> | null = null;

export function getStore(): Store<StoreSchema> {
  if (!store) {
    const cwd = process.env.AGENTOS_STORE_DIR?.trim() || undefined;
    store = new Store<StoreSchema>({
      defaults,
      serialize: (data) => {
        const s = (data as StoreSchema).settings;
        const encrypted = s ? transformSecrets(s, encryptSecret) : s;
        return JSON.stringify({ ...(data as StoreSchema), settings: encrypted }, null, '\t');
      },
      deserialize: (text) => {
        const parsed = JSON.parse(text) as StoreSchema;
        const s = parsed.settings;
        if (s) parsed.settings = transformSecrets(s, decryptSecret);
        return parsed;
      },
      ...(cwd ? { cwd } : {}),
    });

    // Run all startup migrations in one in-memory pass, then write at most twice
    // (once for settings changes, once for meta).
    let settings = store.get('settings');
    const meta = store.get('meta');
    let settingsChanged = false;

    // Migration: normalize legacy providerOrder (Provider[] → ProviderEntry[])
    const raw = settings.providerOrder;
    const normalized = normalizeProviderOrder(raw);
    const needsRewrite =
      !Array.isArray(raw) ||
      raw.length !== normalized.length ||
      raw.some((item) => typeof item !== 'object' || item === null);
    if (normalized.length === 0) {
      settings = { ...settings, providerOrder: [...DEFAULT_PROVIDER_ORDER] };
      settingsChanged = true;
    } else if (needsRewrite) {
      settings = { ...settings, providerOrder: normalized };
      settingsChanged = true;
    }

    // Migration: strip legacy failover key
    if ('failover' in (settings as unknown as Record<string, unknown>)) {
      const { failover: _removed, ...rest } = settings as AppSettings & { failover?: unknown };
      settings = rest as AppSettings;
      settingsChanged = true;
    }

    // Migration: swap stored voiceFlow.key 'Space' → 'Alt' (default changed; Space proved
    // too easy to mis-hold during normal typing).
    if (settings.voiceFlow?.key === 'Space') {
      settings = { ...settings, voiceFlow: { ...settings.voiceFlow, key: 'Alt' } };
      settingsChanged = true;
    }

    // Encryption migration: force a serialize pass so all secret fields get encrypted.
    // secretsEncryptedV2 covers more fields than the legacy apiKeysEncrypted flag.
    if (isEncryptionAvailable() && !meta.secretsEncryptedV2) {
      settingsChanged = true;
    }

    if (settingsChanged) {
      store.set('settings', settings);
    }

    if (isEncryptionAvailable() && !meta.secretsEncryptedV2) {
      store.set('meta', { ...meta, secretsEncryptedV2: true });
    }
  }
  return store;
}

export function resetStoreForTests(): void {
  store = null;
  settingsEvents.removeAllListeners();
}

export const settingsEvents = new EventEmitter();

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  if (Object.keys(patch).length === 0) return getStore().get('settings');
  const s = getStore();
  const updated = { ...s.get('settings'), ...patch };
  s.set('settings', updated);
  settingsEvents.emit('change', updated);
  return updated;
}
