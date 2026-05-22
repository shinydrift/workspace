/**
 * Regression tests for integrations/slackBridge.ts — pure logic extracted.
 *
 * Two known bugs documented here:
 *
 * BUG 1 — commandPrefix ignored:
 *   processInboundMessage() receives `commandPrefix` but never checks it before
 *   dispatching a task. Any human message in a watched channel triggers task execution.
 *   See the maintainability review notes.
 *
 * BUG 2 — unbounded dedup Set:
 *   processedMessageKeys grows forever. processedMessageCap (4000) is defined as a field
 *   but is never used to evict entries. Long-lived sessions accumulate unbounded state.
 *   DedupCache.ts was written to fix this but slackBridge still uses a raw Set.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── BUG 1: commandPrefix is ignored ──────────────────────────────────────────
// Inline the relevant fragment of processInboundMessage to demonstrate.

/**
 * Buggy version: strips @mention, builds commandBody, and dispatches regardless of prefix.
 */
function shouldDispatch_buggy(text, commandPrefix) {
  // void commandPrefix — it is received but never used
  const commandBody = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
  if (!commandBody) return false;
  return true; // always dispatches if there's text
}

/**
 * Correct version: commandBody must start with commandPrefix (when prefix is set).
 */
function shouldDispatch_correct(text, commandPrefix) {
  const commandBody = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
  if (!commandBody) return false;
  if (commandPrefix && !commandBody.toLowerCase().startsWith(commandPrefix.toLowerCase())) {
    return false;
  }
  return true;
}

test('[bug] commandPrefix is ignored — any message dispatches', () => {
  // With commandPrefix = '!agentos', a message 'hello world' should NOT dispatch.
  // But the buggy implementation dispatches it anyway.
  assert.equal(shouldDispatch_buggy('hello world', '!agentos'), true, 'bug: dispatches without checking prefix');
});

test('[bug] commandPrefix is ignored — @mention messages always dispatch', () => {
  assert.equal(shouldDispatch_buggy('<@U123> hello world', '!agentos'), true, 'bug: dispatches after stripping mention');
});

test('[correct] shouldDispatch rejects message that lacks commandPrefix', () => {
  assert.equal(shouldDispatch_correct('hello world', '!agentos'), false);
});

test('[correct] shouldDispatch accepts message that starts with commandPrefix', () => {
  assert.equal(shouldDispatch_correct('!agentos do the thing', '!agentos'), true);
});

test('[correct] shouldDispatch is case-insensitive for prefix check', () => {
  assert.equal(shouldDispatch_correct('!AGENTOS do the thing', '!agentos'), true);
});

test('[correct] shouldDispatch dispatches any message when prefix is empty string', () => {
  assert.equal(shouldDispatch_correct('hello world', ''), true);
});

test('[correct] shouldDispatch strips @mention before checking prefix', () => {
  assert.equal(shouldDispatch_correct('<@U123> !agentos do the thing', '!agentos'), true);
});

// ── BUG 2: unbounded dedup Set ────────────────────────────────────────────────

/**
 * Buggy dedup: raw Set, processedMessageCap defined but unused.
 */
class ProcessedKeys_buggy {
  #set = new Set();
  #cap = 4000; // defined but never used

  has(key) { return this.#set.has(key); }
  add(key) { this.#set.add(key); } // no eviction
  get size() { return this.#set.size; }
}

/**
 * Correct dedup: evicts oldest when cap is exceeded (same as DedupCache).
 */
class ProcessedKeys_correct {
  #set = new Set();
  #cap;

  constructor(cap = 4000) { this.#cap = cap; }

  has(key) { return this.#set.has(key); }
  add(key) {
    this.#set.add(key);
    if (this.#set.size > this.#cap) {
      const first = this.#set.values().next().value;
      if (first !== undefined) this.#set.delete(first);
    }
  }
  get size() { return this.#set.size; }
}

test('[bug] processedMessageKeys grows beyond cap', () => {
  const cache = new ProcessedKeys_buggy();
  for (let i = 0; i < 4001; i++) cache.add(String(i));
  // BUG: size exceeds cap because there's no eviction
  assert.equal(cache.size, 4001, 'bug: size is not capped');
});

test('[correct] bounded dedup never exceeds cap', () => {
  const cache = new ProcessedKeys_correct(4000);
  for (let i = 0; i < 5000; i++) cache.add(String(i));
  assert.ok(cache.size <= 4000, `size ${cache.size} exceeded cap`);
});

test('[correct] bounded dedup evicts oldest on overflow', () => {
  const cache = new ProcessedKeys_correct(3);
  cache.add('a');
  cache.add('b');
  cache.add('c');
  cache.add('d'); // should evict 'a'
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('d'), true);
});

// ── messageKey dedup logic (shared, not buggy) ────────────────────────────────

test('dedup key is channelId:ts', () => {
  const channelId = 'C123';
  const ts = '1234567890.000100';
  const key = `${channelId}:${ts}`;
  assert.equal(key, 'C123:1234567890.000100');
});

test('duplicate message with same channelId:ts is deduplicated', () => {
  const cache = new ProcessedKeys_correct();
  const key = 'C123:1234567890.000100';
  cache.add(key);
  assert.ok(cache.has(key), 'first occurrence recognised');
  // simulates the dedup check before processing
  const wouldProcess = !cache.has(key);
  assert.equal(wouldProcess, false, 'duplicate is rejected');
});

// ── updateChannelCursor micro-arithmetic (pure, inlined) ─────────────────────

function computeNextCursor(ts) {
  const [secs, frac = ''] = ts.split('.');
  const micro = BigInt(secs) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6)) + 1n;
  return `${(micro / 1_000_000n).toString()}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
}

test('computeNextCursor increments by one microsecond', () => {
  assert.equal(computeNextCursor('1000000000.000000'), '1000000000.000001');
});

test('computeNextCursor carries over second boundary', () => {
  assert.equal(computeNextCursor('1000000000.999999'), '1000000001.000000');
});

test('computeNextCursor handles missing fractional part', () => {
  // ts with no fractional part treated as .000000
  assert.equal(computeNextCursor('1000000000'), '1000000000.000001');
});

test('computeNextCursor produces 6-digit fractional part', () => {
  const result = computeNextCursor('1234567890.000001');
  const frac = result.split('.')[1];
  assert.equal(frac.length, 6);
});
