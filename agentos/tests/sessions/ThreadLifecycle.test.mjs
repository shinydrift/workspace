/**
 * Tests for sessions/ThreadLifecycle.ts — isValidStoredThread (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ThreadLifecycle.ts ──────────────────────────────────────────

function isValidStoredThread(value) {
  if (!value || typeof value !== 'object') return false;
  const thread = value;
  const validStatus =
    thread.status === 'running' ||
    thread.status === 'idle' ||
    thread.status === 'error' ||
    thread.status === 'stopped' ||
    thread.status === 'building';
  const validProvider =
    thread.provider === undefined ||
    thread.provider === 'claude' ||
    thread.provider === 'codex' ||
    thread.provider === 'gemini';
  return (
    typeof thread.id === 'string' &&
    thread.id.length > 0 &&
    typeof thread.name === 'string' &&
    thread.name.length > 0 &&
    typeof thread.projectId === 'string' &&
    thread.projectId.length > 0 &&
    typeof thread.workingDirectory === 'string' &&
    thread.workingDirectory.length > 0 &&
    typeof thread.createdAt === 'number' &&
    Number.isFinite(thread.createdAt) &&
    typeof thread.lastActiveAt === 'number' &&
    Number.isFinite(thread.lastActiveAt) &&
    Array.isArray(thread.promptHistory) &&
    validStatus &&
    validProvider
  );
}

// ── Valid baseline ────────────────────────────────────────────────────────────

function validThread(overrides = {}) {
  return {
    id: 'thread-1',
    name: 'My Thread',
    projectId: 'proj-1',
    workingDirectory: '/home/user/project',
    createdAt: 1000000,
    lastActiveAt: 1000001,
    promptHistory: [],
    status: 'stopped',
    provider: 'claude',
    ...overrides,
  };
}

test('isValidStoredThread: valid thread passes', () => {
  assert.equal(isValidStoredThread(validThread()), true);
});

test('isValidStoredThread: null returns false', () => {
  assert.equal(isValidStoredThread(null), false);
});

test('isValidStoredThread: undefined returns false', () => {
  assert.equal(isValidStoredThread(undefined), false);
});

test('isValidStoredThread: non-object returns false', () => {
  assert.equal(isValidStoredThread('string'), false);
  assert.equal(isValidStoredThread(42), false);
  assert.equal(isValidStoredThread(true), false);
});

// ── id field ─────────────────────────────────────────────────────────────────

test('isValidStoredThread: missing id returns false', () => {
  const { id: _, ...rest } = validThread();
  assert.equal(isValidStoredThread(rest), false);
});

test('isValidStoredThread: empty id returns false', () => {
  assert.equal(isValidStoredThread(validThread({ id: '' })), false);
});

test('isValidStoredThread: numeric id returns false', () => {
  assert.equal(isValidStoredThread(validThread({ id: 123 })), false);
});

// ── name field ────────────────────────────────────────────────────────────────

test('isValidStoredThread: missing name returns false', () => {
  const { name: _, ...rest } = validThread();
  assert.equal(isValidStoredThread(rest), false);
});

test('isValidStoredThread: empty name returns false', () => {
  assert.equal(isValidStoredThread(validThread({ name: '' })), false);
});

// ── projectId field ───────────────────────────────────────────────────────────

test('isValidStoredThread: missing projectId returns false', () => {
  const { projectId: _, ...rest } = validThread();
  assert.equal(isValidStoredThread(rest), false);
});

test('isValidStoredThread: empty projectId returns false', () => {
  assert.equal(isValidStoredThread(validThread({ projectId: '' })), false);
});

// ── workingDirectory field ────────────────────────────────────────────────────

test('isValidStoredThread: missing workingDirectory returns false', () => {
  const { workingDirectory: _, ...rest } = validThread();
  assert.equal(isValidStoredThread(rest), false);
});

test('isValidStoredThread: empty workingDirectory returns false', () => {
  assert.equal(isValidStoredThread(validThread({ workingDirectory: '' })), false);
});

// ── createdAt / lastActiveAt fields ──────────────────────────────────────────

test('isValidStoredThread: non-finite createdAt returns false', () => {
  assert.equal(isValidStoredThread(validThread({ createdAt: NaN })), false);
  assert.equal(isValidStoredThread(validThread({ createdAt: Infinity })), false);
});

test('isValidStoredThread: string createdAt returns false', () => {
  assert.equal(isValidStoredThread(validThread({ createdAt: '2024' })), false);
});

test('isValidStoredThread: non-finite lastActiveAt returns false', () => {
  assert.equal(isValidStoredThread(validThread({ lastActiveAt: NaN })), false);
  assert.equal(isValidStoredThread(validThread({ lastActiveAt: Infinity })), false);
});

// ── promptHistory field ───────────────────────────────────────────────────────

test('isValidStoredThread: missing promptHistory returns false', () => {
  const { promptHistory: _, ...rest } = validThread();
  assert.equal(isValidStoredThread(rest), false);
});

test('isValidStoredThread: null promptHistory returns false', () => {
  assert.equal(isValidStoredThread(validThread({ promptHistory: null })), false);
});

test('isValidStoredThread: non-empty promptHistory passes', () => {
  assert.equal(isValidStoredThread(validThread({ promptHistory: ['hello'] })), true);
});

// ── status field ──────────────────────────────────────────────────────────────

test('isValidStoredThread: all valid statuses pass', () => {
  for (const status of ['running', 'idle', 'error', 'stopped', 'building']) {
    assert.equal(isValidStoredThread(validThread({ status })), true, `status=${status}`);
  }
});

test('isValidStoredThread: invalid status returns false', () => {
  assert.equal(isValidStoredThread(validThread({ status: 'pending' })), false);
  assert.equal(isValidStoredThread(validThread({ status: '' })), false);
  assert.equal(isValidStoredThread(validThread({ status: undefined })), false);
});

// ── provider field ────────────────────────────────────────────────────────────

test('isValidStoredThread: all valid providers pass', () => {
  for (const provider of ['claude', 'codex', 'gemini']) {
    assert.equal(isValidStoredThread(validThread({ provider })), true, `provider=${provider}`);
  }
});

test('isValidStoredThread: undefined provider passes (defaults to claude)', () => {
  assert.equal(isValidStoredThread(validThread({ provider: undefined })), true);
});

test('isValidStoredThread: invalid provider returns false', () => {
  assert.equal(isValidStoredThread(validThread({ provider: 'openai' })), false);
  assert.equal(isValidStoredThread(validThread({ provider: '' })), false);
});

// ── PTY exit handler: touch-on-exit guard (regression for dcb29e2) ───────────
//
// shutdownThreadRuntime sets threadStore status to 'stopped' *before* killing
// the PTY. The resulting exit event must NOT refresh the container registry's
// lastUsedAtMs, otherwise the idle-prune clock restarts from shutdown time
// instead of from true last activity.

function shouldTouchRegistryOnExit(currentStatus) {
  return currentStatus !== 'stopped';
}

test('shouldTouchRegistryOnExit: status=stopped (idle/user shutdown) skips touch', () => {
  assert.equal(shouldTouchRegistryOnExit('stopped'), false);
});

test('shouldTouchRegistryOnExit: status=running (natural exit / crash) triggers touch', () => {
  assert.equal(shouldTouchRegistryOnExit('running'), true);
});

test('shouldTouchRegistryOnExit: status=idle triggers touch', () => {
  assert.equal(shouldTouchRegistryOnExit('idle'), true);
});

test('shouldTouchRegistryOnExit: status=error triggers touch', () => {
  assert.equal(shouldTouchRegistryOnExit('error'), true);
});

test('shouldTouchRegistryOnExit: status=building triggers touch', () => {
  assert.equal(shouldTouchRegistryOnExit('building'), true);
});

test('shouldTouchRegistryOnExit: undefined status (thread already evicted) triggers touch', () => {
  assert.equal(shouldTouchRegistryOnExit(undefined), true);
});
