/**
 * Tests for sessions/messagePersistence.ts — generateSlugFromSessionId,
 * ensureDataDirs, and session ID extraction logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Inlined from messagePersistence.ts ───────────────────────────────────────

const SLUG_ADJECTIVES = ['amber','azure','brisk','calm','coral','crisp','dusky','eager','faint','frosted','gilded','golden','hazy','ivory','jade','keen','lemon','lunar','marble','mellow','misty','moonlit','mossy','noble','oaken','pearl','polar','quiet','rainy','russet','sandy','silver','smoky','snowy','solar','spry','stark','still','sunny','swift','tawny','wispy','woody'];
const SLUG_ACTIONS    = ['baking','carving','chasing','crafting','drifting','farming','fishing','forging','gliding','hiking','hunting','leaping','mending','paddling','sailing','sketching','soaring','spinning','trading','trekking','wandering','weaving'];
const SLUG_ANIMALS    = ['badger','bear','bunny','crane','deer','dove','eagle','falcon','finch','fox','hare','hawk','heron','jay','lynx','mink','moose','moth','otter','owl','panda','raven','robin','seal','stag','swan','tiger','vole','wolf','wren'];

function generateSlugFromSessionId(sessionId) {
  const hex = sessionId.replace(/-/g, '');
  const a = parseInt(hex.slice(0, 8), 16) >>> 0;
  const b = parseInt(hex.slice(8, 16), 16) >>> 0;
  const c = parseInt(hex.slice(16, 24), 16) >>> 0;
  return [SLUG_ADJECTIVES[a % SLUG_ADJECTIVES.length], SLUG_ACTIONS[b % SLUG_ACTIONS.length], SLUG_ANIMALS[c % SLUG_ANIMALS.length]].join('-');
}

function ensureDataDirs(homeDir) {
  const base = path.join(homeDir, '.agentos');
  const logsDir = path.join(base, 'logs');
  const messagesDir = path.join(base, 'messages');
  const sessionsDataDir = path.join(base, 'sessions');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.mkdirSync(sessionsDataDir, { recursive: true });
  return { logsDir, messagesDir, sessionsDataDir };
}

// Parse session ID from provider-specific JSON stream events.
// typeValue: the event type to match; fieldName: the field holding the session ID.
function extractSessionIdFromOutput(rawOutput, typeValue, fieldName) {
  const cleaned = rawOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed['type'] === typeValue && typeof parsed[fieldName] === 'string') {
        return parsed[fieldName];
      }
    } catch { /* not JSON */ }
  }
  return null;
}

const extractClaudeSessionId  = (raw) => extractSessionIdFromOutput(raw, 'result',         'session_id');
const extractCodexSessionId   = (raw) => extractSessionIdFromOutput(raw, 'thread.started', 'thread_id');
const extractGeminiSessionId  = (raw) => extractSessionIdFromOutput(raw, 'init',           'session_id');

// ── generateSlugFromSessionId ─────────────────────────────────────────────────

test('generateSlugFromSessionId produces three-word slug joined by dashes', () => {
  const slug = generateSlugFromSessionId('550e8400-e29b-41d4-a716-446655440000');
  const parts = slug.split('-');
  assert.equal(parts.length, 3);
});

test('generateSlugFromSessionId is deterministic', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(generateSlugFromSessionId(id), generateSlugFromSessionId(id));
});

test('generateSlugFromSessionId produces different slugs for different IDs', () => {
  const a = generateSlugFromSessionId('550e8400-e29b-41d4-a716-446655440000');
  const b = generateSlugFromSessionId('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  assert.notEqual(a, b);
});

test('generateSlugFromSessionId handles UUID without dashes', () => {
  const slug = generateSlugFromSessionId('550e8400e29b41d4a716446655440000');
  assert.ok(slug.split('-').length === 3);
});

test('generateSlugFromSessionId produces known stable output', () => {
  // Verify no regression in word list ordering
  const id = '00000000-0000-0000-0000-000000000000';
  const slug = generateSlugFromSessionId(id);
  // a=0 → adjectives[0]='amber', b=0 → actions[0]='baking', c=0 → animals[0]='badger'
  assert.equal(slug, 'amber-baking-badger');
});

test('slug words come from valid word lists', () => {
  const adjSet = new Set(SLUG_ADJECTIVES);
  const actSet = new Set(SLUG_ACTIONS);
  const aniSet = new Set(SLUG_ANIMALS);

  for (const id of [
    '550e8400-e29b-41d4-a716-446655440000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '12345678-1234-1234-1234-123456789012',
  ]) {
    const [adj, act, ani] = generateSlugFromSessionId(id).split('-');
    assert.ok(adjSet.has(adj), `adjective "${adj}" not in list`);
    assert.ok(actSet.has(act), `action "${act}" not in list`);
    assert.ok(aniSet.has(ani), `animal "${ani}" not in list`);
  }
});

// ── ensureDataDirs ────────────────────────────────────────────────────────────

test('ensureDataDirs creates logs, messages, and sessions dirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-persist-test-'));
  try {
    const { logsDir, messagesDir, sessionsDataDir } = ensureDataDirs(dir);
    assert.ok(fs.existsSync(logsDir));
    assert.ok(fs.existsSync(messagesDir));
    assert.ok(fs.existsSync(sessionsDataDir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureDataDirs returns correct paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-persist-test-'));
  try {
    const result = ensureDataDirs(dir);
    assert.ok(result.logsDir.includes('.agentos'));
    assert.ok(result.messagesDir.includes('.agentos'));
    assert.ok(result.sessionsDataDir.includes('.agentos'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureDataDirs is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-persist-test-'));
  try {
    ensureDataDirs(dir);
    assert.doesNotThrow(() => ensureDataDirs(dir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── extractClaudeSessionId ───────────────────────────────────────────────────

test('extractClaudeSessionId finds session_id in result event', () => {
  const output = '{"type":"result","session_id":"abc-123"}';
  assert.equal(extractClaudeSessionId(output), 'abc-123');
});

test('extractClaudeSessionId returns null when no result event', () => {
  const output = '{"type":"message","text":"hello"}';
  assert.equal(extractClaudeSessionId(output), null);
});

test('extractClaudeSessionId ignores non-JSON lines', () => {
  const output = 'Starting up...\n{"type":"result","session_id":"xyz-789"}';
  assert.equal(extractClaudeSessionId(output), 'xyz-789');
});

test('extractClaudeSessionId handles CRLF line endings', () => {
  const output = '{"type":"result","session_id":"win-123"}\r\nextra';
  assert.equal(extractClaudeSessionId(output), 'win-123');
});

test('extractClaudeSessionId returns null for empty output', () => {
  assert.equal(extractClaudeSessionId(''), null);
});

// ── extractCodexSessionId ────────────────────────────────────────────────────

test('extractCodexSessionId finds thread_id in thread.started event', () => {
  const output = '{"type":"thread.started","thread_id":"codex-thread-1"}';
  assert.equal(extractCodexSessionId(output), 'codex-thread-1');
});

test('extractCodexSessionId returns null for missing event', () => {
  assert.equal(extractCodexSessionId('{"type":"other"}'), null);
});

// ── extractGeminiSessionId ───────────────────────────────────────────────────

test('extractGeminiSessionId finds session_id in init event', () => {
  const output = '{"type":"init","session_id":"gemini-session-99"}';
  assert.equal(extractGeminiSessionId(output), 'gemini-session-99');
});

test('extractGeminiSessionId returns null for non-init event', () => {
  assert.equal(extractGeminiSessionId('{"type":"result","session_id":"x"}'), null);
});
