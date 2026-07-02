/**
 * Real-import regression tests for the `startInFlight` guard on ThreadRuntimeStore.
 *
 * Regression: the exit-handler worktree auto-prune (ThreadRuntime.createPtyExitHandler) races an
 * in-place restart. `shutdownThreadRuntime` calls proc.kill() WITHOUT awaiting the PTY 'exit' event,
 * so during ensureHealthy's stop→start the pending exit event can fire mid-startup — after the
 * recreation guard checked the worktree but before the new PTY is registered — and delete the
 * worktree out from under the container coming up, leaving it an empty /workspace.
 *
 * `startThread` sets startInFlight for the whole (re)start; the exit-handler prune skips while it's
 * set. These tests lock the store mechanism (the field exists, and clearThread clears it) plus the
 * guard predicate the handler evaluates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadRuntimeStore } from '../../../src/main/sessions/ThreadRuntimeStore';

test('startInFlight is an empty Set on a fresh store', () => {
  const store = new ThreadRuntimeStore();
  assert.ok(store.startInFlight instanceof Set);
  assert.equal(store.startInFlight.has('t1'), false);
});

test('startInFlight tracks an in-progress (re)start', () => {
  const store = new ThreadRuntimeStore();
  store.startInFlight.add('t1');
  assert.equal(store.startInFlight.has('t1'), true);
  store.startInFlight.delete('t1');
  assert.equal(store.startInFlight.has('t1'), false);
});

test('clearThread removes startInFlight for the thread', () => {
  const store = new ThreadRuntimeStore();
  store.startInFlight.add('t1');
  store.clearThread('t1');
  assert.equal(store.startInFlight.has('t1'), false);
});

test('clearThread does not clear startInFlight for other threads', () => {
  const store = new ThreadRuntimeStore();
  store.startInFlight.add('t1');
  store.startInFlight.add('t2');
  store.clearThread('t1');
  assert.equal(store.startInFlight.has('t2'), true);
});

// Mirrors the exit-handler auto-prune predicate (ThreadRuntime.createPtyExitHandler). Kept in sync
// with the guard clauses there: prune only a clean+synced worktree, and only when no restart is
// racing — i.e. no live PTY and no in-flight start.
function shouldAutoPrune(store: ThreadRuntimeStore, threadId: string, worktreeCleanAndSynced: boolean): boolean {
  return worktreeCleanAndSynced && !store.ptys.has(threadId) && !store.startInFlight.has(threadId);
}

test('auto-prune is blocked while a start is in flight (the race)', () => {
  const store = new ThreadRuntimeStore();
  // Clean+synced worktree, no live PTY yet (mid-startup) — without the guard this would prune.
  store.startInFlight.add('t1');
  assert.equal(shouldAutoPrune(store, 't1', true), false);
});

test('auto-prune proceeds for a genuine idle stop with no restart', () => {
  const store = new ThreadRuntimeStore();
  assert.equal(shouldAutoPrune(store, 't1', true), true);
});

test('auto-prune is blocked once the thread has a live PTY again', () => {
  const store = new ThreadRuntimeStore();
  store.ptys.set('t1', {} as never);
  assert.equal(shouldAutoPrune(store, 't1', true), false);
});
