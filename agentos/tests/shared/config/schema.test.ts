/**
 * Tests for the canonical config schema — src/shared/config/schema.ts.
 *
 * Covers the two parse modes (app strict-throw, project warn-and-ignore), schema
 * round-trip on representative app + project samples, unknown-key handling for both
 * modes, and the lenient project coercions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appSettingsPatchSchema,
  parseProjectConfig,
  PROJECT_CONFIG_KEYS,
  type AppSettings,
  type ProjectConfig,
} from '../../../src/shared/config/schema';

// A representative, fully-populated app settings object (the shape electron-store holds).
const SAMPLE_APP: AppSettings = {
  claudeStreamJson: true,
  skipPermissions: true,
  maxLogBufferSize: 2000,
  logRetentionDays: 30,
  persistDebugLogs: false,
  devMode: false,
  theme: 'dark',
  fontSize: 14,
  agents: {
    providerOrder: [{ provider: 'claude', backend: 'anthropic', model: 'claude-opus-4-8', effort: 'high' }],
    queueSilenceFallbackMs: 1500,
    autopilot: { enabled: true, maxConsecutiveTurns: 10, transcriptMessages: 25 },
  },
  apiKeys: { anthropic: 'sk-test' },
  memory: { rootPath: null, embeddingProvider: 'local', enabled: true },
  slack: {
    enabled: false,
    botToken: null,
    appToken: null,
    watchedChannelIds: [],
    channelWorkspaceMap: {},
    requireMention: false,
    defaultWorkingDirectory: null,
  },
  containers: { pruneIdleHours: 24, pruneMaxAgeDays: 7 },
  sandbox: {
    readOnlyRoot: false,
    dropAllCapabilities: true,
    noNewPrivileges: true,
    network: 'bridge',
    tmpfs: ['/tmp'],
  },
};

// ── App: strict parse mode ──────────────────────────────────────────────────────

test('app patch schema parses a full settings object (round-trip)', () => {
  const parsed = appSettingsPatchSchema.parse(SAMPLE_APP);
  assert.equal(parsed.theme, 'dark');
  assert.equal(parsed.agents?.providerOrder?.[0]?.model, 'claude-opus-4-8');
});

test('app patch schema parses a partial patch', () => {
  const parsed = appSettingsPatchSchema.parse({ devMode: true });
  assert.equal(parsed.devMode, true);
});

test('app patch schema THROWS on unknown top-level key', () => {
  assert.throws(() => appSettingsPatchSchema.parse({ bogusKey: 1 }));
});

test('app patch schema THROWS on invalid value', () => {
  assert.throws(() => appSettingsPatchSchema.parse({ theme: 'neon' }));
});

// ── Project: warn-and-ignore parse mode ─────────────────────────────────────────

test('project parse accepts a representative config with no warnings', () => {
  const raw = {
    version: 1,
    runOnHost: true,
    sandbox: { network: 'host', readOnlyRoot: true },
    memory: { enabled: false, maxResults: 12 },
    worktree: { autoCreate: false },
    agents: { providerOrder: [{ provider: 'codex' }] },
    kanban: { enabled: true, stages: { triage: { prompt: 'do x' } } },
  };
  const { config, warnings } = parseProjectConfig(raw);
  assert.equal(warnings.length, 0);
  assert.equal(config.version, 1);
  assert.equal(config.runOnHost, true);
  assert.equal(config.sandbox?.network, 'host');
  assert.equal(config.memory?.maxResults, 12);
  assert.equal(config.agents?.providerOrder?.[0]?.provider, 'codex');
});

test('project parse WARNS-and-ignores unknown top-level key (never throws)', () => {
  const { config, warnings } = parseProjectConfig({ bogusKey: 1, memory: { enabled: true } });
  assert.ok(warnings.some((w) => w.includes('bogusKey')));
  assert.equal(config.memory?.enabled, true);
  assert.equal((config as Record<string, unknown>).bogusKey, undefined);
});

test('project parse warns on non-object input', () => {
  const { warnings } = parseProjectConfig('nope');
  assert.ok(warnings.some((w) => w.includes('Expected top-level object')));
});

test('project parse drops an invalid block and warns', () => {
  const { config, warnings } = parseProjectConfig({ sandbox: { network: 'invalid-net' } });
  assert.equal(config.sandbox, undefined);
  assert.ok(warnings.some((w) => w.includes('sandbox')));
});

test('project parse strips app-only memory fields (no leak)', () => {
  const { config } = parseProjectConfig({
    memory: { enabled: true, rootPath: '/abs', embeddingProvider: 'openai', embeddingModel: 'x' },
  });
  assert.equal(config.memory?.enabled, true);
  assert.equal((config.memory as Record<string, unknown>).rootPath, undefined);
  assert.equal((config.memory as Record<string, unknown>).embeddingProvider, undefined);
});

// ── Lenient coercions ────────────────────────────────────────────────────────────

test('project providerOrder accepts legacy string form and drops invalid entries', () => {
  const { config } = parseProjectConfig({ agents: { providerOrder: ['claude', 'bogus', 'gemini'] } });
  assert.deepEqual(
    config.agents?.providerOrder?.map((e) => e.provider),
    ['claude', 'gemini']
  );
});

test('project personality migrates legacy profile → agentStyle', () => {
  const { config } = parseProjectConfig({ personality: { profile: 'terse and direct' } });
  assert.equal(config.personality?.agentStyle, 'terse and direct');
});

test('project personality with enabled:false is omitted entirely', () => {
  const { config } = parseProjectConfig({ personality: { enabled: false, agentStyle: 'x' } });
  assert.equal(config.personality, undefined);
});

test('project personality bigFive is all-five-or-omitted; history capped at 3', () => {
  const { config } = parseProjectConfig({
    personality: {
      agentStyle: 'x',
      bigFive: { openness: 3, conscientiousness: 3, extraversion: 3 }, // missing two
      history: [
        { agentStyle: 'a', autopilotInstructions: '', generatedAt: 1 },
        { agentStyle: 'b', autopilotInstructions: '', generatedAt: 2 },
        { agentStyle: 'c', autopilotInstructions: '', generatedAt: 3 },
        { agentStyle: 'd', autopilotInstructions: '', generatedAt: 4 },
      ],
    },
  });
  assert.equal(config.personality?.bigFive, undefined);
  assert.equal(config.personality?.history?.length, 3);
});

test('project apiKeys warns on legacy tailscale keys', () => {
  const { warnings } = parseProjectConfig({ apiKeys: { tailscaleAuthKey: 'tskey' } });
  assert.ok(warnings.some((w) => w.includes('tailscale')));
});

test('PROJECT_CONFIG_KEYS covers the documented top-level project keys', () => {
  assert.ok(PROJECT_CONFIG_KEYS.includes('agents'));
  assert.ok(PROJECT_CONFIG_KEYS.includes('personality'));
  assert.ok(!(PROJECT_CONFIG_KEYS as readonly string[]).includes('failover'));
});

// Type-level: a parsed project config is assignable where ProjectConfig is expected.
test('parsed project config is a ProjectConfig', () => {
  const { config } = parseProjectConfig({ version: 1 });
  const typed: ProjectConfig = config;
  assert.equal(typed.version, 1);
});
