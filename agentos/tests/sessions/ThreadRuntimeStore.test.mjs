/**
 * Tests for sessions/ThreadRuntimeStore.ts — getInjectionStatus, clearThread.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ThreadRuntimeStore.ts ───────────────────────────────────────

class ThreadRuntimeStore {
  ptys = new Map();
  launchModes = new Map();
  activeTurnProcs = new Map();
  injectionStatuses = new Map();

  getInjectionStatus(threadId) {
    return this.injectionStatuses.get(threadId) ?? { hasBoot: false, hasMemory: false, injected: false };
  }

  clearThread(threadId) {
    this.ptys.delete(threadId);
    this.launchModes.delete(threadId);
    this.activeTurnProcs.delete(threadId);
    this.injectionStatuses.delete(threadId);
  }
}

// ── getInjectionStatus ────────────────────────────────────────────────────────

test('getInjectionStatus returns default when thread not set', () => {
  const store = new ThreadRuntimeStore();
  const status = store.getInjectionStatus('unknown');
  assert.deepEqual(status, { hasBoot: false, hasMemory: false, injected: false });
});

test('getInjectionStatus returns stored status', () => {
  const store = new ThreadRuntimeStore();
  const status = { hasBoot: true, hasMemory: false, injected: true };
  store.injectionStatuses.set('t1', status);
  assert.deepEqual(store.getInjectionStatus('t1'), status);
});

test('getInjectionStatus returns default for different thread', () => {
  const store = new ThreadRuntimeStore();
  store.injectionStatuses.set('t1', { hasBoot: true, hasMemory: true, injected: true });
  const status = store.getInjectionStatus('t2');
  assert.deepEqual(status, { hasBoot: false, hasMemory: false, injected: false });
});

test('getInjectionStatus reflects updated value', () => {
  const store = new ThreadRuntimeStore();
  store.injectionStatuses.set('t1', { hasBoot: false, hasMemory: false, injected: false });
  store.injectionStatuses.set('t1', { hasBoot: true, hasMemory: false, injected: true });
  assert.equal(store.getInjectionStatus('t1').hasBoot, true);
});

// ── clearThread ───────────────────────────────────────────────────────────────

test('clearThread removes pty for thread', () => {
  const store = new ThreadRuntimeStore();
  store.ptys.set('t1', { fake: 'pty' });
  store.clearThread('t1');
  assert.equal(store.ptys.has('t1'), false);
});

test('clearThread removes launchMode for thread', () => {
  const store = new ThreadRuntimeStore();
  store.launchModes.set('t1', 'headless');
  store.clearThread('t1');
  assert.equal(store.launchModes.has('t1'), false);
});

test('clearThread removes activeTurnProc for thread', () => {
  const store = new ThreadRuntimeStore();
  store.activeTurnProcs.set('t1', { proc: {}, input: 'test' });
  store.clearThread('t1');
  assert.equal(store.activeTurnProcs.has('t1'), false);
});

test('clearThread removes injectionStatus for thread', () => {
  const store = new ThreadRuntimeStore();
  store.injectionStatuses.set('t1', { hasBoot: true, hasMemory: false, injected: true });
  store.clearThread('t1');
  assert.equal(store.injectionStatuses.has('t1'), false);
});

test('clearThread does not affect other threads', () => {
  const store = new ThreadRuntimeStore();
  store.ptys.set('t1', { fake: 'pty' });
  store.ptys.set('t2', { other: 'pty' });
  store.clearThread('t1');
  assert.equal(store.ptys.has('t2'), true);
});

test('clearThread on non-existent thread does not throw', () => {
  const store = new ThreadRuntimeStore();
  assert.doesNotThrow(() => store.clearThread('ghost'));
});

test('clearThread resets injectionStatus to default after clear', () => {
  const store = new ThreadRuntimeStore();
  store.injectionStatuses.set('t1', { hasBoot: true, hasMemory: true, injected: true });
  store.clearThread('t1');
  const status = store.getInjectionStatus('t1');
  assert.deepEqual(status, { hasBoot: false, hasMemory: false, injected: false });
});
