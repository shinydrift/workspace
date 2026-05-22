/**
 * Tests for sessions/mcpConfig.ts — Gemini settings.json sync and rebuildManagedMcpConfig routing.
 * Codex (TOML) path is not covered here because smol-toml is not available in the test runner.
 * Functions are inlined; getMcpAuthHeaders is stubbed as a fixed value.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Stubs / constants ─────────────────────────────────────────────────────────

const TEST_AUTH_HEADERS = { Authorization: 'Bearer test-token' };
const AGENTOS_MCP_BEARER_TOKEN_ENV_VAR = 'ARC_MCP_BEARER_TOKEN';
const AGENTOS_MANAGED_SERVERS = ['agentos-memory', 'agentos-thread', 'agentos-slack', 'agentos-kanban'];

// ── Inlined from mcpConfig.ts (Gemini path only) ─────────────────────────────

function syncGeminiMcpConfig(servers, sessionDataDir) {
  const settingsPath = path.join(sessionDataDir, 'settings.json');
  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // ignore parse errors
    }
  }
  const currentServers = { ...(existing.mcpServers ?? {}) };
  for (const name of AGENTOS_MANAGED_SERVERS) {
    delete currentServers[name];
  }
  for (const [name, url] of Object.entries(servers)) {
    currentServers[name] = { type: 'http', url, headers: TEST_AUTH_HEADERS };
  }
  const next = { ...existing };
  if (Object.keys(currentServers).length > 0) {
    next.mcpServers = currentServers;
  } else {
    delete next.mcpServers;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}

function rebuildManagedMcpConfig(launchModes, threads, sessionsDataDir) {
  for (const [threadId, launchMode] of launchModes.entries()) {
    const thread = threads[threadId];
    if (!thread) continue;

    const servers = {};
    if (launchMode.memoryMcpUrl) servers['agentos-memory'] = launchMode.memoryMcpUrl;
    if (launchMode.threadMcpUrl) servers['agentos-thread'] = launchMode.threadMcpUrl;
    if (launchMode.slackMcpUrl) servers['agentos-slack'] = launchMode.slackMcpUrl;
    if (launchMode.kanbanMcpUrl) servers['agentos-kanban'] = launchMode.kanbanMcpUrl;

    const sessionDataDir = path.join(sessionsDataDir, threadId);
    if (thread.provider === 'gemini') syncGeminiMcpConfig(servers, sessionDataDir);
    // codex path not tested (requires smol-toml)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpconfig-test-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true }); }
}

function readSettings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
}

// ── syncGeminiMcpConfig ───────────────────────────────────────────────────────

test('syncGeminiMcpConfig: creates settings.json with mcpServers', () => withTmpDir((dir) => {
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, dir);
  const result = readSettings(dir);
  assert.equal(result.mcpServers['agentos-memory'].type, 'http');
  assert.equal(result.mcpServers['agentos-memory'].url, 'http://localhost:1234');
  assert.deepEqual(result.mcpServers['agentos-memory'].headers, TEST_AUTH_HEADERS);
}));

test('syncGeminiMcpConfig: no servers removes mcpServers key', () => withTmpDir((dir) => {
  syncGeminiMcpConfig({}, dir);
  const result = readSettings(dir);
  assert.equal('mcpServers' in result, false);
}));

test('syncGeminiMcpConfig: preserves non-agentos keys in existing settings', () => withTmpDir((dir) => {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', mcpServers: {} }));
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, dir);
  const result = readSettings(dir);
  assert.equal(result.theme, 'dark');
  assert.ok('agentos-memory' in result.mcpServers);
}));

test('syncGeminiMcpConfig: removes previously written agentos servers when called with no servers', () => withTmpDir((dir) => {
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, dir);
  syncGeminiMcpConfig({}, dir);
  const result = readSettings(dir);
  assert.equal('mcpServers' in result, false);
}));

test('syncGeminiMcpConfig: replaces agentos servers on re-sync with new urls', () => withTmpDir((dir) => {
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, dir);
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:9999' }, dir);
  const result = readSettings(dir);
  assert.equal(result.mcpServers['agentos-memory'].url, 'http://localhost:9999');
}));

test('syncGeminiMcpConfig: preserves non-agentos third-party mcp servers', () => withTmpDir((dir) => {
  const existing = { mcpServers: { 'my-custom-server': { type: 'http', url: 'http://custom' } } };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(existing));
  syncGeminiMcpConfig({ 'agentos-thread': 'http://localhost:5678' }, dir);
  const result = readSettings(dir);
  assert.ok('my-custom-server' in result.mcpServers);
  assert.ok('agentos-thread' in result.mcpServers);
}));

test('syncGeminiMcpConfig: handles malformed existing settings.json gracefully', () => withTmpDir((dir) => {
  fs.writeFileSync(path.join(dir, 'settings.json'), 'not-json{{{');
  assert.doesNotThrow(() => syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, dir));
  const result = readSettings(dir);
  assert.ok('agentos-memory' in result.mcpServers);
}));

test('syncGeminiMcpConfig: creates nested sessionDataDir if missing', () => withTmpDir((tmp) => {
  const nested = path.join(tmp, 'deep', 'nested');
  syncGeminiMcpConfig({ 'agentos-memory': 'http://localhost:1234' }, nested);
  assert.ok(fs.existsSync(path.join(nested, 'settings.json')));
}));

// ── rebuildManagedMcpConfig ───────────────────────────────────────────────────

test('rebuildManagedMcpConfig: writes gemini config for gemini thread', () => withTmpDir((tmp) => {
  const threadId = 'thread-abc';
  const launchModes = new Map([[threadId, { memoryMcpUrl: 'http://mem:1', threadMcpUrl: 'http://thr:2', slackMcpUrl: null, kanbanMcpUrl: null }]]);
  const threads = { [threadId]: { provider: 'gemini' } };
  rebuildManagedMcpConfig(launchModes, threads, tmp);
  const result = readSettings(path.join(tmp, threadId));
  assert.ok('agentos-memory' in result.mcpServers);
  assert.ok('agentos-thread' in result.mcpServers);
}));

test('rebuildManagedMcpConfig: skips claude threads (no file written)', () => withTmpDir((tmp) => {
  const threadId = 'thread-xyz';
  const launchModes = new Map([[threadId, { memoryMcpUrl: 'http://mem:1', threadMcpUrl: null, slackMcpUrl: null, kanbanMcpUrl: null }]]);
  const threads = { [threadId]: { provider: 'claude' } };
  rebuildManagedMcpConfig(launchModes, threads, tmp);
  assert.equal(fs.existsSync(path.join(tmp, threadId, 'settings.json')), false);
}));

test('rebuildManagedMcpConfig: skips thread not in threads map', () => withTmpDir((tmp) => {
  const threadId = 'ghost-thread';
  const launchModes = new Map([[threadId, { memoryMcpUrl: 'http://mem:1', threadMcpUrl: null, slackMcpUrl: null, kanbanMcpUrl: null }]]);
  assert.doesNotThrow(() => rebuildManagedMcpConfig(launchModes, {}, tmp));
  assert.equal(fs.existsSync(path.join(tmp, threadId, 'settings.json')), false);
}));

test('rebuildManagedMcpConfig: only non-null urls appear as servers', () => withTmpDir((tmp) => {
  const threadId = 'thread-partial';
  const launchModes = new Map([[threadId, { memoryMcpUrl: 'http://mem:1', threadMcpUrl: null, slackMcpUrl: null, kanbanMcpUrl: null }]]);
  const threads = { [threadId]: { provider: 'gemini' } };
  rebuildManagedMcpConfig(launchModes, threads, tmp);
  const result = readSettings(path.join(tmp, threadId));
  assert.ok('agentos-memory' in result.mcpServers);
  assert.equal('agentos-thread' in result.mcpServers, false);
}));
