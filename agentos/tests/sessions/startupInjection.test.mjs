/**
 * Tests for sessions/startupInjection.ts — scheduleStartupInjection.
 * Uses a mock PtyProcess (EventEmitter) and mock timer control.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── isCliReady stub (simplified) ─────────────────────────────────────────────
// From readySignalDetector.ts: detects provider-specific ready prompts

function isCliReady(provider, tail) {
  if (provider === 'claude') return tail.includes('Human:') || tail.includes('\u276f');
  if (provider === 'gemini') return tail.includes('>>> ') || tail.includes('gemini>');
  if (provider === 'codex') return tail.includes('codex>') || tail.includes('> ');
  return false;
}

// ── Inlined from startupInjection.ts ─────────────────────────────────────────

function scheduleStartupInjection(params) {
  const { threadId, proc, provider, payload, details, onSendInput, onInjected, onAppendLog } = params;
  let injected = false;
  let tail = '';
  const hardTimeoutMs = 2500;

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
        onAppendLog(threadId, `[startup injection failed: ${error instanceof Error ? error.message : String(error)}]`);
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
    if (isCliReady(provider, tail)) {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockProc() {
  return new EventEmitter();
}

function makeParams(overrides = {}) {
  const injected = [];
  const logs = [];
  const inputs = [];
  const proc = makeMockProc();

  return {
    proc,
    injected,
    logs,
    inputs,
    params: {
      threadId: 'thread-1',
      proc,
      provider: 'claude',
      payload: 'boot context',
      details: { hasBoot: true, hasMemory: true, warnings: [] },
      onSendInput: async (tid, input) => { inputs.push(input); },
      onInjected: (tid, status) => { injected.push(status); },
      onAppendLog: (tid, msg) => { logs.push(msg); },
      ...overrides,
    },
  };
}

// ── first-output path ─────────────────────────────────────────────────────────

test('injects via first-output when proc emits data', async () => {
  const { proc, injected, params } = makeParams();
  scheduleStartupInjection(params);
  proc.emit('data', 'some output');
  // Wait for async onSendInput
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(injected.length, 1);
  assert.equal(injected[0].injected, true);
  assert.equal(injected[0].hasBoot, true);
});

test('does not inject twice on multiple data events', async () => {
  const { proc, injected, params } = makeParams();
  scheduleStartupInjection(params);
  proc.emit('data', 'output 1');
  proc.emit('data', 'output 2');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(injected.length, 1);
});

test('payload is sent with newline appended', async () => {
  const { proc, inputs, params } = makeParams();
  scheduleStartupInjection(params);
  proc.emit('data', 'some output');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(inputs.length > 0);
  assert.ok(inputs[0].endsWith('\n'));
});

// ── ready-signal path ─────────────────────────────────────────────────────────

test('injects via ready-signal when claude Human: prompt detected', async () => {
  const { proc, logs, params } = makeParams({ provider: 'claude' });
  scheduleStartupInjection(params);
  proc.emit('data', 'Welcome\nHuman:');
  await new Promise((r) => setTimeout(r, 10));
  const log = logs.find((l) => l.includes('ready-signal'));
  assert.ok(log, 'expected ready-signal log');
});

test('injects via ready-signal for gemini >>> prompt', async () => {
  const { proc, logs, params } = makeParams({ provider: 'gemini' });
  scheduleStartupInjection(params);
  proc.emit('data', '>>> ');
  await new Promise((r) => setTimeout(r, 10));
  const log = logs.find((l) => l.includes('ready-signal'));
  assert.ok(log, 'expected ready-signal log for gemini');
});

// ── exit path ─────────────────────────────────────────────────────────────────

test('marks injection failed when process exits before data', () => {
  const { proc, injected, params } = makeParams();
  scheduleStartupInjection(params);
  proc.emit('exit');
  assert.equal(injected.length, 1);
  assert.equal(injected[0].injected, false);
  assert.ok(injected[0].error?.includes('exited'));
});

test('exit after injection does not double-inject', async () => {
  const { proc, injected, params } = makeParams();
  scheduleStartupInjection(params);
  proc.emit('data', 'output');
  await new Promise((r) => setTimeout(r, 10));
  proc.emit('exit');
  assert.equal(injected.length, 1);
});

// ── warnings ─────────────────────────────────────────────────────────────────

test('log message includes warnings when present', async () => {
  const { proc, logs, params } = makeParams({
    details: { hasBoot: true, hasMemory: false, warnings: ['missing boot file'] },
  });
  scheduleStartupInjection(params);
  proc.emit('data', 'output');
  await new Promise((r) => setTimeout(r, 10));
  const warnLog = logs.find((l) => l.includes('missing boot file'));
  assert.ok(warnLog, 'expected warnings in log');
});

test('log message has no warnings suffix when empty', async () => {
  const { proc, logs, params } = makeParams({
    details: { hasBoot: true, hasMemory: true, warnings: [] },
  });
  scheduleStartupInjection(params);
  proc.emit('data', 'output');
  await new Promise((r) => setTimeout(r, 10));
  const warnLog = logs.find((l) => l.includes('[warnings'));
  assert.ok(!warnLog, 'no warnings suffix expected');
});

// ── injection failure ─────────────────────────────────────────────────────────

test('logs injection failure when onSendInput rejects', async () => {
  const { proc, logs } = makeParams();
  const params = {
    threadId: 'thread-2',
    proc,
    provider: 'claude',
    payload: 'boot',
    details: { hasBoot: true, hasMemory: true, warnings: [] },
    onSendInput: async () => { throw new Error('send failed'); },
    onInjected: () => {},
    onAppendLog: (tid, msg) => { logs.push(msg); },
  };
  scheduleStartupInjection(params);
  proc.emit('data', 'output');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(logs.some((l) => l.includes('injection failed')));
});
