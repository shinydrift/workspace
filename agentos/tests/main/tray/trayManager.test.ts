/**
 * Tests for TrayManager lifecycle in src/main/tray/trayManager.ts.
 *
 * Verifies that init() registers handlers, destroy() removes them, and
 * update()/turn:started/turn:ended drive icon-state transitions (start/stop
 * animation).
 *
 * All Electron APIs are mocked via Module._load.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { Thread } from '../../../src/shared/types';
import type { TrayManager as TrayManagerType } from '../../../src/main/tray/trayManager';

// ── Stateful mocks ────────────────────────────────────────────────────────────

const ipcHandlers = new Map<string, Set<unknown>>();
const busHandlers = new Map<string, Set<unknown>>();
const trayImages: unknown[] = [];
let trayDestroyCount = 0;

const mockTray = {
  setToolTip: () => {},
  on: () => mockTray,
  setImage: (img: unknown) => {
    trayImages.push(img);
  },
  destroy: () => {
    trayDestroyCount++;
  },
  getBounds: () => ({ x: 100, y: 0, width: 16, height: 16 }),
};

const MockTray = function (_img: unknown) {
  return mockTray;
};

const ipcMainMock = {
  on: (ch: string, fn: unknown) => {
    if (!ipcHandlers.has(ch)) ipcHandlers.set(ch, new Set());
    ipcHandlers.get(ch)!.add(fn);
  },
  off: (ch: string, fn: unknown) => {
    ipcHandlers.get(ch)?.delete(fn);
  },
};

const internalBusMock = {
  on: (event: string, fn: unknown) => {
    if (!busHandlers.has(event)) busHandlers.set(event, new Set());
    busHandlers.get(event)!.add(fn);
  },
  off: (event: string, fn: unknown) => {
    busHandlers.get(event)?.delete(fn);
  },
};

function resetMocks() {
  ipcHandlers.clear();
  busHandlers.clear();
  trayImages.length = 0;
  trayDestroyCount = 0;
}

// Fake setInterval/clearInterval so animation lifecycle is observable without
// real timers. Each call to setInterval registers a handler; tests can fire it
// manually and inspect liveIntervals.size to assert start/stop.
type IntervalEntry = { fire: () => void; ms: number };
const liveIntervals = new Map<object, IntervalEntry>();
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;

function installFakeIntervals(): void {
  (global as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
    const id = {};
    liveIntervals.set(id, { fire: fn, ms });
    return id;
  };
  (global as unknown as { clearInterval: unknown }).clearInterval = (id: unknown) => {
    if (id && typeof id === 'object') liveIntervals.delete(id as object);
  };
}

function restoreIntervals(): void {
  (global as unknown as { setInterval: unknown }).setInterval = realSetInterval;
  (global as unknown as { clearInterval: unknown }).clearInterval = realClearInterval;
  liveIntervals.clear();
}

// ── Module._load mock ─────────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      BrowserWindow: class {
        loadFile() {}
        loadURL() {}
        once() {}
        on() {}
        show() {}
        close() {}
        isDestroyed() {
          return false;
        }
        isMinimized() {
          return false;
        }
        isVisible() {
          return true;
        }
        restore() {}
        focus() {}
        setPosition() {}
        webContents = { send: () => {} };
      },
      Tray: MockTray,
      app: { quit: () => {} },
      ipcMain: ipcMainMock,
      nativeImage: { createFromBuffer: () => ({ setTemplateImage: () => {} }) },
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      },
    };
  }
  if (request === '../events' || request.endsWith('/events')) {
    return { internalBus: internalBusMock };
  }
  if (request.includes('pngGenerator')) {
    return { makeBlockGridPng: () => Buffer.alloc(4), makeAnimFramePng: () => Buffer.alloc(4) };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TrayManager } = require('../../../src/main/tray/trayManager') as {
  TrayManager: new (
    mainWindow: unknown,
    resolveProjectName: (id: string) => string,
    getThreads: () => Thread[],
    loadPopover: (win: unknown) => void,
    preloadPath: string
  ) => TrayManagerType;
};

(Module._load as unknown) = origLoad;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const mockMainWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  restore: () => {},
  show: () => {},
  focus: () => {},
  webContents: { send: () => {} },
};

function makeTrayManager(getThreads: () => Thread[] = () => []) {
  return new TrayManager(
    mockMainWindow,
    (id) => `Project-${id}`,
    getThreads,
    () => {},
    '/fake/preload.js'
  );
}

// Flush the microtask queued by scheduleUpdate so deferred work runs.
const flush = () => Promise.resolve();

// ── Tests ─────────────────────────────────────────────────────────────────────

test('init: registers FOCUS_THREAD ipcMain handler', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  assert.ok(ipcHandlers.has('tray:focusThread'), 'should register tray:focusThread handler');
  mgr.destroy();
});

test('init: registers OPEN_APP ipcMain handler', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  assert.ok(ipcHandlers.has('tray:openApp'), 'should register tray:openApp handler');
  mgr.destroy();
});

test('init: registers QUIT_APP ipcMain handler', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  assert.ok(ipcHandlers.has('tray:quitApp'), 'should register tray:quitApp handler');
  mgr.destroy();
});

test('init: subscribes to internalBus message:appended', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  assert.ok(busHandlers.has('message:appended'), 'should subscribe to message:appended');
  mgr.destroy();
});

test('init: subscribes to internalBus turn:started and turn:ended', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  assert.ok(busHandlers.has('turn:started'), 'should subscribe to turn:started');
  assert.ok(busHandlers.has('turn:ended'), 'should subscribe to turn:ended');
  mgr.destroy();
});

test('destroy: removes all ipcMain handlers', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  mgr.destroy();
  assert.strictEqual(ipcHandlers.get('tray:focusThread')?.size ?? 0, 0);
  assert.strictEqual(ipcHandlers.get('tray:openApp')?.size ?? 0, 0);
  assert.strictEqual(ipcHandlers.get('tray:quitApp')?.size ?? 0, 0);
});

test('destroy: unsubscribes from internalBus', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  mgr.destroy();
  assert.strictEqual(busHandlers.get('message:appended')?.size ?? 0, 0);
  assert.strictEqual(busHandlers.get('turn:started')?.size ?? 0, 0);
  assert.strictEqual(busHandlers.get('turn:ended')?.size ?? 0, 0);
});

test('destroy: calls tray.destroy', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  const before = trayDestroyCount;
  mgr.destroy();
  assert.strictEqual(trayDestroyCount, before + 1);
});

// Fire a bus event the same way internalBus.emit would dispatch to handlers.
function fireBusEvent(event: string, payload: unknown): void {
  for (const handler of busHandlers.get(event) ?? new Set<unknown>()) {
    (handler as (p: unknown) => void)(payload);
  }
}

test('startup window: a fresh running PTY animates until the first thread:idle', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    const threads = [makeThread({ id: 't1', status: 'running' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'startup window — running PTY without a prior idle must animate');

    fireBusEvent('thread:idle', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 0, 'first thread:idle ends the startup window');

    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('turn:started on a post-startup running thread starts animation; turn:ended stops it', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    const threads = [makeThread({ id: 't1', status: 'running' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    // Move past the startup window first.
    fireBusEvent('thread:idle', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 0, 'precondition: post-startup running thread is idle');

    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'turn:started schedules animation interval');

    const entry = [...liveIntervals.values()][0];
    const imagesBefore = trayImages.length;
    entry.fire();
    entry.fire();
    assert.strictEqual(trayImages.length, imagesBefore + 2, 'each interval tick sets a tray image');

    fireBusEvent('turn:ended', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 0, 'turn:ended clears animation interval');

    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('thread restart re-enters the startup window', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    let threads: Thread[] = [makeThread({ id: 't1', status: 'running' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    fireBusEvent('thread:idle', { threadId: 't1' });
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 0);

    // Stop the thread — pruning must clear the post-first-turn marker so the
    // next start re-enters the startup window.
    threads = [makeThread({ id: 't1', status: 'stopped' as Thread['status'] })];
    mgr.update();
    await flush();

    threads = [makeThread({ id: 't1', status: 'running' })];
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'restarted thread must re-enter the startup window');

    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('turn:ended for a thread with no recorded turn is a no-op', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    const mgr = makeTrayManager(() => [makeThread({ id: 't1', status: 'running' })]);
    mgr.init();
    // Move past the startup window so the running thread isn't animating.
    fireBusEvent('thread:idle', { threadId: 't1' });
    await flush();
    fireBusEvent('turn:ended', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 0);
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('archived thread prunes its in-flight turn marker so animation stops', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    let threads: Thread[] = [makeThread({ id: 't1', status: 'running' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 1);

    // Thread archived without a turn:ended (e.g. process crashed) — applyUpdate
    // must prune the stale marker and stop animating.
    threads = [makeThread({ id: 't1', status: 'archived' as Thread['status'] })];
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 0);

    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('update: building threads animate the tray icon', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    let threads: Thread[] = [makeThread({ status: 'building' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'building thread schedules animation interval');
    threads = [];
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 0);
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('update: coalesces multiple calls in one tick into a single applyUpdate', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    let threads: Thread[] = [];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    threads = [makeThread({ id: 't1', status: 'running' })];
    mgr.update();
    mgr.update();
    mgr.update();
    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    // setInterval should fire exactly once for the coalesced updates.
    assert.strictEqual(liveIntervals.size, 1);
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('destroy: clears in-flight turn markers so a subsequent init starts from idle', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    let threads: Thread[] = [makeThread({ id: 't1', status: 'running' })];
    const mgr = makeTrayManager(() => threads);
    mgr.init();
    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 1);
    mgr.destroy();
    // Re-init with an idle thread: state must have been cleared, no animation.
    threads = [makeThread({ id: 't1', status: 'idle' })];
    mgr.init();
    mgr.update();
    await flush();
    assert.strictEqual(liveIntervals.size, 0);
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('messageAppendedHandler: routes through scheduleUpdate so bursts coalesce', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    const mgr = makeTrayManager(() => [makeThread({ id: 't1', status: 'running' })]);
    mgr.init();
    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'precondition: animation interval is live');
    const handler = [...(busHandlers.get('message:appended') ?? new Set<unknown>())][0] as (payload: unknown) => void;
    assert.ok(typeof handler === 'function', 'message:appended handler should be registered');
    handler({ threadId: 't1', message: { role: 'assistant', content: 'first' } });
    handler({ threadId: 't1', message: { role: 'assistant', content: 'second' } });
    handler({ threadId: 't1', message: { role: 'assistant', content: 'third' } });
    await flush();
    assert.strictEqual(liveIntervals.size, 1, 'should still only have one animation interval');
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('turn:started is idempotent — re-firing for the same thread does not stack intervals', async () => {
  resetMocks();
  installFakeIntervals();
  try {
    const mgr = makeTrayManager(() => [makeThread({ id: 't1', status: 'running' })]);
    mgr.init();
    fireBusEvent('turn:started', { threadId: 't1' });
    fireBusEvent('turn:started', { threadId: 't1' });
    await flush();
    assert.strictEqual(liveIntervals.size, 1);
    mgr.destroy();
  } finally {
    restoreIntervals();
  }
});

test('init: idempotent — double-init registers message:appended listener exactly once', () => {
  resetMocks();
  const mgr = makeTrayManager();
  mgr.init();
  mgr.init();
  assert.strictEqual(busHandlers.get('message:appended')?.size ?? 0, 1);
  mgr.destroy();
});
