/**
 * Tests for sessions/ContainerManager.ts — scheduleIdleStop, cancelIdleStop, clearThread (inlined).
 * Uses real short timeouts; no Electron or Docker calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined timer-management logic from ContainerManager.ts ──────────────────

function makeContainerManager() {
  const lastRegistryTouchByThread = new Map();
  const idleTimers = new Map();

  function scheduleIdleStop(threadId, ms, callback) {
    cancelIdleStop(threadId);
    idleTimers.set(threadId, setTimeout(callback, ms));
  }

  function cancelIdleStop(threadId) {
    const timer = idleTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(threadId);
    }
  }

  function clearThread(threadId) {
    lastRegistryTouchByThread.delete(threadId);
    cancelIdleStop(threadId);
  }

  return { lastRegistryTouchByThread, idleTimers, scheduleIdleStop, cancelIdleStop, clearThread };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('scheduleIdleStop fires callback after timeout', async () => {
  const { scheduleIdleStop } = makeContainerManager();
  let called = false;
  scheduleIdleStop('t1', 10, () => { called = true; });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(called);
});

test('cancelIdleStop prevents callback from firing', async () => {
  const { scheduleIdleStop, cancelIdleStop } = makeContainerManager();
  let called = false;
  scheduleIdleStop('t1', 10, () => { called = true; });
  cancelIdleStop('t1');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!called);
});

test('cancelIdleStop removes timer from map', () => {
  const { scheduleIdleStop, cancelIdleStop, idleTimers } = makeContainerManager();
  scheduleIdleStop('t1', 1000, () => {});
  assert.ok(idleTimers.has('t1'));
  cancelIdleStop('t1');
  assert.ok(!idleTimers.has('t1'));
});

test('cancelIdleStop on unknown threadId is a no-op', () => {
  const { cancelIdleStop, idleTimers } = makeContainerManager();
  assert.doesNotThrow(() => cancelIdleStop('nonexistent'));
  assert.equal(idleTimers.size, 0);
});

test('scheduleIdleStop replaces existing timer', async () => {
  const { scheduleIdleStop, idleTimers } = makeContainerManager();
  let firstCalled = false;
  let secondCalled = false;
  scheduleIdleStop('t1', 1000, () => { firstCalled = true; });
  scheduleIdleStop('t1', 10, () => { secondCalled = true; });
  // only one timer should exist
  assert.equal(idleTimers.size, 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!firstCalled, 'first timer should have been cancelled');
  assert.ok(secondCalled, 'second timer should have fired');
});

test('clearThread removes entry from lastRegistryTouchByThread', () => {
  const { lastRegistryTouchByThread, clearThread } = makeContainerManager();
  lastRegistryTouchByThread.set('t1', Date.now());
  clearThread('t1');
  assert.ok(!lastRegistryTouchByThread.has('t1'));
});

test('clearThread cancels pending idle timer', async () => {
  const { scheduleIdleStop, clearThread } = makeContainerManager();
  let called = false;
  scheduleIdleStop('t1', 10, () => { called = true; });
  clearThread('t1');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!called);
});

test('clearThread on unknown threadId is a no-op', () => {
  const { clearThread } = makeContainerManager();
  assert.doesNotThrow(() => clearThread('ghost'));
});

test('multiple threads managed independently', async () => {
  const { scheduleIdleStop, cancelIdleStop } = makeContainerManager();
  const results = [];
  scheduleIdleStop('t1', 10, () => results.push('t1'));
  scheduleIdleStop('t2', 10, () => results.push('t2'));
  cancelIdleStop('t1');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(results, ['t2']);
});
