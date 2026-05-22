/**
 * Tests for pure-logic exports from src/main/tray/trayManager.ts:
 *   deriveIconState        — status precedence + active-thread filtering
 *   buildTrayThreads       — filter, sort, map, lastMessage lookup
 *   computePopoverPosition — anchor + clamp popover within display work area
 *
 * Electron is mocked via Module._load so the module loads in plain Node.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { Thread } from '../../../src/shared/types';
import type {
  deriveIconState as DeriveIconState,
  buildTrayThreads as BuildTrayThreads,
  computePopoverPosition as ComputePopoverPosition,
} from '../../../src/main/tray/trayManager';

// ── Electron + sibling-module mock ──────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      BrowserWindow: class {},
      Tray: class {
        setToolTip() {}
        on() {}
        setImage() {}
        destroy() {}
      },
      app: { quit: () => {} },
      ipcMain: { on: () => {}, off: () => {} },
      nativeImage: { createFromBuffer: () => ({ setTemplateImage: () => {} }) },
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      },
    };
  }
  if (request === '../events' || request.endsWith('/events')) {
    return { internalBus: { on: () => {}, off: () => {} } };
  }
  if (request.includes('pngGenerator')) {
    return { makeBlockGridPng: () => Buffer.alloc(4), makeAnimFramePng: () => Buffer.alloc(4) };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deriveIconState, buildTrayThreads, computePopoverPosition } = require('../../../src/main/tray/trayManager') as {
  deriveIconState: typeof DeriveIconState;
  buildTrayThreads: typeof BuildTrayThreads;
  computePopoverPosition: typeof ComputePopoverPosition;
};

(Module._load as unknown) = origLoad;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    name: 'Thread',
    status: 'idle',
    workingDirectory: '/tmp',
    projectId: 'proj-1',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    autopilot: false,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    autopilotEnabled: false,
    ...overrides,
  } as Thread;
}

// ── deriveIconState ───────────────────────────────────────────────────────────

const NO_TURNS: ReadonlySet<string> = new Set();

// Helper: most tests want the post-startup steady state, so populate
// threadsPostFirstTurn with every thread id under test.
function postFirstTurn(threads: Thread[]): ReadonlySet<string> {
  return new Set(threads.map((t) => t.id));
}

test('deriveIconState: empty threads → idle', () => {
  assert.strictEqual(deriveIconState([], NO_TURNS, NO_TURNS), 'idle');
});

test('deriveIconState: all idle threads → idle', () => {
  const threads = [makeThread({ status: 'idle' }), makeThread({ id: 't2', status: 'idle' })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, postFirstTurn(threads)), 'idle');
});

test('deriveIconState: running thread without an in-flight turn (post-startup) → idle', () => {
  // 'running' is the PTY-alive DB status — not a turn-in-progress signal once the
  // thread has cleared its startup window.
  const threads = [makeThread({ status: 'running' })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, postFirstTurn(threads)), 'idle');
});

test('deriveIconState: running thread in its startup window → running', () => {
  // Before the first turn ends, plain 'running' status is the boot/memory injection
  // window and should keep the tray animating.
  assert.strictEqual(deriveIconState([makeThread({ id: 't1', status: 'running' })], NO_TURNS, NO_TURNS), 'running');
});

test('deriveIconState: running thread with an in-flight turn → running', () => {
  const threads = [makeThread({ id: 't1', status: 'running' })];
  assert.strictEqual(deriveIconState(threads, new Set(['t1']), postFirstTurn(threads)), 'running');
});

test('deriveIconState: idle thread with an in-flight turn → running', () => {
  // Defensive: an in-flight turn marker animates even if the DB-status hasn't caught up.
  const threads = [makeThread({ id: 't1', status: 'idle' })];
  assert.strictEqual(deriveIconState(threads, new Set(['t1']), postFirstTurn(threads)), 'running');
});

test('deriveIconState: one building thread → building', () => {
  assert.strictEqual(deriveIconState([makeThread({ status: 'building' })], NO_TURNS, NO_TURNS), 'building');
});

test('deriveIconState: error thread alone → idle (no dedicated error visual)', () => {
  const threads = [makeThread({ status: 'error' })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, postFirstTurn(threads)), 'idle');
});

test('deriveIconState: in-flight turn takes precedence over building', () => {
  const threads = [makeThread({ id: 'a', status: 'building' }), makeThread({ id: 'b', status: 'running' })];
  assert.strictEqual(deriveIconState(threads, new Set(['b']), postFirstTurn(threads)), 'running');
});

test('deriveIconState: archived threads are excluded', () => {
  const threads = [makeThread({ status: 'archived' as Thread['status'] })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, postFirstTurn(threads)), 'idle');
});

test('deriveIconState: stopped threads are excluded', () => {
  const threads = [makeThread({ status: 'stopped' as Thread['status'] })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, postFirstTurn(threads)), 'idle');
});

test('deriveIconState: archived thread in the turn set is ignored', () => {
  // A stale in-flight marker for an archived thread must not animate the tray.
  const threads = [makeThread({ id: 'a', status: 'archived' as Thread['status'] })];
  assert.strictEqual(deriveIconState(threads, new Set(['a']), postFirstTurn(threads)), 'idle');
});

test('deriveIconState: archived thread in startup window is ignored (no animation)', () => {
  // Even with status 'archived' and no first-turn marker, archived threads
  // must never animate the tray.
  const threads = [makeThread({ id: 'a', status: 'archived' as Thread['status'] })];
  assert.strictEqual(deriveIconState(threads, NO_TURNS, NO_TURNS), 'idle');
});

// ── buildTrayThreads ──────────────────────────────────────────────────────────

test('buildTrayThreads: filters out archived threads', () => {
  const threads = [
    makeThread({ id: 'active', status: 'idle' }),
    makeThread({ id: 'arch', status: 'archived' as Thread['status'] }),
  ];
  const result = buildTrayThreads(threads, () => 'Proj', new Map());
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'active');
});

test('buildTrayThreads: filters out stopped threads', () => {
  const threads = [makeThread({ id: 'stopped', status: 'stopped' as Thread['status'] })];
  assert.strictEqual(buildTrayThreads(threads, () => 'Proj', new Map()).length, 0);
});

test('buildTrayThreads: filters out sub-threads (council members, stage workers)', () => {
  const threads = [
    makeThread({ id: 'parent', status: 'idle' }),
    makeThread({ id: 'council-child', name: 'council/claude-sonnet-4-6', status: 'running', parentThreadId: 'parent' }),
    makeThread({ id: 'stage-child', name: 'stage/exec', status: 'running', parentThreadId: 'parent' }),
  ];
  const result = buildTrayThreads(threads, () => 'Proj', new Map());
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'parent');
});

test('buildTrayThreads: sorts by lastActiveAt descending', () => {
  const now = Date.now();
  const threads = [
    makeThread({ id: 'old', status: 'idle', lastActiveAt: now - 1000 }),
    makeThread({ id: 'new', status: 'idle', lastActiveAt: now }),
  ];
  const result = buildTrayThreads(threads, () => 'Proj', new Map());
  assert.strictEqual(result[0].id, 'new');
  assert.strictEqual(result[1].id, 'old');
});

test('buildTrayThreads: resolves project name', () => {
  const threads = [makeThread({ id: 'a', projectId: 'p1' })];
  const result = buildTrayThreads(threads, (pid) => `Project-${pid}`, new Map());
  assert.strictEqual(result[0].projectName, 'Project-p1');
});

test('buildTrayThreads: uses lastMessage from map', () => {
  const threads = [makeThread({ id: 'a' })];
  const lastMessages = new Map([['a', 'Hello from assistant']]);
  const result = buildTrayThreads(threads, () => 'P', lastMessages);
  assert.strictEqual(result[0].lastMessage, 'Hello from assistant');
});

test('buildTrayThreads: lastMessage defaults to empty string when not in map', () => {
  const threads = [makeThread({ id: 'a' })];
  const result = buildTrayThreads(threads, () => 'P', new Map());
  assert.strictEqual(result[0].lastMessage, '');
});

test('buildTrayThreads: maps thread fields correctly', () => {
  const threads = [makeThread({ id: 'x', name: 'My Thread', status: 'running', autopilotEnabled: true })];
  const result = buildTrayThreads(threads, () => 'Proj', new Map());
  assert.strictEqual(result[0].id, 'x');
  assert.strictEqual(result[0].name, 'My Thread');
  assert.strictEqual(result[0].status, 'running');
  assert.strictEqual(result[0].autopilotEnabled, true);
});

// ── computePopoverPosition ────────────────────────────────────────────────────

const POPOVER = { width: 320, height: 480 };
const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 };
const FALLBACK = { x: 100, y: 100 };

test('computePopoverPosition: centers under tray bounds when tray is in middle of work area', () => {
  const bounds = { x: 700, y: 0, width: 16, height: 16 };
  const pos = computePopoverPosition(bounds, WORK_AREA, POPOVER, FALLBACK);
  assert.strictEqual(pos.x, Math.round(708 - 160));
  assert.strictEqual(pos.y, 20);
});

test('computePopoverPosition: clamps right edge so popover stays inside work area', () => {
  const bounds = { x: 1430, y: 0, width: 16, height: 16 };
  const pos = computePopoverPosition(bounds, WORK_AREA, POPOVER, FALLBACK);
  assert.strictEqual(pos.x, WORK_AREA.width - POPOVER.width);
});

test('computePopoverPosition: clamps left edge so popover stays inside work area', () => {
  const bounds = { x: 0, y: 0, width: 16, height: 16 };
  const pos = computePopoverPosition(bounds, WORK_AREA, POPOVER, FALLBACK);
  assert.strictEqual(pos.x, WORK_AREA.x);
});

test('computePopoverPosition: clamps bottom so popover stays inside work area', () => {
  const bounds = { x: 700, y: 880, width: 16, height: 16 };
  const pos = computePopoverPosition(bounds, WORK_AREA, POPOVER, FALLBACK);
  assert.strictEqual(pos.y, WORK_AREA.height - POPOVER.height);
});

test('computePopoverPosition: uses fallback when tray bounds are zero-sized', () => {
  const bounds = { x: 0, y: 0, width: 0, height: 0 };
  const pos = computePopoverPosition(bounds, WORK_AREA, POPOVER, { x: 500, y: 200 });
  assert.strictEqual(pos.x, 500);
  assert.strictEqual(pos.y, 200);
});

test('computePopoverPosition: uses fallback when tray bounds are undefined', () => {
  const pos = computePopoverPosition(undefined, WORK_AREA, POPOVER, { x: 500, y: 200 });
  assert.strictEqual(pos.x, 500);
  assert.strictEqual(pos.y, 200);
});

test('computePopoverPosition: clamps to a secondary display with non-zero origin', () => {
  const secondary = { x: 1440, y: 0, width: 1920, height: 1080 };
  // Tray bounds near the left edge of the secondary display — anchorX would be
  // negative relative to that display; clamping must use workArea.x as the floor.
  const bounds = { x: 1445, y: 0, width: 16, height: 16 };
  const pos = computePopoverPosition(bounds, secondary, POPOVER, FALLBACK);
  assert.strictEqual(pos.x, secondary.x);
  // Tray bounds near the right edge — clamping must respect workArea.x + width.
  const rightBounds = { x: 1440 + 1900, y: 0, width: 16, height: 16 };
  const rightPos = computePopoverPosition(rightBounds, secondary, POPOVER, FALLBACK);
  assert.strictEqual(rightPos.x, secondary.x + secondary.width - POPOVER.width);
});
