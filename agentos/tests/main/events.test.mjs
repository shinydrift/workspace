/**
 * Tests for main/events.ts — internalBus emit/subscribe helpers (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Inlined from events.ts ────────────────────────────────────────────────────
// eventLogger has an Electron dependency so we inline the bus with a no-op logger.

function makeEventBus() {
  const errors = [];
  const _bus = new EventEmitter();

  const bus = {
    on: _bus.on.bind(_bus),
    off: _bus.off.bind(_bus),
    once: _bus.once.bind(_bus),
    removeAllListeners: _bus.removeAllListeners.bind(_bus),
    emit(event, ...args) {
      for (const listener of _bus.rawListeners(event)) {
        try {
          listener(...args);
        } catch (err) {
          errors.push({ event, err });
        }
      }
    },
  };

  function emitMessageAppended(payload) {
    bus.emit('message:appended', payload);
  }

  function emitTokenUsage(payload) {
    bus.emit('token:usage', payload);
  }

  function emitThreadIdle(payload) {
    bus.emit('thread:idle', payload);
  }

  return { bus, emitMessageAppended, emitTokenUsage, emitThreadIdle, errors };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('emitMessageAppended fires message:appended with payload', () => {
  const { bus, emitMessageAppended } = makeEventBus();
  const received = [];
  bus.on('message:appended', (p) => received.push(p));

  const payload = { threadId: 't1', message: { role: 'assistant', content: 'hi' } };
  emitMessageAppended(payload);

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], payload);
});

test('emitTokenUsage fires token:usage with payload', () => {
  const { bus, emitTokenUsage } = makeEventBus();
  const received = [];
  bus.on('token:usage', (p) => received.push(p));

  const payload = { threadId: 't1', projectId: 'p1', provider: 'claude', inputTokens: 100, outputTokens: 50 };
  emitTokenUsage(payload);

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], payload);
});

test('emitThreadIdle fires thread:idle with payload', () => {
  const { bus, emitThreadIdle } = makeEventBus();
  const received = [];
  bus.on('thread:idle', (p) => received.push(p));

  const payload = { threadId: 't1' };
  emitThreadIdle(payload);

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], payload);
});

test('multiple listeners all receive the event', () => {
  const { bus, emitMessageAppended } = makeEventBus();
  const results = [];
  bus.on('message:appended', () => results.push(1));
  bus.on('message:appended', () => results.push(2));

  emitMessageAppended({ threadId: 't1' });

  assert.deepEqual(results, [1, 2]);
});

test('emitting one event does not fire another', () => {
  const { bus, emitMessageAppended } = makeEventBus();
  const tokenUsageCalled = [];
  bus.on('token:usage', (p) => tokenUsageCalled.push(p));

  emitMessageAppended({ threadId: 't1' });

  assert.equal(tokenUsageCalled.length, 0);
});

test('multiple emit calls deliver each payload independently', () => {
  const { bus, emitTokenUsage } = makeEventBus();
  const received = [];
  bus.on('token:usage', (p) => received.push(p));

  emitTokenUsage({ threadId: 'a', inputTokens: 10, outputTokens: 5 });
  emitTokenUsage({ threadId: 'b', inputTokens: 20, outputTokens: 10 });

  assert.equal(received.length, 2);
  assert.equal(received[0].threadId, 'a');
  assert.equal(received[1].threadId, 'b');
});

test('once listener fires only on the first emit', () => {
  const { bus, emitThreadIdle } = makeEventBus();
  const received = [];
  bus.once('thread:idle', (p) => received.push(p));

  emitThreadIdle({ threadId: 't1' });
  emitThreadIdle({ threadId: 't2' });

  assert.equal(received.length, 1);
  assert.equal(received[0].threadId, 't1');
});

test('no listener — emit does not throw', () => {
  const { emitMessageAppended } = makeEventBus();
  assert.doesNotThrow(() => emitMessageAppended({ threadId: 't1' }));
});

test('throwing listener does not crash the caller', () => {
  const { bus, errors } = makeEventBus();
  bus.on('test:event', () => { throw new Error('boom'); });

  assert.doesNotThrow(() => bus.emit('test:event'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].err.message, 'boom');
});

test('throwing listener does not block subsequent listeners', () => {
  const { bus } = makeEventBus();
  const results = [];
  bus.on('test:event', () => { throw new Error('first throws'); });
  bus.on('test:event', () => results.push('second ran'));

  bus.emit('test:event');

  assert.deepEqual(results, ['second ran']);
});

test('removeAllListeners removes all handlers for an event', () => {
  const { bus } = makeEventBus();
  const results = [];
  bus.on('test:event', () => results.push(1));
  bus.on('test:event', () => results.push(2));
  bus.removeAllListeners('test:event');

  bus.emit('test:event');

  assert.deepEqual(results, []);
});
