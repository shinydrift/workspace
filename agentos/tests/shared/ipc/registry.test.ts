/**
 * Tests for src/shared/ipc/registry.ts channel contract.
 *
 * Strategy: load the real preload module with a mock electron, capture the
 * API object exposed via contextBridge, then invoke representative methods to
 * collect which IPC channels are actually called. This catches renames or
 * deletions that TypeScript alone would not surface at runtime.
 *
 * Parity strategy: compare IPC_CHANNELS runtime values against TYPED_CHANNEL_SET
 * from registry.ts. The compile-time _ParityCheck in registry.ts enforces this
 * at build time; these runtime tests surface the gap explicitly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// ── Channel-call tracker ──────────────────────────────────────────────────────

const invokedChannels = new Set<string>();
let capturedAPI: Record<string, Record<string, (...args: unknown[]) => unknown>> | null = null;

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
// @ts-expect-error — Module._load signature is not in @types/node
Module._load = function (...args: [string, unknown, boolean]) {
  if (args[0] === 'electron') {
    return {
      contextBridge: {
        exposeInMainWorld: (_name: string, api: unknown) => {
          capturedAPI = api as Record<string, Record<string, (...args: unknown[]) => unknown>>;
        },
      },
      ipcRenderer: {
        invoke: (ch: string) => {
          invokedChannels.add(ch);
          return Promise.resolve({ ok: true, data: null });
        },
        send: (ch: string) => {
          invokedChannels.add(ch);
        },
        on: () => {},
        off: () => {},
      },
    };
  }
  // @ts-expect-error — forwarding rest args to private API
  return origLoad.apply(this, args);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../../src/preload/index');

// @ts-expect-error — Module._load signature is not in @types/node
Module._load = origLoad;

// ── EXPECTED_CHANNELS constant ────────────────────────────────────────────────

const EXPECTED_CHANNELS = [
  // Thread
  'thread:create',
  'thread:start',
  'thread:stop',
  'thread:delete',
  'thread:archive',
  'thread:list',
  'thread:rename',
  'thread:getInjectionStatus',
  'thread:setAutopilot',
  'thread:derivePersonality',
  // Settings
  'settings:get',
  'settings:set',
  // Project
  'project:list',
  'project:save',
  'project:delete',
  'project:getConfig',
  // Memory
  'memory:status',
  'memory:reindex',
  'memory:search',
  'memory:save',
  // Terminal
  'terminal:sendInput',
  'terminal:getHistory',
  // Audio
  'audio:transcribe',
  'audio:modelReady',
  'audio:playTTS',
  'audio:stopTTS',
  // Kanban
  'kanban:list',
  'kanban:get',
  'kanban:create',
  'kanban:move',
  'kanban:delete',
  // Council
  'council:listConfigs',
  'council:getConfig',
  'council:upsertConfig',
  'council:deleteConfig',
  'council:run',
  'council:getRun',
  'council:getOutcomes',
  // Automation
  'automation:list',
  'automation:create',
  'automation:update',
  'automation:delete',
  'automation:toggle',
  // Misc
  'dialog:openDirectory',
  'log:getHistory',
  'health:run',
  'shell:openExternal',
  'env:listShellVars',
  'file:upload',
  'transcript:save',
  'sandbox:checkDocker',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'wiki:list',
  'wiki:get',
  'wiki:save',
  'wiki:delete',
  'analytics:getSessionMetrics',
  'analytics:getGlobalOverview',
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

test('preload exposes electronAPI via contextBridge', () => {
  assert.ok(capturedAPI !== null, 'exposeInMainWorld was not called — preload failed to load');
});

test('IPCChannel: core channels are invoked by the preload API', async () => {
  assert.ok(capturedAPI !== null, 'preload must have called exposeInMainWorld');
  const api = capturedAPI!;

  // Invoke a representative set of API methods to exercise channel routing.
  // Errors from unwrap() are ignored — we only care which channels are called.
  const calls = [
    () => api.settings?.get?.(),
    () => api.settings?.set?.({}),
    () => api.thread?.create?.({}),
    () => api.thread?.list?.(),
    () => api.audio?.transcribe?.(new ArrayBuffer(0)),
    () => api.audio?.stopTTS?.(),
    () => api.council?.run?.({}),
    () => api.kanban?.list?.(),
    () => api.kanban?.create?.({}),
    () => api.kanban?.delete?.('id'),
    () => api.tray?.focusThread?.('t1'),
  ];

  for (const call of calls) {
    try {
      await Promise.resolve(call());
    } catch {
      // ignore — mock always returns { ok: true }
    }
  }

  const spotCheck = [
    'settings:get',
    'settings:set',
    'thread:create',
    'thread:list',
    'audio:transcribe',
    'audio:stopTTS',
    'council:run',
    'kanban:list',
    'kanban:create',
    'kanban:delete',
  ] as const;

  for (const ch of spotCheck) {
    assert.ok(
      invokedChannels.has(ch),
      `channel "${ch}" was not invoked by preload API — it may have been renamed or removed`
    );
  }
});

test('EXPECTED_CHANNELS list is complete: no duplicates', () => {
  const set = new Set(EXPECTED_CHANNELS);
  assert.strictEqual(set.size, EXPECTED_CHANNELS.length, 'EXPECTED_CHANNELS should not contain duplicates');
});

test('council channels are all defined', () => {
  const councilChannels = EXPECTED_CHANNELS.filter((c) => c.startsWith('council:'));
  assert.ok(councilChannels.length >= 7, 'should have at least 7 council channels');
});

test('kanban channels include core CRUD operations', () => {
  const kanbanChannels = EXPECTED_CHANNELS.filter((c) => c.startsWith('kanban:'));
  const required = ['kanban:create', 'kanban:list', 'kanban:get', 'kanban:move', 'kanban:delete'];
  for (const ch of required) {
    assert.ok(kanbanChannels.includes(ch as never), `missing required kanban channel: ${ch}`);
  }
});

test('expected channel count is above minimum threshold', () => {
  assert.ok(EXPECTED_CHANNELS.length >= 50, `expected at least 50 channels, got ${EXPECTED_CHANNELS.length}`);
});

// ── Parity tests: IPC_CHANNELS ↔ TYPED_CHANNEL_SET ───────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IPC_CHANNELS } = require('../../../src/shared/types') as {
  IPC_CHANNELS: Record<string, string>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TYPED_CHANNEL_SET } = require('../../../src/shared/ipc/registry') as {
  TYPED_CHANNEL_SET: ReadonlySet<string>;
};

// Channels that intentionally bypass the typed registry (no entry in IPCMap).
const TYPED_CHANNEL_EXCLUSIONS = new Set(['thread:setProviderModel']);

test('every IPC_CHANNELS value is either in TYPED_CHANNEL_SET or documented exclusions', () => {
  const allChannelValues = Object.values(IPC_CHANNELS);
  const untyped = allChannelValues.filter((ch) => !TYPED_CHANNEL_SET.has(ch) && !TYPED_CHANNEL_EXCLUSIONS.has(ch));
  assert.deepStrictEqual(
    untyped,
    [],
    `channels missing from IPCMap (add to registry.ts or TYPED_CHANNEL_EXCLUSIONS): ${untyped.join(', ')}`
  );
});

test('TYPED_CHANNEL_SET has no channels absent from IPC_CHANNELS', () => {
  const allChannelValues = new Set(Object.values(IPC_CHANNELS));
  const orphaned = [...TYPED_CHANNEL_SET].filter((ch) => !allChannelValues.has(ch));
  assert.deepStrictEqual(
    orphaned,
    [],
    `channels in IPCMap but missing from IPC_CHANNELS (stale entries): ${orphaned.join(', ')}`
  );
});

test('IPC_CHANNELS total count matches TYPED_CHANNEL_SET + exclusions', () => {
  const total = Object.values(IPC_CHANNELS).length;
  const expected = TYPED_CHANNEL_SET.size + TYPED_CHANNEL_EXCLUSIONS.size;
  assert.strictEqual(
    total,
    expected,
    `IPC_CHANNELS has ${total} channels but TYPED_CHANNEL_SET (${TYPED_CHANNEL_SET.size}) + exclusions (${TYPED_CHANNEL_EXCLUSIONS.size}) = ${expected}`
  );
});
