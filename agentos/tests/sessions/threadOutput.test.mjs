/**
 * Tests for sessions/ThreadOutputManager (in-memory methods only — no Electron deps).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined in-memory portion of ThreadOutputManager ─────────────────────────

// We test the in-memory methods: initLogBuffer, cleanupThread, getLogHistory,
// appendLog (buffer management), getPendingOutput, clearPendingOutput,
// getRecentThreadOutput.

const MAX_LOG_BUFFER_DEFAULT = 2000;

class ThreadOutputManager {
  logBuffers = new Map();
  pendingAssistantChunks = new Map();

  initLogBuffer(threadId) {
    this.logBuffers.set(threadId, []);
  }

  cleanupThread(threadId) {
    this.logBuffers.delete(threadId);
    this.pendingAssistantChunks.delete(threadId);
  }

  getLogHistory(threadId) {
    return this.logBuffers.get(threadId) ?? [];
  }

  appendLog(threadId, data, maxLogBuffer = MAX_LOG_BUFFER_DEFAULT) {
    const buf = this.logBuffers.get(threadId) ?? [];
    buf.push({ id: `id-${Date.now()}-${Math.random()}`, timestamp: Date.now(), data, source: 'stdout' });
    if (buf.length > maxLogBuffer) buf.shift();
    this.logBuffers.set(threadId, buf);
    const chunks = this.pendingAssistantChunks.get(threadId) ?? [];
    chunks.push(data);
    this.pendingAssistantChunks.set(threadId, chunks);
  }

  appendSystemLogEntry(threadId, data, maxLogBuffer = MAX_LOG_BUFFER_DEFAULT) {
    const buf = this.logBuffers.get(threadId) ?? [];
    const entry = data.endsWith('\r\n') ? data : `${data}\r\n`;
    buf.push({ id: `id-${Date.now()}`, timestamp: Date.now(), data: entry, source: 'system' });
    if (buf.length > maxLogBuffer) buf.shift();
    this.logBuffers.set(threadId, buf);
  }

  getPendingOutput(threadId) {
    return (this.pendingAssistantChunks.get(threadId) ?? []).join('');
  }

  clearPendingOutput(threadId) {
    this.pendingAssistantChunks.set(threadId, []);
  }

  getRecentThreadOutput(threadId) {
    const history = this.logBuffers.get(threadId) ?? [];
    return history
      .slice(-20)
      .map((entry) => entry.data)
      .join('');
  }
}

// ── initLogBuffer ─────────────────────────────────────────────────────────────

test('initLogBuffer creates empty buffer', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  assert.deepEqual(mgr.getLogHistory('t1'), []);
});

test('initLogBuffer for multiple threads', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.initLogBuffer('t2');
  assert.deepEqual(mgr.getLogHistory('t1'), []);
  assert.deepEqual(mgr.getLogHistory('t2'), []);
});

// ── getLogHistory ─────────────────────────────────────────────────────────────

test('getLogHistory returns empty array for unknown thread', () => {
  const mgr = new ThreadOutputManager();
  assert.deepEqual(mgr.getLogHistory('unknown'), []);
});

// ── appendLog ─────────────────────────────────────────────────────────────────

test('appendLog adds entry to log buffer', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'hello');
  const history = mgr.getLogHistory('t1');
  assert.equal(history.length, 1);
  assert.equal(history[0].data, 'hello');
  assert.equal(history[0].source, 'stdout');
});

test('appendLog evicts oldest entry when buffer exceeds max', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  for (let i = 0; i < 5; i++) mgr.appendLog('t1', `msg-${i}`, 3);
  const history = mgr.getLogHistory('t1');
  assert.equal(history.length, 3);
  assert.equal(history[0].data, 'msg-2');
});

test('appendLog also accumulates in pendingAssistantChunks', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'chunk1');
  mgr.appendLog('t1', 'chunk2');
  assert.equal(mgr.getPendingOutput('t1'), 'chunk1chunk2');
});

// ── appendSystemLogEntry ──────────────────────────────────────────────────────

test('appendSystemLogEntry adds source=system entry', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendSystemLogEntry('t1', 'system event');
  const history = mgr.getLogHistory('t1');
  assert.equal(history[0].source, 'system');
});

test('appendSystemLogEntry appends CRLF when missing', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendSystemLogEntry('t1', 'no crlf');
  const entry = mgr.getLogHistory('t1')[0];
  assert.ok(entry.data.endsWith('\r\n'));
});

test('appendSystemLogEntry preserves existing CRLF', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendSystemLogEntry('t1', 'has crlf\r\n');
  const entry = mgr.getLogHistory('t1')[0];
  assert.equal(entry.data, 'has crlf\r\n');
});

// ── getPendingOutput / clearPendingOutput ─────────────────────────────────────

test('getPendingOutput returns empty string for unknown thread', () => {
  const mgr = new ThreadOutputManager();
  assert.equal(mgr.getPendingOutput('unknown'), '');
});

test('clearPendingOutput empties pending chunks', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'data');
  mgr.clearPendingOutput('t1');
  assert.equal(mgr.getPendingOutput('t1'), '');
});

test('clearPendingOutput does not affect log buffer', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'data');
  mgr.clearPendingOutput('t1');
  assert.equal(mgr.getLogHistory('t1').length, 1);
});

// ── cleanupThread ─────────────────────────────────────────────────────────────

test('cleanupThread removes log buffer', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'data');
  mgr.cleanupThread('t1');
  assert.deepEqual(mgr.getLogHistory('t1'), []);
});

test('cleanupThread removes pending chunks', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'data');
  mgr.cleanupThread('t1');
  assert.equal(mgr.getPendingOutput('t1'), '');
});

test('cleanupThread does not affect other threads', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.initLogBuffer('t2');
  mgr.appendLog('t1', 'a');
  mgr.appendLog('t2', 'b');
  mgr.cleanupThread('t1');
  assert.equal(mgr.getLogHistory('t2').length, 1);
});

// ── getRecentThreadOutput ─────────────────────────────────────────────────────

test('getRecentThreadOutput returns last 20 entries joined', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  for (let i = 0; i < 25; i++) mgr.appendLog('t1', `L${i}`);
  const output = mgr.getRecentThreadOutput('t1');
  assert.ok(output.includes('L24'));
  assert.ok(!output.includes('L4')); // first 5 should not appear
});

test('getRecentThreadOutput returns empty string for unknown thread', () => {
  const mgr = new ThreadOutputManager();
  assert.equal(mgr.getRecentThreadOutput('unknown'), '');
});

test('getRecentThreadOutput returns all when fewer than 20 entries', () => {
  const mgr = new ThreadOutputManager();
  mgr.initLogBuffer('t1');
  mgr.appendLog('t1', 'a');
  mgr.appendLog('t1', 'b');
  assert.equal(mgr.getRecentThreadOutput('t1'), 'ab');
});
