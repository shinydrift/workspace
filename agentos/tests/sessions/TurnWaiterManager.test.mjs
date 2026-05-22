/**
 * Tests for sessions/TurnWaiterManager.ts — has, wait (silence fallback + timeout + cancel),
 * observe, reject.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from TurnWaiterManager.ts (stripped store/eventLogger deps) ──────

class TurnWaiterManager {
  waiters = new Map();

  has(threadId) {
    return this.waiters.has(threadId);
  }

  observe(threadId, data, { silenceFallbackMs = 1500, isReady = () => false } = {}) {
    const waiter = this.waiters.get(threadId);
    if (!waiter) return;
    waiter.tail = `${waiter.tail}${data}`.slice(-4096);
    if (isReady(waiter.tail)) {
      waiter.settle('ready-signal');
      return;
    }
    if (waiter.silenceTimer) clearTimeout(waiter.silenceTimer);
    waiter.silenceTimer = setTimeout(() => { waiter.settle('silence-fallback'); }, silenceFallbackMs);
  }

  reject(threadId, error) {
    const waiter = this.waiters.get(threadId);
    if (!waiter) return;
    waiter.settle('cancelled', error);
  }

  async wait(threadId, source, hasPty, timeoutMs, silenceFallbackMs = 100) {
    if (!hasPty) throw new Error(`Thread ${threadId} is not running`);
    if (this.waiters.has(threadId)) throw new Error(`Thread ${threadId} already has a pending turn waiter`);

    await new Promise((resolve, reject) => {
      const waiter = {
        tail: '',
        silenceTimer: null,
        timeoutTimer: null,
        settle: (reason, error) => {
          const active = this.waiters.get(threadId);
          if (!active || active !== waiter) return;
          if (waiter.silenceTimer) clearTimeout(waiter.silenceTimer);
          if (waiter.timeoutTimer) clearTimeout(waiter.timeoutTimer);
          this.waiters.delete(threadId);
          if (error) { reject(error); return; }
          resolve();
        },
      };

      if (timeoutMs && timeoutMs > 0) {
        waiter.timeoutTimer = setTimeout(() => {
          waiter.settle('timeout', new Error(`Input timed out waiting for completion after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      waiter.silenceTimer = setTimeout(() => { waiter.settle('silence-fallback'); }, silenceFallbackMs);
      this.waiters.set(threadId, waiter);
    });
  }
}

// ── has ───────────────────────────────────────────────────────────────────────

test('has returns false for unknown thread', () => {
  const mgr = new TurnWaiterManager();
  assert.equal(mgr.has('t1'), false);
});

test('has returns true once wait is in progress', async () => {
  const mgr = new TurnWaiterManager();
  const promise = mgr.wait('t1', 'user', true, undefined, 50);
  assert.equal(mgr.has('t1'), true);
  await promise;
});

test('has returns false after waiter resolves', async () => {
  const mgr = new TurnWaiterManager();
  await mgr.wait('t1', 'user', true, undefined, 10);
  assert.equal(mgr.has('t1'), false);
});

// ── wait — error conditions ───────────────────────────────────────────────────

test('wait throws when hasPty is false', async () => {
  const mgr = new TurnWaiterManager();
  await assert.rejects(() => mgr.wait('t1', 'user', false), /not running/);
});

test('wait throws when waiter already exists for thread', async () => {
  const mgr = new TurnWaiterManager();
  const p1 = mgr.wait('t1', 'user', true, undefined, 200);
  await assert.rejects(() => mgr.wait('t1', 'user', true, undefined, 10), /already has a pending/);
  await p1;
});

// ── wait — silence fallback ───────────────────────────────────────────────────

test('wait resolves via silence fallback', async () => {
  const mgr = new TurnWaiterManager();
  await assert.doesNotReject(() => mgr.wait('t1', 'user', true, undefined, 30));
});

// ── wait — timeout ────────────────────────────────────────────────────────────

test('wait rejects with timeout error', async () => {
  const mgr = new TurnWaiterManager();
  // silence at 200ms, timeout at 20ms → timeout fires first
  await assert.rejects(
    () => mgr.wait('t1', 'user', true, 20, 200),
    /timed out/
  );
});

// ── reject ────────────────────────────────────────────────────────────────────

test('reject resolves nothing for unknown thread (no throw)', () => {
  const mgr = new TurnWaiterManager();
  assert.doesNotThrow(() => mgr.reject('ghost', new Error('e')));
});

test('reject causes wait to reject with given error', async () => {
  const mgr = new TurnWaiterManager();
  const waitPromise = mgr.wait('t1', 'user', true, undefined, 5000);
  mgr.reject('t1', new Error('cancelled by test'));
  await assert.rejects(() => waitPromise, /cancelled by test/);
});

test('reject removes waiter so has() returns false', async () => {
  const mgr = new TurnWaiterManager();
  const waitPromise = mgr.wait('t1', 'user', true, undefined, 5000);
  mgr.reject('t1', new Error('done'));
  try { await waitPromise; } catch { /* expected */ }
  assert.equal(mgr.has('t1'), false);
});

// ── observe ───────────────────────────────────────────────────────────────────

test('observe does nothing for unknown thread', () => {
  const mgr = new TurnWaiterManager();
  assert.doesNotThrow(() => mgr.observe('ghost', 'data'));
});

test('observe resolves waiter when isReady returns true', async () => {
  const mgr = new TurnWaiterManager();
  const waitPromise = mgr.wait('t1', 'user', true, undefined, 5000);
  mgr.observe('t1', 'READY', { silenceFallbackMs: 5000, isReady: (tail) => tail.includes('READY') });
  await assert.doesNotReject(() => waitPromise);
});

test('observe keeps last 4096 chars of tail', async () => {
  const mgr = new TurnWaiterManager();
  const waitPromise = mgr.wait('t1', 'user', true, undefined, 5000);
  const long = 'x'.repeat(5000);
  let capturedTail = '';
  mgr.observe('t1', long, {
    silenceFallbackMs: 5000,
    isReady: (tail) => {
      capturedTail = tail;
      return true;
    },
  });
  await waitPromise;
  assert.equal(capturedTail.length, 4096);
});
