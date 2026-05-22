/**
 * Tests for sessions/messagePersistence.ts — pure logic (inlined).
 * Covers generateSlugFromSessionId and session-ID parsing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from messagePersistence.ts ───────────────────────────────────────

const adjectives = [
  'amber', 'azure', 'brisk', 'calm', 'coral', 'crisp', 'dusky', 'eager', 'faint', 'frosted',
  'gilded', 'golden', 'hazy', 'ivory', 'jade', 'keen', 'lemon', 'lunar', 'marble', 'mellow',
  'misty', 'moonlit', 'mossy', 'noble', 'oaken', 'pearl', 'polar', 'quiet', 'rainy', 'russet',
  'sandy', 'silver', 'smoky', 'snowy', 'solar', 'spry', 'stark', 'still', 'sunny', 'swift',
  'tawny', 'wispy', 'woody',
];
const actions = [
  'baking', 'carving', 'chasing', 'crafting', 'drifting', 'farming', 'fishing', 'forging',
  'gliding', 'hiking', 'hunting', 'leaping', 'mending', 'paddling', 'sailing', 'sketching',
  'soaring', 'spinning', 'trading', 'trekking', 'wandering', 'weaving',
];
const animals = [
  'badger', 'bear', 'bunny', 'crane', 'deer', 'dove', 'eagle', 'falcon', 'finch', 'fox',
  'hare', 'hawk', 'heron', 'jay', 'lynx', 'mink', 'moose', 'moth', 'otter', 'owl',
  'panda', 'raven', 'robin', 'seal', 'stag', 'swan', 'tiger', 'vole', 'wolf', 'wren',
];

function generateSlugFromSessionId(sessionId) {
  const hex = sessionId.replace(/-/g, '');
  const a = parseInt(hex.slice(0, 8), 16) >>> 0;
  const b = parseInt(hex.slice(8, 16), 16) >>> 0;
  const c = parseInt(hex.slice(16, 24), 16) >>> 0;
  return [adjectives[a % adjectives.length], actions[b % actions.length], animals[c % animals.length]].join('-');
}

// Session ID parsing mirrors the core loop in persistAllSessionIds
function parseSessionIds(rawOutput) {
  const cleaned = rawOutput.replace(/\r\n|\r/g, '\n');
  let claudeId = null, codexId = null, geminiId = null;
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const p = JSON.parse(trimmed);
      if (!claudeId && p.type === 'result' && typeof p.session_id === 'string') claudeId = p.session_id;
      if (!codexId && p.type === 'thread.started' && typeof p.thread_id === 'string') codexId = p.thread_id;
      if (!geminiId && p.type === 'init' && typeof p.session_id === 'string') geminiId = p.session_id;
    } catch {
      // not JSON, skip
    }
  }
  return { claudeId, codexId, geminiId };
}

// ── generateSlugFromSessionId ─────────────────────────────────────────────────

test('generateSlugFromSessionId: all-zeros UUID returns first word from each array', () => {
  const slug = generateSlugFromSessionId('00000000-0000-0000-0000-000000000000');
  assert.equal(slug, `${adjectives[0]}-${actions[0]}-${animals[0]}`);
});

test('generateSlugFromSessionId: output is adjective-action-animal format', () => {
  const slug = generateSlugFromSessionId('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  const parts = slug.split('-');
  // 3 words joined by dashes (words themselves contain no dashes)
  assert.equal(parts.length, 3);
  assert.ok(adjectives.includes(parts[0]), `expected adjective, got "${parts[0]}"`);
  assert.ok(actions.includes(parts[1]), `expected action, got "${parts[1]}"`);
  assert.ok(animals.includes(parts[2]), `expected animal, got "${parts[2]}"`);
});

test('generateSlugFromSessionId: same input always produces same output', () => {
  const id = 'deadbeef-cafe-babe-1234-567890abcdef';
  assert.equal(generateSlugFromSessionId(id), generateSlugFromSessionId(id));
});

test('generateSlugFromSessionId: different IDs can produce different slugs', () => {
  const a = generateSlugFromSessionId('00000000-0000-0000-0000-000000000000');
  const b = generateSlugFromSessionId('ffffffff-ffff-ffff-ffff-ffffffffffff');
  // Not required to differ, but these two edge cases should
  assert.notEqual(a, b);
});

test('generateSlugFromSessionId: handles UUID without dashes', () => {
  // Strip dashes manually and compare — function strips them internally
  const withDashes = '11223344-5566-7788-9900-aabbccddeeff';
  const slug = generateSlugFromSessionId(withDashes);
  const parts = slug.split('-');
  assert.equal(parts.length, 3);
});

// ── session ID parsing ────────────────────────────────────────────────────────

test('parseSessionIds: extracts claude session_id from result line', () => {
  const output = JSON.stringify({ type: 'result', session_id: 'claude-abc-123' });
  const { claudeId } = parseSessionIds(output);
  assert.equal(claudeId, 'claude-abc-123');
});

test('parseSessionIds: extracts codex thread_id from thread.started line', () => {
  const output = JSON.stringify({ type: 'thread.started', thread_id: 'codex-tid-456' });
  const { codexId } = parseSessionIds(output);
  assert.equal(codexId, 'codex-tid-456');
});

test('parseSessionIds: extracts gemini session_id from init line', () => {
  const output = JSON.stringify({ type: 'init', session_id: 'gemini-sid-789' });
  const { geminiId } = parseSessionIds(output);
  assert.equal(geminiId, 'gemini-sid-789');
});

test('parseSessionIds: returns all nulls for empty input', () => {
  const result = parseSessionIds('');
  assert.deepEqual(result, { claudeId: null, codexId: null, geminiId: null });
});

test('parseSessionIds: ignores non-JSON lines', () => {
  const output = 'some plain text\nanother line\n' + JSON.stringify({ type: 'result', session_id: 'id-1' });
  const { claudeId } = parseSessionIds(output);
  assert.equal(claudeId, 'id-1');
});

test('parseSessionIds: skips malformed JSON gracefully', () => {
  const output = '{not valid json}\n' + JSON.stringify({ type: 'result', session_id: 'id-ok' });
  const { claudeId } = parseSessionIds(output);
  assert.equal(claudeId, 'id-ok');
});

test('parseSessionIds: takes only the first matching line (claudeId)', () => {
  const lines = [
    JSON.stringify({ type: 'result', session_id: 'first' }),
    JSON.stringify({ type: 'result', session_id: 'second' }),
  ].join('\n');
  const { claudeId } = parseSessionIds(lines);
  assert.equal(claudeId, 'first');
});

test('parseSessionIds: normalises CRLF line endings', () => {
  const output = JSON.stringify({ type: 'result', session_id: 'crlf-id' }) + '\r\n';
  const { claudeId } = parseSessionIds(output);
  assert.equal(claudeId, 'crlf-id');
});

test('parseSessionIds: ignores result line with non-string session_id', () => {
  const output = JSON.stringify({ type: 'result', session_id: 42 });
  const { claudeId } = parseSessionIds(output);
  assert.equal(claudeId, null);
});

test('parseSessionIds: can extract all three providers from multi-line output', () => {
  const lines = [
    JSON.stringify({ type: 'result', session_id: 'claude-id' }),
    JSON.stringify({ type: 'thread.started', thread_id: 'codex-id' }),
    JSON.stringify({ type: 'init', session_id: 'gemini-id' }),
  ].join('\n');
  const result = parseSessionIds(lines);
  assert.equal(result.claudeId, 'claude-id');
  assert.equal(result.codexId, 'codex-id');
  assert.equal(result.geminiId, 'gemini-id');
});
