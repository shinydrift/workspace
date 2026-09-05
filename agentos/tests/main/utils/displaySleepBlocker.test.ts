/**
 * Tests for DisplaySleepBlocker in src/main/utils/displaySleepBlocker.ts.
 *
 * Verifies the mode/turn-activity matrix drives a single `prevent-display-sleep` blocker:
 * 'always' holds from construction, 'while-active' follows turn activity, 'off' never holds,
 * and start/stop are idempotent (no duplicate blockers, no stopping one that isn't held).
 *
 * Electron's powerSaveBlocker is mocked via Module._load.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { KeepAwakeMode } from '../../../src/shared/types';
import type { DisplaySleepBlocker as DisplaySleepBlockerType } from '../../../src/main/utils/displaySleepBlocker';

// ── Stateful powerSaveBlocker mock ────────────────────────────────────────────

const started = new Set<number>();
let nextId = 1;
let startCalls: string[] = [];
let stopCalls: number[] = [];

const powerSaveBlockerMock = {
  start: (type: string) => {
    startCalls.push(type);
    const id = nextId++;
    started.add(id);
    return id;
  },
  stop: (id: number) => {
    stopCalls.push(id);
    started.delete(id);
  },
  isStarted: (id: number) => started.has(id),
};

function resetMocks(): void {
  started.clear();
  nextId = 1;
  startCalls = [];
  stopCalls = [];
}

// ── Module._load mock ─────────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { powerSaveBlocker: powerSaveBlockerMock };
  if (request.endsWith('/eventLog')) return { eventLogger: { info: () => {}, warn: () => {}, error: () => {} } };
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DisplaySleepBlocker } = require('../../../src/main/utils/displaySleepBlocker') as {
  DisplaySleepBlocker: new (mode: KeepAwakeMode) => DisplaySleepBlockerType;
};

(Module._load as unknown) = origLoad;

// ── Tests ─────────────────────────────────────────────────────────────────────

test("'always' holds the blocker from construction until disposal", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('always');

  assert.equal(blocker.isHeld(), true);
  assert.deepEqual(startCalls, ['prevent-display-sleep']);

  blocker.dispose();
  assert.equal(blocker.isHeld(), false);
  assert.deepEqual(stopCalls, [1]);
});

test("'off' never holds the blocker, even while a turn runs", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('off');

  assert.equal(blocker.isHeld(), false);
  blocker.setTurnActive(true);
  assert.equal(blocker.isHeld(), false);
  assert.deepEqual(startCalls, []);
});

test("'while-active' follows turn activity", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('while-active');
  assert.equal(blocker.isHeld(), false);

  blocker.setTurnActive(true);
  assert.equal(blocker.isHeld(), true);
  assert.equal(startCalls.length, 1);

  blocker.setTurnActive(false);
  assert.equal(blocker.isHeld(), false);
  assert.equal(stopCalls.length, 1);
});

test('repeated turn:started signals do not stack blockers', () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('while-active');

  blocker.setTurnActive(true);
  blocker.setTurnActive(true);
  blocker.setTurnActive(true);

  assert.equal(startCalls.length, 1);
  assert.equal(started.size, 1);
});

test('stop is not called when nothing is held', () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('while-active');

  blocker.setTurnActive(false);
  blocker.dispose();

  assert.deepEqual(stopCalls, []);
});

test('a live mode change releases a held blocker', () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('always');
  assert.equal(blocker.isHeld(), true);

  blocker.setMode('off');
  assert.equal(blocker.isHeld(), false);
  assert.deepEqual(stopCalls, [1]);
});

test("switching to 'always' mid-idle acquires the blocker immediately", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('off');

  blocker.setMode('always');
  assert.equal(blocker.isHeld(), true);
  assert.deepEqual(startCalls, ['prevent-display-sleep']);
});

test("switching 'always' → 'while-active' during a turn keeps holding", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('always');
  blocker.setTurnActive(true);

  blocker.setMode('while-active');

  assert.equal(blocker.isHeld(), true);
  assert.equal(startCalls.length, 1, 'blocker is re-evaluated, not restarted');
  assert.deepEqual(stopCalls, []);
});

test("switching 'always' → 'while-active' while idle releases", () => {
  resetMocks();
  const blocker = new DisplaySleepBlocker('always');

  blocker.setMode('while-active');

  assert.equal(blocker.isHeld(), false);
  assert.deepEqual(stopCalls, [1]);
});
