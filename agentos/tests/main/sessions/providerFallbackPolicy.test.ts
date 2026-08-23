/**
 * Real-import tests for sessions/providerFallbackPolicy.ts — when a usage limit may switch a
 * thread to the next provider in the priority list.
 *
 * Regression: `fallbackProviderAndRetry` used to switch on any turn. No provider can resume
 * another's session, so mid-conversation switches silently dropped every turn taken so far and
 * left the thread permanently on the new provider — 12 threads on the author's machine were
 * stranded that way, each one having fallen back on turn 2, 3 or 4.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { canFallbackProvider } from '../../../src/main/sessions/providerFallbackPolicy';
import type { Provider, Thread } from '../../../src/shared/types';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    name: 'Untitled',
    projectId: 'p1',
    workingDirectory: '/tmp/repo',
    status: 'running',
    createdAt: 0,
    lastActiveAt: 0,
    logBuffer: [],
    promptHistory: ['first prompt'],
    ...overrides,
  };
}

// ── the first turn is the only turn worth switching on ───────────────────────

test('first turn with no session yet may fall back', () => {
  assert.equal(canFallbackProvider(makeThread(), 'claude'), true);
});

test('an empty prompt history may fall back', () => {
  assert.equal(canFallbackProvider(makeThread({ promptHistory: [] }), 'claude'), true);
});

test('second turn keeps its provider', () => {
  const thread = makeThread({ promptHistory: ['first prompt', 'second prompt'] });
  assert.equal(canFallbackProvider(thread, 'claude'), false);
});

test('a long conversation keeps its provider', () => {
  const thread = makeThread({ promptHistory: Array.from({ length: 40 }, (_, i) => `prompt ${i}`) });
  assert.equal(canFallbackProvider(thread, 'claude'), false);
});

// ── a recorded session is a transcript a switch would strand ─────────────────

// Regression: persistUserInput ignores sources outside user/automation/autopilot, so a
// `/save-session-chunk` turn (source 'skills') runs without growing promptHistory. A limit hit
// there read as "first turn" and stranded the claude session of a thread with one real prompt.
test('first turn but a claude session already recorded keeps its provider', () => {
  const thread = makeThread({ claudeSessionId: 'sess-abc' });
  assert.equal(canFallbackProvider(thread, 'claude'), false);
});

test('claude-interactive reads the same session field as claude', () => {
  const thread = makeThread({ claudeSessionId: 'sess-abc' });
  assert.equal(canFallbackProvider(thread, 'claude-interactive'), false);
});

test('an empty session id is not a session', () => {
  assert.equal(canFallbackProvider(makeThread({ claudeSessionId: '' }), 'claude'), true);
});

test('another provider’s session does not gate this provider', () => {
  const thread = makeThread({ codexSessionId: 'codex-thread-1' });
  assert.equal(canFallbackProvider(thread, 'claude'), true);
});

const SESSION_FIELDS: Array<[Provider, keyof Thread]> = [
  ['claude', 'claudeSessionId'],
  ['claude-interactive', 'claudeSessionId'],
  ['codex', 'codexSessionId'],
  ['gemini', 'geminiSessionId'],
  ['pi', 'piSessionId'],
  ['opencode', 'opencodeSessionId'],
];

for (const [provider, field] of SESSION_FIELDS) {
  test(`${provider}: a recorded ${String(field)} blocks the switch`, () => {
    const thread = makeThread({ [field]: 'sess-1' } as Partial<Thread>);
    assert.equal(canFallbackProvider(thread, provider), false);
  });

  test(`${provider}: first turn with no ${String(field)} may fall back`, () => {
    assert.equal(canFallbackProvider(makeThread(), provider), true);
  });
}

// ── chaining ─────────────────────────────────────────────────────────────────

// The retry replays the turn with `persistInput: false`, so promptHistory stays at 1 — and the
// abandoned provider hit its limit, so it recorded no session. claude→codex→gemini still works.
test('a chained fallback on the first turn is still allowed', () => {
  const thread = makeThread({ provider: 'codex', promptHistory: ['first prompt'] });
  assert.equal(canFallbackProvider(thread, 'codex'), true);
});
