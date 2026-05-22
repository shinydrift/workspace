/**
 * Tests for src/main/analytics/providerRateLimitsStore.ts
 * Pure in-memory Map operations — inlined to avoid TS loader requirement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Inlined from providerRateLimitsStore.ts ───────────────────────────────────

function makeStore() {
  const store = new Map();

  function updateProviderRateLimits(provider, windows) {
    store.set(provider, { windows, capturedAt: Date.now() });
  }

  function clearProviderRateLimits(provider) {
    store.delete(provider);
  }

  function getProviderRateLimits() {
    return Object.fromEntries(store);
  }

  return { updateProviderRateLimits, clearProviderRateLimits, getProviderRateLimits };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const WINDOW = { label: '5-hour', usedPercentage: 42, resetsAt: 1000 };

test('getProviderRateLimits returns empty object initially', () => {
  const { getProviderRateLimits } = makeStore();
  assert.deepEqual(getProviderRateLimits(), {});
});

test('updateProviderRateLimits stores windows for a provider', () => {
  const { updateProviderRateLimits, getProviderRateLimits } = makeStore();
  updateProviderRateLimits('claude', [WINDOW]);
  const result = getProviderRateLimits();
  assert.ok(result['claude'], 'claude entry should exist');
  assert.deepEqual(result['claude'].windows, [WINDOW]);
  assert.ok(typeof result['claude'].capturedAt === 'number');
});

test('updateProviderRateLimits overwrites existing entry', () => {
  const { updateProviderRateLimits, getProviderRateLimits } = makeStore();
  const w2 = { label: '7-day', usedPercentage: 10, resetsAt: 2000 };
  updateProviderRateLimits('claude', [WINDOW]);
  updateProviderRateLimits('claude', [w2]);
  assert.deepEqual(getProviderRateLimits()['claude'].windows, [w2]);
});

test('clearProviderRateLimits removes a provider entry', () => {
  const { updateProviderRateLimits, clearProviderRateLimits, getProviderRateLimits } = makeStore();
  updateProviderRateLimits('claude', [WINDOW]);
  clearProviderRateLimits('claude');
  assert.deepEqual(getProviderRateLimits(), {});
});

test('clearProviderRateLimits is a no-op for unknown provider', () => {
  const { clearProviderRateLimits, getProviderRateLimits } = makeStore();
  assert.doesNotThrow(() => clearProviderRateLimits('unknown'));
  assert.deepEqual(getProviderRateLimits(), {});
});

test('multiple providers are tracked independently', () => {
  const { updateProviderRateLimits, getProviderRateLimits } = makeStore();
  const w2 = { label: '7-day', usedPercentage: 5, resetsAt: 3000 };
  updateProviderRateLimits('claude', [WINDOW]);
  updateProviderRateLimits('codex', [w2]);
  const result = getProviderRateLimits();
  assert.deepEqual(result['claude'].windows, [WINDOW]);
  assert.deepEqual(result['codex'].windows, [w2]);
});

test('getProviderRateLimits returns a snapshot (not the live Map)', () => {
  const { updateProviderRateLimits, clearProviderRateLimits, getProviderRateLimits } = makeStore();
  updateProviderRateLimits('claude', [WINDOW]);
  const snapshot = getProviderRateLimits();
  clearProviderRateLimits('claude');
  assert.ok(snapshot['claude'], 'snapshot should not be mutated by later clear');
});

test('capturedAt is set to approximately now', () => {
  const { updateProviderRateLimits, getProviderRateLimits } = makeStore();
  const before = Date.now();
  updateProviderRateLimits('claude', [WINDOW]);
  const after = Date.now();
  const { capturedAt } = getProviderRateLimits()['claude'];
  assert.ok(capturedAt >= before && capturedAt <= after);
});

// ── Source shape test ─────────────────────────────────────────────────────────

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const src = readSource('src/main/analytics/providerRateLimitsStore.ts');

test('production store uses a module-level Map', () => {
  assert.match(src, /const store = new Map/);
});

test('getProviderRateLimits uses Object.fromEntries', () => {
  assert.match(src, /Object\.fromEntries\(store\)/);
});
