/**
 * Tests for runGracefulShutdown logic (inlined from bootstrap/lifecycle.ts).
 * Pure async logic — no Electron dependency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from bootstrap/lifecycle.ts ──────────────────────────────────────

async function runGracefulShutdown(disposables, timeoutMs = 15_000) {
  let timeoutHandle = null;

  const shutdownTask = (async () => {
    for (const d of [...disposables].reverse()) await d.dispose();
    return 'completed';
  })();

  const timeoutTask = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), timeoutMs);
  });

  const result = await Promise.race([shutdownTask, timeoutTask]);
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDisposable(log, label) {
  return {
    dispose: async () => {
      log.push(label);
    },
  };
}

function hangingDisposable() {
  return { dispose: () => new Promise(() => {}) };
}

// ── runGracefulShutdown ───────────────────────────────────────────────────────

test('returns completed when all disposables finish', async () => {
  const result = await runGracefulShutdown([makeDisposable([], 'x')]);
  assert.equal(result, 'completed');
});

test('disposables run in reverse registration order', async () => {
  const log = [];
  await runGracefulShutdown([makeDisposable(log, 'a'), makeDisposable(log, 'b'), makeDisposable(log, 'c')]);
  assert.deepEqual(log, ['c', 'b', 'a']);
});

test('works with empty disposables', async () => {
  const result = await runGracefulShutdown([]);
  assert.equal(result, 'completed');
});

test('returns timed-out when a disposable hangs', async () => {
  const result = await runGracefulShutdown([hangingDisposable()], 50);
  assert.equal(result, 'timed-out');
});
