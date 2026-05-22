/**
 * Tests for kanban/eventRouter.ts — SPAWN_TRIGGERS map and isThreadRunning logic.
 * Logic inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from kanban/eventRouter.ts ───────────────────────────────────────

function isThreadRunning(threadId, threads) {
  if (!threadId) return false;
  const thread = threads[threadId];
  return !!thread && thread.status === 'running';
}

// ── saveToMemory trigger ──────────────────────────────────────────────────────
// Mirrors the condition in KanbanEventRouter.onTaskMoved():
//   saveToMemoryFn && stage?.saveToMemory

function shouldSaveToMemory(saveToMemoryFn, stage) {
  return Boolean(saveToMemoryFn && stage?.saveToMemory);
}

test('saveToMemory: fires when fn is set and stage.saveToMemory is true', () => {
  assert.equal(shouldSaveToMemory(() => {}, { saveToMemory: true }), true);
});

test('saveToMemory: skips when fn is null', () => {
  assert.equal(shouldSaveToMemory(null, { saveToMemory: true }), false);
});

test('saveToMemory: skips when stage.saveToMemory is false', () => {
  assert.equal(shouldSaveToMemory(() => {}, { saveToMemory: false }), false);
});

test('saveToMemory: skips when stage.saveToMemory is undefined', () => {
  assert.equal(shouldSaveToMemory(() => {}, { saveToMemory: undefined }), false);
});

test('saveToMemory: skips when stage is null (terminal status)', () => {
  assert.equal(shouldSaveToMemory(() => {}, null), false);
});

// ── isThreadRunning ───────────────────────────────────────────────────────────

test('isThreadRunning: null threadId returns false', () => {
  assert.equal(isThreadRunning(null, {}), false);
});

test('isThreadRunning: missing thread returns false', () => {
  assert.equal(isThreadRunning('t1', {}), false);
});

test('isThreadRunning: thread with status running returns true', () => {
  assert.equal(isThreadRunning('t1', { t1: { status: 'running' } }), true);
});

test('isThreadRunning: thread with non-running status returns false', () => {
  for (const status of ['idle', 'error', 'stopped', 'archived', 'building']) {
    assert.equal(isThreadRunning('t1', { t1: { status } }), false, `expected false for status=${status}`);
  }
});

// ── onTaskUnblocked guard ─────────────────────────────────────────────────────
// Mirrors the guard in KanbanEventRouter.onTaskUnblocked():
//   skip if thread not found, or status is 'archived' or 'error'.
// Blockers can take days to resolve so the thread may have exited; 'user'
// source restarts the PTY. But archived/error threads should not be restarted.

function shouldNotifyOnUnblock(mainThreadId, threads) {
  if (!mainThreadId) return false;
  const thread = threads[mainThreadId];
  if (!thread || thread.status === 'archived' || thread.status === 'error') return false;
  return true;
}

test('shouldNotifyOnUnblock: skips when mainThreadId is null', () => {
  assert.equal(shouldNotifyOnUnblock(null, {}), false);
});

test('shouldNotifyOnUnblock: skips when thread not in store', () => {
  assert.equal(shouldNotifyOnUnblock('t1', {}), false);
});

test('shouldNotifyOnUnblock: skips archived thread', () => {
  assert.equal(shouldNotifyOnUnblock('t1', { t1: { status: 'archived' } }), false);
});

test('shouldNotifyOnUnblock: skips error thread', () => {
  assert.equal(shouldNotifyOnUnblock('t1', { t1: { status: 'error' } }), false);
});

test('shouldNotifyOnUnblock: notifies running thread', () => {
  assert.equal(shouldNotifyOnUnblock('t1', { t1: { status: 'running' } }), true);
});

test('shouldNotifyOnUnblock: notifies idle thread (PTY may have exited, user source will restart)', () => {
  assert.equal(shouldNotifyOnUnblock('t1', { t1: { status: 'idle' } }), true);
});

test('shouldNotifyOnUnblock: notifies stopped thread (user source will restart)', () => {
  assert.equal(shouldNotifyOnUnblock('t1', { t1: { status: 'stopped' } }), true);
});
