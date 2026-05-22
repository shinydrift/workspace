/**
 * Tests for ipc/handlers/windowHandlers.ts — maximize toggle logic (inlined).
 * No Electron imports needed: the toggle logic is pure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined maximize toggle from windowHandlers.ts ────────────────────────────

function applyMaximizeToggle(win) {
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
}

function makeMockWin(maximized) {
  const calls = [];
  return {
    calls,
    isMaximized: () => maximized,
    maximize: () => calls.push('maximize'),
    unmaximize: () => calls.push('unmaximize'),
  };
}

// ── maximize toggle ───────────────────────────────────────────────────────────

test('maximize toggle: calls unmaximize when already maximized', () => {
  const win = makeMockWin(true);
  applyMaximizeToggle(win);
  assert.deepEqual(win.calls, ['unmaximize']);
});

test('maximize toggle: calls maximize when not maximized', () => {
  const win = makeMockWin(false);
  applyMaximizeToggle(win);
  assert.deepEqual(win.calls, ['maximize']);
});

test('maximize toggle: does nothing when win is null', () => {
  assert.doesNotThrow(() => applyMaximizeToggle(null));
});

test('maximize toggle: does nothing when win is undefined', () => {
  assert.doesNotThrow(() => applyMaximizeToggle(undefined));
});

// ── dialog result logic ───────────────────────────────────────────────────────
// result.canceled ? null : result.filePaths[0]

function pickDialogResult(result) {
  return result.canceled ? null : result.filePaths[0];
}

test('dialog result: returns null when canceled', () => {
  assert.equal(pickDialogResult({ canceled: true, filePaths: [] }), null);
});

test('dialog result: returns first path when not canceled', () => {
  assert.equal(pickDialogResult({ canceled: false, filePaths: ['/home/user/projects'] }), '/home/user/projects');
});

test('dialog result: returns first path when multiple paths returned', () => {
  assert.equal(
    pickDialogResult({ canceled: false, filePaths: ['/home/user/a', '/home/user/b'] }),
    '/home/user/a'
  );
});

// ── isMaximized fallback ──────────────────────────────────────────────────────
// BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false

function safeIsMaximized(win) {
  return win?.isMaximized() ?? false;
}

test('isMaximized: returns true when window is maximized', () => {
  assert.equal(safeIsMaximized({ isMaximized: () => true }), true);
});

test('isMaximized: returns false when window is not maximized', () => {
  assert.equal(safeIsMaximized({ isMaximized: () => false }), false);
});

test('isMaximized: returns false when win is null', () => {
  assert.equal(safeIsMaximized(null), false);
});

test('isMaximized: returns false when win is undefined', () => {
  assert.equal(safeIsMaximized(undefined), false);
});
