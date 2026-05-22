/**
 * Tests for utils/readySignalDetector.ts — isCliReady.
 * Function and patterns inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from readySignalDetector.ts ──────────────────────────────────────

const READY_PATTERNS = {
  claude: /(?:^|\r?\n)(?:>|claude>)\s*$/m,
  codex: /(?:^|\r?\n)(?:>|codex>|\$)\s*$/m,
  gemini: /(?:^|\r?\n)(?:>|gemini>)\s*$/m,
};

function isCliReady(provider, output) {
  return READY_PATTERNS[provider].test(output);
}

// ── claude ────────────────────────────────────────────────────────────────────

test('claude: bare > prompt matches', () => {
  assert.ok(isCliReady('claude', 'some output\n> '));
});

test('claude: claude> prompt matches', () => {
  assert.ok(isCliReady('claude', 'output\nclaude> '));
});

test('claude: > at start of string matches', () => {
  assert.ok(isCliReady('claude', '> '));
});

test('claude: non-prompt output does not match', () => {
  assert.ok(!isCliReady('claude', 'just some text'));
});

test('claude: > in middle of line does not match', () => {
  assert.ok(!isCliReady('claude', 'a > b'));
});

// ── codex ─────────────────────────────────────────────────────────────────────

test('codex: bare > matches', () => {
  assert.ok(isCliReady('codex', '\n> '));
});

test('codex: codex> matches', () => {
  assert.ok(isCliReady('codex', 'output\ncodex> '));
});

test('codex: $ matches', () => {
  assert.ok(isCliReady('codex', 'output\n$ '));
});

test('codex: non-prompt output does not match', () => {
  assert.ok(!isCliReady('codex', 'just text'));
});

// ── gemini ────────────────────────────────────────────────────────────────────

test('gemini: bare > matches', () => {
  assert.ok(isCliReady('gemini', '\n> '));
});

test('gemini: gemini> matches', () => {
  assert.ok(isCliReady('gemini', 'output\ngemini> '));
});

test('gemini: non-prompt output does not match', () => {
  assert.ok(!isCliReady('gemini', 'just text'));
});

test('gemini: $ does not match (codex-only)', () => {
  assert.ok(!isCliReady('gemini', 'output\n$ '));
});
