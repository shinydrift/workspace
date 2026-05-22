/**
 * Tests for shared/threadTitle.ts — deriveThreadTitleFromMessage
 * Functions are inlined (no TS loader available in node:test runner).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from threadTitle.ts ───────────────────────────────────────────────

function capitalizeFirstLetter(value) {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}

function deriveThreadTitleFromMessage(text, options = {}) {
  const maxLength = options.maxLength && options.maxLength > 0 ? options.maxLength : 100;
  let normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  if (options.isSlack) {
    normalized = normalized.replace(/^@ark\b[,:-]?\s*/i, '').trim();
    if (!normalized) return null;
  }

  const titled = capitalizeFirstLetter(normalized);
  return titled.length <= maxLength ? titled : `${titled.slice(0, maxLength - 1)}\u2026`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('returns null for empty string', () => {
  assert.equal(deriveThreadTitleFromMessage(''), null);
});

test('returns null for null', () => {
  assert.equal(deriveThreadTitleFromMessage(null), null);
});

test('returns null for undefined', () => {
  assert.equal(deriveThreadTitleFromMessage(undefined), null);
});

test('returns null for whitespace-only string', () => {
  assert.equal(deriveThreadTitleFromMessage('   '), null);
});

test('capitalizes first letter', () => {
  assert.equal(deriveThreadTitleFromMessage('hello world'), 'Hello world');
});

test('collapses internal whitespace', () => {
  assert.equal(deriveThreadTitleFromMessage('hello   world'), 'Hello world');
});

test('truncates at maxLength with ellipsis', () => {
  const result = deriveThreadTitleFromMessage('abcde', { maxLength: 4 });
  // capitalizeFirstLetter runs first: 'abcde' -> 'Abcde', then truncated to 'Abc…'
  assert.equal(result, 'Abc\u2026');
});

test('does not truncate when exactly at maxLength', () => {
  const result = deriveThreadTitleFromMessage('abcd', { maxLength: 4 });
  assert.equal(result, 'Abcd');
});

test('default maxLength is 100', () => {
  const long = 'a'.repeat(101);
  const result = deriveThreadTitleFromMessage(long);
  assert.equal(result?.length, 100);
  assert.ok(result?.endsWith('\u2026'));
});

test('isSlack strips @ark prefix', () => {
  assert.equal(deriveThreadTitleFromMessage('@ark help me', { isSlack: true }), 'Help me');
});

test('isSlack strips @ark with comma', () => {
  assert.equal(deriveThreadTitleFromMessage('@Ark, do this', { isSlack: true }), 'Do this');
});

test('isSlack strips @ark with colon', () => {
  assert.equal(deriveThreadTitleFromMessage('@ARK: do this', { isSlack: true }), 'Do this');
});

test('isSlack returns null if only @ark mention', () => {
  assert.equal(deriveThreadTitleFromMessage('@ark', { isSlack: true }), null);
});

test('isSlack leaves non-@ark text unchanged', () => {
  assert.equal(deriveThreadTitleFromMessage('just a message', { isSlack: true }), 'Just a message');
});

test('ignores maxLength of 0 (uses default 100)', () => {
  const result = deriveThreadTitleFromMessage('hello', { maxLength: 0 });
  assert.equal(result, 'Hello');
});
