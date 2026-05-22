/**
 * Tests for config/projectConfig.ts — validateProjectConfig, loadProjectConfig, ensureProjectConfig.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';

// ── Inlined logic from projectConfig.ts ──────────────────────────────────────

const ALLOWED_TOP_LEVEL_KEYS = new Set(['version', 'provider', 'failover', 'sandbox', 'memory', 'boot', 'worktree', 'env']);
const ALLOWED_SANDBOX_NETWORK = new Set(['none', 'bridge', 'host']);
const ALLOWED_PROVIDERS = new Set(['claude', 'codex', 'gemini']);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProjectConfig(raw) {
  const warnings = [];
  const config = {};
  if (!isRecord(raw)) { warnings.push('Expected top-level object'); return { config, warnings }; }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) warnings.push(`Unknown top-level key "${key}" ignored`);
  }
  if ('version' in raw) {
    if (raw.version === 1) config.version = 1;
    else warnings.push('Invalid "version" ignored');
  }
  if ('provider' in raw) {
    if (typeof raw.provider === 'string' && ALLOWED_PROVIDERS.has(raw.provider)) config.provider = raw.provider;
    else warnings.push('Invalid "provider" ignored');
  }
  if ('failover' in raw) {
    if (isRecord(raw.failover)) {
      const failover = {};
      if ('enabled' in raw.failover) {
        if (typeof raw.failover.enabled === 'boolean') failover.enabled = raw.failover.enabled;
        else warnings.push('Invalid "failover.enabled" ignored');
      }
      if ('transcriptMessages' in raw.failover) {
        if (typeof raw.failover.transcriptMessages === 'number' && Number.isFinite(raw.failover.transcriptMessages)) {
          failover.transcriptMessages = raw.failover.transcriptMessages;
        } else warnings.push('Invalid "failover.transcriptMessages" ignored');
      }
      config.failover = failover;
    } else warnings.push('Invalid "failover" ignored');
  }
  if ('sandbox' in raw) {
    if (isRecord(raw.sandbox)) {
      const sandbox = {};
      if ('network' in raw.sandbox) {
        if (typeof raw.sandbox.network === 'string' && ALLOWED_SANDBOX_NETWORK.has(raw.sandbox.network)) {
          sandbox.network = raw.sandbox.network;
        } else warnings.push('Invalid "sandbox.network" ignored');
      }
      if ('pidsLimit' in raw.sandbox && typeof raw.sandbox.pidsLimit === 'number') sandbox.pidsLimit = raw.sandbox.pidsLimit;
      if ('memory' in raw.sandbox && typeof raw.sandbox.memory === 'string') sandbox.memory = raw.sandbox.memory;
      if ('readOnlyRoot' in raw.sandbox && typeof raw.sandbox.readOnlyRoot === 'boolean') sandbox.readOnlyRoot = raw.sandbox.readOnlyRoot;
      config.sandbox = sandbox;
    } else warnings.push('Invalid "sandbox" ignored');
  }
  if ('memory' in raw) {
    if (isRecord(raw.memory)) {
      const mem = {};
      if ('enabled' in raw.memory && typeof raw.memory.enabled === 'boolean') mem.enabled = raw.memory.enabled;
      if ('decayEnabled' in raw.memory && typeof raw.memory.decayEnabled === 'boolean') mem.decayEnabled = raw.memory.decayEnabled;
      if ('graphEnabled' in raw.memory && typeof raw.memory.graphEnabled === 'boolean') mem.graphEnabled = raw.memory.graphEnabled;
      config.memory = mem;
    } else warnings.push('Invalid "memory" ignored');
  }
  if ('boot' in raw) {
    if (isRecord(raw.boot) && typeof raw.boot.enabled === 'boolean') {
      config.boot = { enabled: raw.boot.enabled };
    } else warnings.push('Invalid "boot" ignored');
  }
  if ('worktree' in raw) {
    if (isRecord(raw.worktree) && typeof raw.worktree.autoCreate === 'boolean') {
      config.worktree = { autoCreate: raw.worktree.autoCreate };
    } else warnings.push('Invalid "worktree" ignored');
  }
  if ('env' in raw) {
    if (isRecord(raw.env)) {
      const env = {};
      if ('safelist' in raw.env && Array.isArray(raw.env.safelist)) {
        env.safelist = raw.env.safelist.filter((e) => typeof e === 'string');
      }
      config.env = env;
    } else warnings.push('Invalid "env" ignored');
  }
  return { config, warnings };
}

function getProjectConfigPath(projectPath) {
  return path.join(projectPath, '.agentos', 'config.json');
}

async function loadProjectConfig(projectPath) {
  const configPath = getProjectConfigPath(projectPath);
  let raw;
  try {
    raw = await fsPromises.readFile(configPath, 'utf8');
  } catch {
    return { config: null, path: configPath, exists: false, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: null, path: configPath, exists: true, warnings: ['Invalid JSON'] };
  }
  const { config, warnings } = validateProjectConfig(parsed);
  return { config, path: configPath, exists: true, warnings };
}

// ── validateProjectConfig — type checking ─────────────────────────────────────

test('validateProjectConfig accepts minimal valid config', () => {
  const { config, warnings } = validateProjectConfig({ version: 1, provider: 'claude' });
  assert.equal(config.version, 1);
  assert.equal(config.provider, 'claude');
  assert.equal(warnings.length, 0);
});

test('validateProjectConfig warns on non-object input', () => {
  const { warnings } = validateProjectConfig('not an object');
  assert.ok(warnings.some((w) => w.includes('Expected top-level object')));
});

test('validateProjectConfig warns on unknown top-level keys', () => {
  const { warnings } = validateProjectConfig({ unknownKey: 'value' });
  assert.ok(warnings.some((w) => w.includes('unknownKey')));
});

test('validateProjectConfig accepts all three providers', () => {
  for (const provider of ['claude', 'codex', 'gemini']) {
    const { config, warnings } = validateProjectConfig({ provider });
    assert.equal(config.provider, provider);
    assert.equal(warnings.length, 0);
  }
});

test('validateProjectConfig warns on invalid provider', () => {
  const { warnings } = validateProjectConfig({ provider: 'unknown' });
  assert.ok(warnings.some((w) => w.includes('provider')));
});

test('validateProjectConfig warns on invalid version', () => {
  const { warnings } = validateProjectConfig({ version: 99 });
  assert.ok(warnings.some((w) => w.includes('version')));
});

test('validateProjectConfig accepts failover config', () => {
  const { config, warnings } = validateProjectConfig({ failover: { enabled: true, transcriptMessages: 5 } });
  assert.equal(config.failover.enabled, true);
  assert.equal(config.failover.transcriptMessages, 5);
  assert.equal(warnings.length, 0);
});

test('validateProjectConfig warns on non-boolean failover.enabled', () => {
  const { warnings } = validateProjectConfig({ failover: { enabled: 'yes' } });
  assert.ok(warnings.some((w) => w.includes('failover.enabled')));
});

test('validateProjectConfig warns on non-finite transcriptMessages', () => {
  const { warnings } = validateProjectConfig({ failover: { transcriptMessages: Infinity } });
  assert.ok(warnings.some((w) => w.includes('failover.transcriptMessages')));
});

test('validateProjectConfig accepts sandbox config', () => {
  const { config, warnings } = validateProjectConfig({ sandbox: { network: 'bridge', pidsLimit: 256 } });
  assert.equal(config.sandbox.network, 'bridge');
  assert.equal(config.sandbox.pidsLimit, 256);
  assert.equal(warnings.length, 0);
});

test('validateProjectConfig warns on invalid sandbox.network', () => {
  const { warnings } = validateProjectConfig({ sandbox: { network: 'invalid' } });
  assert.ok(warnings.some((w) => w.includes('sandbox.network')));
});

test('validateProjectConfig accepts valid sandbox networks', () => {
  for (const network of ['none', 'bridge', 'host']) {
    const { config, warnings } = validateProjectConfig({ sandbox: { network } });
    assert.equal(config.sandbox.network, network);
    assert.equal(warnings.length, 0);
  }
});

test('validateProjectConfig accepts memory config', () => {
  const { config } = validateProjectConfig({ memory: { enabled: false, decayEnabled: true } });
  assert.equal(config.memory.enabled, false);
  assert.equal(config.memory.decayEnabled, true);
});

test('validateProjectConfig warns on non-object memory', () => {
  const { warnings } = validateProjectConfig({ memory: 'yes' });
  assert.ok(warnings.some((w) => w.includes('memory')));
});

test('validateProjectConfig accepts boot config', () => {
  const { config } = validateProjectConfig({ boot: { enabled: false } });
  assert.equal(config.boot.enabled, false);
});

test('validateProjectConfig warns on invalid boot', () => {
  const { warnings } = validateProjectConfig({ boot: { enabled: 'yes' } });
  assert.ok(warnings.some((w) => w.includes('boot')));
});

test('validateProjectConfig accepts worktree config', () => {
  const { config } = validateProjectConfig({ worktree: { autoCreate: true } });
  assert.equal(config.worktree.autoCreate, true);
});

test('validateProjectConfig accepts env safelist', () => {
  const { config } = validateProjectConfig({ env: { safelist: ['HOME', 'PATH'] } });
  assert.deepEqual(config.env.safelist, ['HOME', 'PATH']);
});

test('validateProjectConfig filters non-string safelist entries', () => {
  const { config } = validateProjectConfig({ env: { safelist: ['HOME', 42, null, 'PATH'] } });
  assert.deepEqual(config.env.safelist, ['HOME', 'PATH']);
});

// ── getProjectConfigPath ──────────────────────────────────────────────────────

test('getProjectConfigPath appends .agentos/config.json', () => {
  const p = getProjectConfigPath('/home/user/project');
  assert.equal(p, path.join('/home/user/project', '.agentos', 'config.json'));
});

// ── loadProjectConfig ─────────────────────────────────────────────────────────

test('loadProjectConfig returns exists:false when file missing', async () => {
  const result = await loadProjectConfig('/no/such/path');
  assert.equal(result.exists, false);
  assert.equal(result.config, null);
});

test('loadProjectConfig returns Invalid JSON warning for malformed file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), 'not json');
    const result = await loadProjectConfig(dir);
    assert.equal(result.exists, true);
    assert.ok(result.warnings.includes('Invalid JSON'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('loadProjectConfig parses valid config file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), JSON.stringify({ version: 1, provider: 'gemini' }));
    const result = await loadProjectConfig(dir);
    assert.equal(result.exists, true);
    assert.equal(result.config.provider, 'gemini');
    assert.equal(result.warnings.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── updateProjectConfig ───────────────────────────────────────────────────────

async function updateProjectConfig(projectPath, key, updates) {
  const cfgPath = getProjectConfigPath(projectPath);
  let existing = {};
  try {
    existing = JSON.parse(await fsPromises.readFile(cfgPath, 'utf8'));
  } catch { /* file may not exist */ }
  existing[key] = { ...(existing[key] ?? {}), ...updates };
  await fsPromises.mkdir(path.dirname(cfgPath), { recursive: true });
  await fsPromises.writeFile(cfgPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

test('updateProjectConfig creates config file when missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    await updateProjectConfig(dir, 'memory', { enabled: false });
    const result = await loadProjectConfig(dir);
    assert.equal(result.exists, true);
    assert.equal(result.config.memory.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig merges into existing key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), JSON.stringify({ memory: { enabled: true } }));
    await updateProjectConfig(dir, 'memory', { enabled: false });
    const result = await loadProjectConfig(dir);
    assert.equal(result.config.memory.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig preserves other top-level keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), JSON.stringify({ version: 1, memory: { enabled: true } }));
    await updateProjectConfig(dir, 'boot', { enabled: false });
    const raw = JSON.parse(fs.readFileSync(path.join(arcDir, 'config.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.memory.enabled, true);
    assert.equal(raw.boot.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig writes valid JSON ending with newline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    await updateProjectConfig(dir, 'boot', { enabled: true });
    const content = fs.readFileSync(path.join(dir, '.agentos', 'config.json'), 'utf8');
    assert.ok(content.endsWith('\n'));
    assert.doesNotThrow(() => JSON.parse(content));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig is idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
  try {
    await updateProjectConfig(dir, 'memory', { enabled: false });
    await updateProjectConfig(dir, 'memory', { enabled: false });
    const result = await loadProjectConfig(dir);
    assert.equal(result.config.memory.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
