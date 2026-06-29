/**
 * Tests for src/preload/index.ts
 *
 * Mocks contextBridge and ipcRenderer before importing the preload module
 * so we can assert the API shape and channel behaviour without Electron.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Mock 'electron' before the preload module is imported ─────────────────────
import Module from 'node:module';

const capturedExposeArgs: { name: string; api: Record<string, unknown> }[] = [];
const capturedInvokeChannels: string[] = [];
const capturedSendChannels: string[] = [];
const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

const mockIpcRenderer = {
  invoke: (channel: string, ..._args: unknown[]) => {
    capturedInvokeChannels.push(channel);
    return Promise.resolve({ ok: true, data: undefined });
  },
  send: (channel: string, ..._args: unknown[]) => {
    capturedSendChannels.push(channel);
  },
  on: (channel: string, handler: (...args: unknown[]) => void) => {
    if (!handlers[channel]) handlers[channel] = [];
    handlers[channel].push(handler);
  },
  off: (channel: string, handler: (...args: unknown[]) => void) => {
    if (handlers[channel]) {
      handlers[channel] = handlers[channel].filter((h) => h !== handler);
    }
  },
  setMaxListeners: (_n: number) => {},
};

const mockContextBridge = {
  exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
    capturedExposeArgs.push({ name, api });
  },
};

const electronMock = { contextBridge: mockContextBridge, ipcRenderer: mockIpcRenderer };

// @ts-expect-error — private Node API
const originalLoad = Module._load;
// @ts-expect-error — Module._load signature is not in @types/node
Module._load = function (...args: [string, unknown, boolean]) {
  if (args[0] === 'electron') return electronMock;
  // @ts-expect-error — forwarding rest args to private API
  return originalLoad.apply(this, args);
};

// Load preload synchronously via tsx-transpiled require
// tsx in CJS mode: use require() directly
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/preload/index');

// Restore the hook
// @ts-expect-error — Module._load signature is not in @types/node
Module._load = originalLoad;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAPI(): Record<string, unknown> {
  assert.ok(capturedExposeArgs.length > 0, 'contextBridge.exposeInMainWorld should have been called');
  return capturedExposeArgs[0].api;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('exposeInMainWorld is called with name "electronAPI"', () => {
  assert.strictEqual(capturedExposeArgs[0].name, 'electronAPI');
});

test('api has expected top-level namespaces', () => {
  const api = getAPI();
  const expected = [
    'thread', 'memory', 'terminal', 'settings', 'project', 'slack',
    'automation', 'messages', 'dialog', 'sandbox', 'log', 'health',
    'audio', 'win', 'wiki', 'shell', 'env', 'files', 'desktopCapturer',
    'analytics', 'kanban', 'council', 'tray', 'on', 'platform',
  ];
  for (const key of expected) {
    assert.ok(key in api, `api should have namespace "${key}"`);
  }
});

test('settings.get invokes settings:get channel', async () => {
  const api = getAPI();
  const settings = api.settings as { get: () => Promise<unknown>; set: (p: unknown) => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await settings.get();
  assert.ok(capturedInvokeChannels.includes('settings:get'));
});

test('settings.set invokes settings:set channel', async () => {
  const api = getAPI();
  const settings = api.settings as { get: () => Promise<unknown>; set: (p: unknown) => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await settings.set({ theme: 'light' });
  assert.ok(capturedInvokeChannels.includes('settings:set'));
});

test('thread.create invokes thread:create channel', async () => {
  const api = getAPI();
  const thread = api.thread as { create: (r: unknown) => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await thread.create({ workingDirectory: '/tmp', name: 'test' });
  assert.ok(capturedInvokeChannels.includes('thread:create'));
});

test('thread.list invokes thread:list channel', async () => {
  const api = getAPI();
  const thread = api.thread as { list: () => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await thread.list();
  assert.ok(capturedInvokeChannels.includes('thread:list'));
});

test('audio.transcribe invokes audio:transcribe channel', async () => {
  const api = getAPI();
  const audio = api.audio as { transcribe: (b: ArrayBuffer) => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await audio.transcribe(new ArrayBuffer(8));
  assert.ok(capturedInvokeChannels.includes('audio:transcribe'));
});

test('audio.stopTTS invokes audio:stopTTS channel', async () => {
  const api = getAPI();
  const audio = api.audio as { stopTTS: () => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await audio.stopTTS();
  assert.ok(capturedInvokeChannels.includes('audio:stopTTS'));
});

test('tray.focusThread sends on a tray channel', () => {
  const api = getAPI();
  const tray = api.tray as { focusThread: (id: string) => void };
  capturedSendChannels.length = 0;
  tray.focusThread('thread-1');
  assert.ok(capturedSendChannels.length > 0, 'should send on a tray channel');
});

test('on.threadStatus returns an unsubscribe function', () => {
  const api = getAPI();
  const on = api.on as { threadStatus: (cb: unknown) => () => void };
  const unsub = on.threadStatus(() => {});
  assert.strictEqual(typeof unsub, 'function');
});

test('on.threadStatus unsubscribe removes the handler', () => {
  const api = getAPI();
  const on = api.on as { threadStatus: (cb: (e: unknown) => void) => () => void };
  const handlerCountBefore = Object.values(handlers).flat().length;
  const unsub = on.threadStatus(() => {});
  unsub();
  const handlerCountAfter = Object.values(handlers).flat().length;
  assert.strictEqual(handlerCountAfter, handlerCountBefore, 'unsubscribe should remove the handler');
});

test('council.run invokes council:run channel', async () => {
  const api = getAPI();
  const council = api.council as { run: (c: string, p: string, pr: string) => Promise<unknown> };
  capturedInvokeChannels.length = 0;
  await council.run('cfg-1', 'parent-1', 'prompt');
  assert.ok(capturedInvokeChannels.includes('council:run'));
});

test('platform is a string', () => {
  const api = getAPI();
  assert.strictEqual(typeof api.platform, 'string');
});
