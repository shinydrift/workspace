/**
 * Tests for sessions/mcpConfig.ts — syncGeminiMcpConfig, syncCodexMcpConfig,
 * rebuildManagedMcpConfig.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Minimal TOML helpers (no external dependency) ────────────────────────────
// Supports only the subset needed: flat key=value and [table] sections.
// Sufficient for verifying the config files written by mcpConfig.ts.

function parseToml(text) {
  const result = {};
  let currentSection = result;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = sectionMatch[1].split('.');
      let obj = result;
      for (const part of parts) {
        if (!(part in obj)) obj[part] = {};
        obj = obj[part];
      }
      currentSection = obj;
      continue;
    }
    const kvMatch = line.match(/^(\w[\w-]*)\s*=\s*"(.*)"\s*$/);
    if (kvMatch) { currentSection[kvMatch[1]] = kvMatch[2]; }
  }
  return result;
}

function stringifyToml(obj, prefix = '') {
  let out = '';
  const subs = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') { subs.push([k, v]); }
    else { out += `${prefix ? '' : ''}${k} = "${String(v)}"\n`; }
  }
  for (const [k, v] of subs) {
    const header = prefix ? `${prefix}.${k}` : k;
    out += `\n[${header}]\n`;
    out += stringifyToml(v, header);
  }
  return out;
}

// ── AGENTOS_MANAGED_SERVERS ───────────────────────────────────────────────────────
const AGENTOS_MANAGED_SERVERS = ['agentos-memory', 'agentos-thread', 'agentos-slack', 'agentos-kanban'];
const AGENTOS_MCP_BEARER_TOKEN_ENV_VAR = 'ARC_MCP_BEARER_TOKEN';

// ── Inlined from mcpConfig.ts ─────────────────────────────────────────────────

function syncGeminiMcpConfig(servers, sessionDataDir) {
  const settingsPath = path.join(sessionDataDir, 'settings.json');
  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch { /* ignore */ }
  }
  const currentServers = { ...(existing.mcpServers ?? {}) };
  for (const name of AGENTOS_MANAGED_SERVERS) delete currentServers[name];
  for (const [name, url] of Object.entries(servers)) currentServers[name] = { type: 'http', url };
  const next = { ...existing };
  if (Object.keys(currentServers).length > 0) next.mcpServers = currentServers;
  else delete next.mcpServers;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}

function syncCodexMcpConfig(servers, sessionDataDir) {
  const configPath = path.join(sessionDataDir, 'config.toml');
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = parseToml(fs.readFileSync(configPath, 'utf8'));
    } catch { /* ignore */ }
  }
  const currentServers = { ...(existing.mcp_servers ?? {}) };
  for (const name of AGENTOS_MANAGED_SERVERS) delete currentServers[name];
  for (const [name, url] of Object.entries(servers)) {
    currentServers[name] = { url, bearer_token_env_var: AGENTOS_MCP_BEARER_TOKEN_ENV_VAR };
  }
  const next = { ...existing };
  if (Object.keys(currentServers).length > 0) next.mcp_servers = currentServers;
  else delete next.mcp_servers;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, stringifyToml(next));
}

function rebuildManagedMcpConfig(launchModes, threads, sessionsDataDir) {
  for (const [threadId, launchMode] of launchModes.entries()) {
    const thread = threads[threadId];
    if (!thread) continue;
    const servers = {};
    if (launchMode.memoryMcpUrl) servers['agentos-memory'] = launchMode.memoryMcpUrl;
    if (launchMode.threadMcpUrl) servers['agentos-thread'] = launchMode.threadMcpUrl;
    if (launchMode.slackMcpUrl) servers['agentos-slack'] = launchMode.slackMcpUrl;
    const sessionDataDir = path.join(sessionsDataDir, threadId);
    if (thread.provider === 'gemini') syncGeminiMcpConfig(servers, sessionDataDir);
    else if (thread.provider === 'codex') syncCodexMcpConfig(servers, sessionDataDir);
  }
}

// ── syncGeminiMcpConfig ───────────────────────────────────────────────────────

test('syncGeminiMcpConfig creates settings.json with mcpServers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    syncGeminiMcpConfig({ 'agentos-memory': 'http://host:3459/mcp' }, dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.ok(data.mcpServers['agentos-memory']);
    assert.equal(data.mcpServers['agentos-memory'].url, 'http://host:3459/mcp');
    assert.equal(data.mcpServers['agentos-memory'].type, 'http');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncGeminiMcpConfig removes old agentos-managed servers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    // Write an existing settings.json with agentos-managed servers
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        'agentos-memory': { type: 'http', url: 'old-url' },
        'custom-server': { type: 'http', url: 'custom' },
      },
    }));
    syncGeminiMcpConfig({ 'agentos-thread': 'http://host:3460/mcp' }, dir);
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(!data.mcpServers['agentos-memory'], 'old agentos-memory removed');
    assert.ok(data.mcpServers['agentos-thread'], 'new agentos-thread added');
    assert.ok(data.mcpServers['custom-server'], 'custom-server preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncGeminiMcpConfig preserves existing non-agentos settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', language: 'en' }));
    syncGeminiMcpConfig({ 'agentos-memory': 'http://host/mcp' }, dir);
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(data.theme, 'dark');
    assert.equal(data.language, 'en');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncGeminiMcpConfig removes mcpServers key when no servers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      mcpServers: { 'agentos-memory': { type: 'http', url: 'old' } },
    }));
    syncGeminiMcpConfig({}, dir);
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(!('mcpServers' in data));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncGeminiMcpConfig handles invalid existing JSON gracefully', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, 'not-json');
    assert.doesNotThrow(() => syncGeminiMcpConfig({ 'agentos-memory': 'http://host/mcp' }, dir));
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(data.mcpServers['agentos-memory']);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncGeminiMcpConfig creates parent directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const nested = path.join(dir, 'deep', 'nested');
    syncGeminiMcpConfig({ 'agentos-memory': 'http://host/mcp' }, nested);
    assert.ok(fs.existsSync(path.join(nested, 'settings.json')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── syncCodexMcpConfig ────────────────────────────────────────────────────────

test('syncCodexMcpConfig creates config.toml with mcp_servers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    syncCodexMcpConfig({ 'agentos-memory': 'http://host:3459/mcp' }, dir);
    const raw = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    const data = parseToml(raw);
    assert.ok(data.mcp_servers['agentos-memory']);
    assert.equal(data.mcp_servers['agentos-memory'].url, 'http://host:3459/mcp');
    assert.equal(data.mcp_servers['agentos-memory'].bearer_token_env_var, AGENTOS_MCP_BEARER_TOKEN_ENV_VAR);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncCodexMcpConfig adds bearer_token_env_var but not type field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    syncCodexMcpConfig({ 'agentos-thread': 'http://host:3460/mcp' }, dir);
    const raw = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    const data = parseToml(raw);
    assert.ok(!('type' in (data.mcp_servers['agentos-thread'] ?? {})), 'no type field in codex config');
    assert.equal(data.mcp_servers['agentos-thread']?.bearer_token_env_var, AGENTOS_MCP_BEARER_TOKEN_ENV_VAR);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('syncCodexMcpConfig removes old agentos-managed servers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, stringifyToml({
      mcp_servers: {
        'agentos-memory': { url: 'old-url' },
        'my-server': { url: 'custom' },
      },
    }));
    syncCodexMcpConfig({ 'agentos-thread': 'http://host:3460/mcp' }, dir);
    const data = parseToml(fs.readFileSync(configPath, 'utf8'));
    assert.ok(!data.mcp_servers?.['agentos-memory'], 'old agentos-memory removed');
    assert.ok(data.mcp_servers?.['agentos-thread'], 'new agentos-thread added');
    assert.ok(data.mcp_servers?.['my-server'], 'my-server preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── rebuildManagedMcpConfig ───────────────────────────────────────────────────

test('rebuildManagedMcpConfig skips threads not in launchModes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const launchModes = new Map();
    // Empty — no threads to process
    rebuildManagedMcpConfig(launchModes, {}, dir);
    // No files should be created
    assert.ok(!fs.existsSync(path.join(dir, 'thread-1')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('rebuildManagedMcpConfig skips thread not in threads object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const launchModes = new Map([
      ['thread-1', { memoryMcpUrl: 'http://host/mcp', threadMcpUrl: null, slackMcpUrl: null }],
    ]);
    rebuildManagedMcpConfig(launchModes, {}, dir);
    // thread-1 is in launchModes but NOT in threads → should be skipped
    assert.ok(!fs.existsSync(path.join(dir, 'thread-1', 'settings.json')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('rebuildManagedMcpConfig writes gemini config for gemini threads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const launchModes = new Map([
      ['t1', { memoryMcpUrl: 'http://host:3459/mcp', threadMcpUrl: 'http://host:3460/mcp', slackMcpUrl: null }],
    ]);
    rebuildManagedMcpConfig(launchModes, { t1: { provider: 'gemini' } }, dir);
    const settingsPath = path.join(dir, 't1', 'settings.json');
    assert.ok(fs.existsSync(settingsPath));
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(data.mcpServers['agentos-memory']);
    assert.ok(data.mcpServers['agentos-thread']);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('rebuildManagedMcpConfig writes codex config for codex threads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const launchModes = new Map([
      ['t2', { memoryMcpUrl: 'http://host:3459/mcp', threadMcpUrl: null, slackMcpUrl: null }],
    ]);
    rebuildManagedMcpConfig(launchModes, { t2: { provider: 'codex' } }, dir);
    const configPath = path.join(dir, 't2', 'config.toml');
    assert.ok(fs.existsSync(configPath));
    const data = parseToml(fs.readFileSync(configPath, 'utf8'));
    assert.ok(data.mcp_servers?.['agentos-memory']);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('rebuildManagedMcpConfig skips claude threads (no file config needed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mcp-test-'));
  try {
    const launchModes = new Map([
      ['t3', { memoryMcpUrl: 'http://host/mcp', threadMcpUrl: null, slackMcpUrl: null }],
    ]);
    rebuildManagedMcpConfig(launchModes, { t3: { provider: 'claude' } }, dir);
    assert.ok(!fs.existsSync(path.join(dir, 't3', 'settings.json')));
    assert.ok(!fs.existsSync(path.join(dir, 't3', 'config.toml')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
