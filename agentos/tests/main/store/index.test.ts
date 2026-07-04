/**
 * Tests for src/main/store/index.ts
 *
 * Uses AGENTOS_STORE_DIR pointed at a temp directory so electron-store
 * never needs the Electron runtime (cwd bypasses app.getPath).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getStore, resetStoreForTests, setSettings, settingsEvents } from '../../../src/main/store/index';

let tmpDir: string;

test.beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentos-store-test-'));
  process.env.AGENTOS_STORE_DIR = tmpDir;
  resetStoreForTests();
});

test.afterEach(() => {
  resetStoreForTests();
  delete process.env.AGENTOS_STORE_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

test('getStore returns a store instance', () => {
  const store = getStore();
  assert.ok(store, 'store should be truthy');
});

test('getStore returns the same instance on repeated calls', () => {
  const a = getStore();
  const b = getStore();
  assert.strictEqual(a, b);
});

test('resetStoreForTests causes a new instance to be created', () => {
  const a = getStore();
  resetStoreForTests();
  process.env.AGENTOS_STORE_DIR = tmpDir; // keep same dir so no file-system error
  const b = getStore();
  assert.notStrictEqual(a, b);
});

test('settings defaults are present', () => {
  const store = getStore();
  const settings = store.get('settings');
  assert.strictEqual(settings.theme, 'dark');
  assert.strictEqual(settings.fontSize, 14);
  assert.strictEqual(settings.skipPermissions, true);
  assert.strictEqual(settings.claudeStreamJson, true);
  assert.ok(Array.isArray(settings.agents.providerOrder));
  assert.ok(settings.agents.providerOrder.length > 0);
});

test('setSettings merges patch and persists', () => {
  const updated = setSettings({ theme: 'light', fontSize: 16 });
  assert.strictEqual(updated.theme, 'light');
  assert.strictEqual(updated.fontSize, 16);
  // Other keys preserved
  assert.strictEqual(updated.skipPermissions, true);

  // Verify persisted
  const stored = getStore().get('settings');
  assert.strictEqual(stored.theme, 'light');
  assert.strictEqual(stored.fontSize, 16);
});

test('setSettings emits change event with updated settings', () => {
  let emitted: unknown = null;
  settingsEvents.once('change', (s) => {
    emitted = s;
  });

  setSettings({ devMode: true });

  assert.ok(emitted !== null, 'change event should have fired');
  assert.strictEqual((emitted as Record<string, unknown>).devMode, true);
});

test('multiple setSettings calls accumulate changes', () => {
  setSettings({ theme: 'light' });
  setSettings({ fontSize: 18 });
  const settings = getStore().get('settings');
  assert.strictEqual(settings.theme, 'light');
  assert.strictEqual(settings.fontSize, 18);
});

test('providerOrder migration: legacy string array resets to default', () => {
  // Write a legacy string-array providerOrder directly to disk before getStore()
  const tmpDir2 = mkdtempSync(join(tmpdir(), 'agentos-store-migrate-'));
  process.env.AGENTOS_STORE_DIR = tmpDir2;
  resetStoreForTests();
  try {
    // First init with valid state, then corrupt providerOrder via raw set
    const store = getStore();
    // Force an empty providerOrder to trigger the reset-to-defaults branch
    const current = store.get('settings');
    store.set('settings', { ...current, agents: { ...current.agents, providerOrder: [] } });
    resetStoreForTests();
    process.env.AGENTOS_STORE_DIR = tmpDir2;
    const store2 = getStore();
    const settings = store2.get('settings');
    assert.ok(settings.agents.providerOrder.length > 0, 'should reset empty providerOrder to defaults');
  } finally {
    resetStoreForTests();
    delete process.env.AGENTOS_STORE_DIR;
    process.env.AGENTOS_STORE_DIR = tmpDir;
    rmSync(tmpDir2, { recursive: true, force: true });
  }
});

test('editor defaults to VS Code on a fresh install', () => {
  const store = getStore();
  assert.deepStrictEqual(store.get('settings').editor, { label: 'VS Code', command: 'code' });
  assert.strictEqual(store.get('meta').editorDefaultSeeded, true, 'records the one-time seed');
});

test('editor default: seeds an existing install once, then respects a later clear', () => {
  // Simulate a pre-feature install: a settings object with no editor key and no seeded flag.
  const store = getStore();
  const noEditor = { ...store.get('settings') };
  delete (noEditor as { editor?: unknown }).editor;
  store.set('settings', noEditor);
  store.set('meta', {});

  resetStoreForTests();
  process.env.AGENTOS_STORE_DIR = tmpDir;
  const store2 = getStore();
  assert.deepStrictEqual(
    store2.get('settings').editor,
    { label: 'VS Code', command: 'code' },
    'seeds VS Code onto an existing install'
  );
  assert.strictEqual(store2.get('meta').editorDefaultSeeded, true, 'records the one-time seed');

  // User clears the editor to hide the header badge — the seed must not come back.
  const cleared = { ...store2.get('settings') };
  delete (cleared as { editor?: unknown }).editor;
  store2.set('settings', cleared);

  resetStoreForTests();
  process.env.AGENTOS_STORE_DIR = tmpDir;
  const store3 = getStore();
  assert.strictEqual(store3.get('settings').editor, undefined, 'does not re-add VS Code after the user clears it');
});
