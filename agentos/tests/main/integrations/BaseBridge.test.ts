/**
 * Tests for BaseBridge.init() idempotency in src/main/integrations/BaseBridge.ts.
 *
 * Verifies that init() registers the settings listener exactly once on double-call,
 * and that unregisterSettingsListener() cleanly removes it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AppSettings } from '../../../src/shared/types';
import type { BaseBridge as BaseBridgeType } from '../../../src/main/integrations/BaseBridge';

// ── Stateful mock ──────────────────────────────────────────────────────────────

const settingsHandlers = new Map<string, Set<unknown>>();

const settingsEventsMock = {
  on: (event: string, fn: unknown) => {
    if (!settingsHandlers.has(event)) settingsHandlers.set(event, new Set());
    settingsHandlers.get(event)!.add(fn);
  },
  off: (event: string, fn: unknown) => {
    settingsHandlers.get(event)?.delete(fn);
  },
};

function resetMocks() {
  settingsHandlers.clear();
}

// ── Module._load mock ─────────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith('/store/index') || request === '../store/index') {
    return { settingsEvents: settingsEventsMock, getStore: () => ({ get: () => ({}) }) };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BaseBridge } = require('../../../src/main/integrations/BaseBridge') as {
  BaseBridge: new <Deps>() => BaseBridgeType<Deps>;
};

(Module._load as unknown) = origLoad;

// ── Concrete subclass for testing ─────────────────────────────────────────────

type TestDeps = { value: string };

class TestBridge extends (BaseBridge as new <D>() => BaseBridgeType<D>)<TestDeps> {
  applySettings(_settings: AppSettings): void {}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('BaseBridge.init: registers settings change listener', () => {
  resetMocks();
  const bridge = new TestBridge();
  bridge.init({ value: 'a' });
  assert.strictEqual(settingsHandlers.get('change')?.size ?? 0, 1);
});

test('BaseBridge.init: idempotent — double-init registers settings listener exactly once', () => {
  resetMocks();
  const bridge = new TestBridge();
  bridge.init({ value: 'a' });
  bridge.init({ value: 'b' });
  assert.strictEqual(settingsHandlers.get('change')?.size ?? 0, 1);
});

test('BaseBridge.unregisterSettingsListener: removes the listener', () => {
  resetMocks();
  const bridge = new TestBridge();
  bridge.init({ value: 'a' });
  // Access protected method via cast
  (bridge as unknown as { unregisterSettingsListener(): void }).unregisterSettingsListener();
  assert.strictEqual(settingsHandlers.get('change')?.size ?? 0, 0);
});
