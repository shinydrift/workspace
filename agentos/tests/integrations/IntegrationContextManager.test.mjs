/**
 * Tests for integrations/IntegrationContextManager.ts
 * Class is inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from IntegrationContextManager.ts ─────────────────────────────────

class IntegrationContextManager {
  slackContexts = new Map();

  setSlackContext(threadId, ctx) { this.slackContexts.set(threadId, ctx); }
  getSlackContext(threadId) { return this.slackContexts.get(threadId); }
  clearSlackContext(threadId) { this.slackContexts.delete(threadId); }

  clearAll(threadId) {
    this.slackContexts.delete(threadId);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('slack: set and get context', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: '123.456' });
  assert.deepEqual(m.getSlackContext('t1'), { channelId: 'C1', threadTs: '123.456' });
});

test('slack: get unknown thread returns undefined', () => {
  const m = new IntegrationContextManager();
  assert.equal(m.getSlackContext('missing'), undefined);
});

test('slack: clear removes context', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: null });
  m.clearSlackContext('t1');
  assert.equal(m.getSlackContext('t1'), undefined);
});

test('slack: threadTs can be null', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: null });
  assert.equal(m.getSlackContext('t1').threadTs, null);
});

test('clearAll: removes slack context for thread', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: '1' });
  m.clearAll('t1');
  assert.equal(m.getSlackContext('t1'), undefined);
});

test('clearAll: does not affect other threads', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: '1' });
  m.setSlackContext('t2', { channelId: 'C2', threadTs: '2' });
  m.clearAll('t1');
  assert.ok(m.getSlackContext('t2') !== undefined);
});

test('multiple threads are independent', () => {
  const m = new IntegrationContextManager();
  m.setSlackContext('t1', { channelId: 'C1', threadTs: '1' });
  m.setSlackContext('t2', { channelId: 'C2', threadTs: '2' });
  assert.equal(m.getSlackContext('t1').channelId, 'C1');
  assert.equal(m.getSlackContext('t2').channelId, 'C2');
});
