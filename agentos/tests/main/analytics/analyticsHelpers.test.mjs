/**
 * Tests for src/main/analytics/analyticsHelpers.ts
 * safeOpen is a pure error-catching wrapper — inlined to avoid Electron deps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Inlined from analyticsHelpers.ts ─────────────────────────────────────────

function safeOpen(opener) {
  try {
    return opener();
  } catch {
    return null;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('safeOpen returns the opener result on success', () => {
  assert.equal(safeOpen(() => 42), 42);
});

test('safeOpen returns null when the opener throws', () => {
  assert.equal(safeOpen(() => { throw new Error('boom'); }), null);
});

test('safeOpen works with object return values', () => {
  const obj = { key: 'value' };
  assert.deepEqual(safeOpen(() => obj), obj);
});

test('safeOpen calls the opener exactly once', () => {
  let calls = 0;
  safeOpen(() => ++calls);
  assert.equal(calls, 1);
});

test('safeOpen returns null for non-Error throws (strings, etc.)', () => {
  assert.equal(safeOpen(() => { throw 'string error'; }), null);
});

// ── Source shape tests ────────────────────────────────────────────────────────

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const src = readSource('src/main/analytics/analyticsHelpers.ts');

test('safeDb delegates to safeOpen with analytics DB opener', () => {
  assert.match(src, /export function safeDb/);
  assert.match(src, /safeOpen\(getAnalyticsDb/);
});
