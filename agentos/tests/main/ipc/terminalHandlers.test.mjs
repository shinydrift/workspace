/**
 * Tests for ipc/handlers/terminalHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from terminalHandlers.ts ──────────────────────────────

function isValidThreadId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128;
}

function validateSendInput(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidThreadId(req.threadId)) return false;
  if (typeof req.input !== 'string' || req.input.length > 100_000) return false;
  return true;
}

function validateResizeTerminal(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidThreadId(req.threadId)) return false;
  if (!Number.isInteger(req.cols) || req.cols < 1 || req.cols > 1000) return false;
  if (!Number.isInteger(req.rows) || req.rows < 1 || req.rows > 500) return false;
  return true;
}

// ── SendInputSchema ───────────────────────────────────────────────────────────

test('SendInput: valid request', () => {
  assert.ok(validateSendInput({ threadId: 'abc', input: 'ls -la' }));
});

test('SendInput: valid with empty input string', () => {
  assert.ok(validateSendInput({ threadId: 'abc', input: '' }));
});

test('SendInput: rejects empty threadId', () => {
  assert.ok(!validateSendInput({ threadId: '', input: 'ls' }));
});

test('SendInput: rejects threadId over 128 chars', () => {
  assert.ok(!validateSendInput({ threadId: 'a'.repeat(129), input: 'ls' }));
});

test('SendInput: accepts threadId exactly 128 chars', () => {
  assert.ok(validateSendInput({ threadId: 'a'.repeat(128), input: 'ls' }));
});

test('SendInput: rejects input over 100000 chars', () => {
  assert.ok(!validateSendInput({ threadId: 'abc', input: 'x'.repeat(100_001) }));
});

test('SendInput: accepts input exactly 100000 chars', () => {
  assert.ok(validateSendInput({ threadId: 'abc', input: 'x'.repeat(100_000) }));
});

test('SendInput: rejects missing input', () => {
  assert.ok(!validateSendInput({ threadId: 'abc' }));
});

test('SendInput: rejects non-string input', () => {
  assert.ok(!validateSendInput({ threadId: 'abc', input: 42 }));
});

// ── ResizeTerminalSchema ──────────────────────────────────────────────────────

test('ResizeTerminal: valid typical dimensions', () => {
  assert.ok(validateResizeTerminal({ threadId: 'abc', cols: 80, rows: 24 }));
});

test('ResizeTerminal: valid minimum dimensions', () => {
  assert.ok(validateResizeTerminal({ threadId: 'abc', cols: 1, rows: 1 }));
});

test('ResizeTerminal: valid maximum dimensions', () => {
  assert.ok(validateResizeTerminal({ threadId: 'abc', cols: 1000, rows: 500 }));
});

test('ResizeTerminal: rejects cols 0', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 0, rows: 24 }));
});

test('ResizeTerminal: rejects cols over 1000', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 1001, rows: 24 }));
});

test('ResizeTerminal: rejects rows 0', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 80, rows: 0 }));
});

test('ResizeTerminal: rejects rows over 500', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 80, rows: 501 }));
});

test('ResizeTerminal: rejects non-integer cols', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 80.5, rows: 24 }));
});

test('ResizeTerminal: rejects non-integer rows', () => {
  assert.ok(!validateResizeTerminal({ threadId: 'abc', cols: 80, rows: 24.5 }));
});

test('ResizeTerminal: rejects empty threadId', () => {
  assert.ok(!validateResizeTerminal({ threadId: '', cols: 80, rows: 24 }));
});
