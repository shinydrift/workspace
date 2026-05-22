/**
 * Tests for sessions/startupInjection.ts — scheduleStartupInjection state machine (inlined).
 * Uses a mock EventEmitter in place of PtyProcess.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Inlined from startupInjection.ts (minus isCliReady import) ───────────────
//
// isCliReady is tested separately in readySignalDetector.test.mjs.
// Two extra params are added for testability:
//   isReady(tail) — replaces isCliReady(provider, tail); defaults to () => false
//   hardTimeoutMs — allows fast-forwarding the hard timeout in tests; defaults to 2500

function scheduleStartupInjection({ threadId, proc, payload, details, onSendInput, onInjected, onAppendLog, isReady = () => false, hardTimeoutMs = 2500 }) {
  let injected = false;
  let tail = '';

  const cleanup = () => {
    clearTimeout(hardTimeout);
    proc.off('data', onData);
    proc.off('exit', onExit);
  };

  const markInjected = (reason) => {
    if (injected) return;
    injected = true;
    cleanup();
    onSendInput(threadId, `${payload}\n`, 'boot')
      .then(() => {
        const warnSuffix = details.warnings.length > 0 ? ` [warnings: ${details.warnings.join('; ')}]` : '';
        onAppendLog(threadId, `[startup injected via ${reason}]${warnSuffix}`);
      })
      .catch((error) => {
        onAppendLog(threadId, `[startup injection failed: ${String(error)}]`);
      });
    onInjected(threadId, {
      hasBoot: details.hasBoot,
      hasMemory: details.hasMemory,
      injected: true,
    });
  };

  const onData = (chunk) => {
    if (injected) return;
    tail = `${tail}${chunk}`.slice(-4096);
    if (isReady(tail)) {
      markInjected('ready-signal');
      return;
    }
    markInjected('first-output');
  };

  const onExit = () => {
    if (injected) return;
    cleanup();
    onInjected(threadId, {
      hasBoot: details.hasBoot,
      hasMemory: details.hasMemory,
      injected: false,
      error: 'Process exited before startup injection',
    });
  };

  const hardTimeout = setTimeout(() => markInjected('timeout'), hardTimeoutMs);
  proc.on('data', onData);
  proc.on('exit', onExit);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DETAILS = { hasBoot: true, hasMemory: true, warnings: [] };

function makeProc() {
  return new EventEmitter();
}

// ── first-output path ─────────────────────────────────────────────────────────

test('injects on first data event (first-output reason)', async () => {
  const proc = makeProc();
  const injectedCalls = [];
  const sendCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-1',
    proc,
    payload: 'hello',
    details: DETAILS,
    onSendInput: async (id, input) => { sendCalls.push({ id, input }); },
    onInjected: (id, status) => { injectedCalls.push({ id, status }); },
    onAppendLog: () => {},
  });

  proc.emit('data', 'some output');

  await new Promise(r => setImmediate(r));

  assert.equal(injectedCalls.length, 1);
  assert.equal(injectedCalls[0].status.injected, true);
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].input, 'hello\n');
});

// ── ready-signal path ─────────────────────────────────────────────────────────

test('uses ready-signal reason when isReady returns true', async () => {
  const proc = makeProc();
  const logCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-2',
    proc,
    payload: 'payload',
    details: DETAILS,
    onSendInput: async () => {},
    onInjected: () => {},
    onAppendLog: (_, msg) => { logCalls.push(msg); },
    isReady: () => true,
  });

  proc.emit('data', 'ready!');

  await new Promise(r => setImmediate(r));

  assert.ok(logCalls.some(m => m.includes('ready-signal')));
});

// ── exit before injection ─────────────────────────────────────────────────────

test('exit before data → onInjected called with injected:false', () => {
  const proc = makeProc();
  const injectedCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-3',
    proc,
    payload: 'p',
    details: DETAILS,
    onSendInput: async () => {},
    onInjected: (_, s) => { injectedCalls.push(s); },
    onAppendLog: () => {},
  });

  proc.emit('exit');

  assert.equal(injectedCalls.length, 1);
  assert.equal(injectedCalls[0].injected, false);
  assert.ok(injectedCalls[0].error.includes('exited'));
});

// ── no double injection ───────────────────────────────────────────────────────

test('second data event does not trigger a second injection', async () => {
  const proc = makeProc();
  const injectedCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-4',
    proc,
    payload: 'p',
    details: DETAILS,
    onSendInput: async () => {},
    onInjected: (_, s) => { injectedCalls.push(s); },
    onAppendLog: () => {},
  });

  proc.emit('data', 'first');
  proc.emit('data', 'second');

  await new Promise(r => setImmediate(r));

  assert.equal(injectedCalls.length, 1);
});

test('exit after data does not produce a second onInjected call', async () => {
  const proc = makeProc();
  const injectedCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-5',
    proc,
    payload: 'p',
    details: DETAILS,
    onSendInput: async () => {},
    onInjected: (_, s) => { injectedCalls.push(s); },
    onAppendLog: () => {},
  });

  proc.emit('data', 'first');
  proc.emit('exit');

  await new Promise(r => setImmediate(r));

  assert.equal(injectedCalls.length, 1);
  assert.equal(injectedCalls[0].injected, true);
});

// ── timeout path ──────────────────────────────────────────────────────────────

test('timeout fires when no data or exit arrives', async () => {
  const proc = makeProc();
  const logCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-6',
    proc,
    payload: 'p',
    details: DETAILS,
    onSendInput: async () => {},
    onInjected: () => {},
    onAppendLog: (_, msg) => { logCalls.push(msg); },
    hardTimeoutMs: 10,
  });

  await new Promise(r => setTimeout(r, 50));

  assert.ok(logCalls.some(m => m.includes('timeout')));
});

// ── warnings ──────────────────────────────────────────────────────────────────

test('warnings are appended to log message', async () => {
  const proc = makeProc();
  const logCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-7',
    proc,
    payload: 'p',
    details: { hasBoot: false, hasMemory: false, warnings: ['missing boot', 'missing memory'] },
    onSendInput: async () => {},
    onInjected: () => {},
    onAppendLog: (_, msg) => { logCalls.push(msg); },
  });

  proc.emit('data', 'output');

  await new Promise(r => setImmediate(r));

  const logMsg = logCalls.find(m => m.includes('startup injected'));
  assert.ok(logMsg, 'expected a startup injected log message');
  assert.ok(logMsg.includes('missing boot'));
  assert.ok(logMsg.includes('missing memory'));
});

test('no warnings suffix when warnings array is empty', async () => {
  const proc = makeProc();
  const logCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-8',
    proc,
    payload: 'p',
    details: { hasBoot: true, hasMemory: true, warnings: [] },
    onSendInput: async () => {},
    onInjected: () => {},
    onAppendLog: (_, msg) => { logCalls.push(msg); },
  });

  proc.emit('data', 'output');

  await new Promise(r => setImmediate(r));

  const logMsg = logCalls.find(m => m.includes('startup injected'));
  assert.ok(logMsg);
  assert.ok(!logMsg.includes('[warnings:'));
});

// ── onSendInput failure ───────────────────────────────────────────────────────

test('onSendInput rejection is caught and logged', async () => {
  const proc = makeProc();
  const logCalls = [];

  scheduleStartupInjection({
    threadId: 'tid-9',
    proc,
    payload: 'p',
    details: DETAILS,
    onSendInput: async () => { throw new Error('send failed'); },
    onInjected: () => {},
    onAppendLog: (_, msg) => { logCalls.push(msg); },
  });

  proc.emit('data', 'output');

  await new Promise(r => setTimeout(r, 20));

  assert.ok(logCalls.some(m => m.includes('injection failed')));
});

// ── hasBoot / hasMemory forwarded ─────────────────────────────────────────────

test('onInjected receives hasBoot and hasMemory from details', () => {
  const proc = makeProc();
  const injectedStatuses = [];

  scheduleStartupInjection({
    threadId: 'tid-10',
    proc,
    payload: 'p',
    details: { hasBoot: false, hasMemory: true, warnings: [] },
    onSendInput: async () => {},
    onInjected: (_, s) => { injectedStatuses.push(s); },
    onAppendLog: () => {},
  });

  proc.emit('exit');

  assert.equal(injectedStatuses[0].hasBoot, false);
  assert.equal(injectedStatuses[0].hasMemory, true);
});
