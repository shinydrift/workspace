/**
 * Tests for sessions/ThreadInputQueue.ts
 * Class inlined with stubbed eventLogger — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Stub eventLogger ──────────────────────────────────────────────────────────

const eventLogger = { warn: () => {}, error: () => {} };

// ── Inlined from ThreadInputQueue.ts ─────────────────────────────────────────

class ThreadInputQueue {
  queues = new Map();
  processing = new Set();

  async enqueue(params) {
    const timeoutMs = Math.max(1_000, params.timeoutMs ?? 120_000);
    const dropPolicy = params.dropPolicy ?? 'timeout';
    const queue = this.queues.get(params.threadId) ?? [];

    return await new Promise((resolve, reject) => {
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        input: params.input,
        source: params.source,
        enqueuedAt: Date.now(),
        timeoutMs,
        dropPolicy,
        execute: params.execute,
        resolve,
        reject,
      };
      queue.push(item);
      this.queues.set(params.threadId, queue);
      params.onDepthChange?.(params.threadId, queue.length);

      if (!this.processing.has(params.threadId)) {
        this.drain(params.threadId, params.onDepthChange).catch((error) => {
          eventLogger.error('queue', 'Queue drain failed', {
            threadId: params.threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
  }

  queueDepth(threadId) {
    return (this.queues.get(threadId) ?? []).length;
  }

  clearQueue(threadId) {
    const queue = this.queues.get(threadId) ?? [];
    for (const item of queue) {
      item.reject(new Error('Thread queue cleared'));
    }
    this.queues.delete(threadId);
    this.processing.delete(threadId);
  }

  dropPendingItemsBySource(threadId, source, onDepthChange) {
    const queue = this.queues.get(threadId);
    if (!queue || queue.length <= 1) return 0;

    const pending = queue.splice(1);
    const toReject = pending.filter((item) => item.source === source);
    const toKeep = pending.filter((item) => item.source !== source);
    queue.push(...toKeep);

    if (toReject.length > 0) {
      onDepthChange?.(threadId, queue.length);
      for (const item of toReject) {
        item.reject(new Error('Superseded by newer input'));
      }
    }
    return toReject.length;
  }

  async drain(threadId, onDepthChange) {
    if (this.processing.has(threadId)) return;
    this.processing.add(threadId);
    try {
      let queue = this.queues.get(threadId) ?? [];
      while (queue.length > 0) {
        const currentQueue = this.queues.get(threadId) ?? [];
        const item = currentQueue[0];
        if (!item) break;

        const waitMs = Date.now() - item.enqueuedAt;
        if (item.dropPolicy === 'timeout' && waitMs > item.timeoutMs) {
          currentQueue.shift();
          onDepthChange?.(threadId, currentQueue.length);
          item.reject(new Error(`Input timed out in queue after ${item.timeoutMs}ms`));
          eventLogger.warn('queue', 'Dropping expired queued input', {
            threadId, source: item.source, timeoutMs: item.timeoutMs,
          });
          continue;
        }

        try {
          await item.execute(item);
          item.resolve();
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          currentQueue.shift();
          onDepthChange?.(threadId, currentQueue.length);
        }
        queue = this.queues.get(threadId) ?? [];
      }
    } finally {
      this.processing.delete(threadId);
      if ((this.queues.get(threadId) ?? []).length === 0) {
        this.queues.delete(threadId);
      }
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('queueDepth: returns 0 for unknown thread', () => {
  const q = new ThreadInputQueue();
  assert.equal(q.queueDepth('t1'), 0);
});

test('enqueue: executes and resolves', async () => {
  const q = new ThreadInputQueue();
  let ran = false;
  await q.enqueue({
    threadId: 't1', input: 'hi', source: 'user',
    execute: async () => { ran = true; },
  });
  assert.ok(ran);
});

test('enqueue: sequential items execute in order', async () => {
  const q = new ThreadInputQueue();
  const order = [];
  const p1 = q.enqueue({ threadId: 't1', input: '1', source: 'user', execute: async () => order.push(1) });
  const p2 = q.enqueue({ threadId: 't1', input: '2', source: 'user', execute: async () => order.push(2) });
  await Promise.all([p1, p2]);
  assert.deepEqual(order, [1, 2]);
});

test('enqueue: onDepthChange called with increasing depth', async () => {
  const q = new ThreadInputQueue();
  const depths = [];
  // Slow first item so second can queue up
  let releaseFirst;
  const firstDone = new Promise((res) => { releaseFirst = res; });

  const p1 = q.enqueue({
    threadId: 't1', input: '1', source: 'user',
    onDepthChange: (_, d) => depths.push(d),
    execute: async () => { await firstDone; },
  });
  // Give first item a tick to start executing
  await new Promise((r) => setImmediate(r));

  const p2 = q.enqueue({
    threadId: 't1', input: '2', source: 'user',
    onDepthChange: (_, d) => depths.push(d),
    execute: async () => {},
  });

  releaseFirst();
  await Promise.all([p1, p2]);
  assert.ok(depths.some((d) => d >= 1));
});

test('enqueue: execute error rejects promise', async () => {
  const q = new ThreadInputQueue();
  await assert.rejects(
    () => q.enqueue({ threadId: 't1', input: 'bad', source: 'user', execute: async () => { throw new Error('boom'); } }),
    /boom/,
  );
});

test('clearQueue: rejects all pending items', async () => {
  const q = new ThreadInputQueue();
  // Enqueue two items before draining starts, so both sit in the queue
  const queue = [];
  q.queues.set('t1', queue);

  const p1 = new Promise((resolve, reject) => {
    queue.push({ id: '1', input: '1', source: 'user', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => {}, resolve, reject });
  });
  const p2 = new Promise((resolve, reject) => {
    queue.push({ id: '2', input: '2', source: 'user', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => {}, resolve, reject });
  });

  q.clearQueue('t1');

  await assert.rejects(() => p1, /Thread queue cleared/);
  await assert.rejects(() => p2, /Thread queue cleared/);
});

test('dropPendingItemsBySource: returns 0 when queue has <= 1 item', () => {
  const q = new ThreadInputQueue();
  assert.equal(q.dropPendingItemsBySource('t1', 'automation'), 0);
});

test('dropPendingItemsBySource: drops matching pending items', async () => {
  const q = new ThreadInputQueue();
  const queue = [];
  q.queues.set('t1', queue);

  // First item — acts as the "currently executing" slot
  queue.push({ id: '1', input: '1', source: 'user', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => {}, resolve: () => {}, reject: () => {} });

  // Second item — pending, should be dropped
  const p2 = new Promise((resolve, reject) => {
    queue.push({ id: '2', input: '2', source: 'automation', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => {}, resolve, reject });
  });

  const dropped = q.dropPendingItemsBySource('t1', 'automation');
  assert.equal(dropped, 1);
  await assert.rejects(() => p2, /Superseded/);
});

test('dropPendingItemsBySource: keeps items from other sources', async () => {
  const q = new ThreadInputQueue();
  const queue = [];
  q.queues.set('t1', queue);

  // First item — currently executing slot
  queue.push({ id: '1', input: '1', source: 'user', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => {}, resolve: () => {}, reject: () => {} });

  // Second item — different source, should be kept
  let ran = false;
  const p2 = new Promise((resolve, reject) => {
    queue.push({ id: '2', input: '2', source: 'user', enqueuedAt: Date.now(), timeoutMs: 120_000, dropPolicy: 'never', execute: async () => { ran = true; }, resolve, reject });
  });

  const dropped = q.dropPendingItemsBySource('t1', 'automation'); // different source
  assert.equal(dropped, 0);
  assert.equal(q.queueDepth('t1'), 2); // both items still there
  // Resolve p2 manually to avoid dangling promise
  queue[1].resolve();
  await p2;
  assert.ok(!ran); // execute not called (we resolved manually)
});
