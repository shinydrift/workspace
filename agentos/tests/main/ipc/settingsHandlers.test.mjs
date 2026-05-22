/**
 * Tests for ipc/handlers/settingsHandlers.ts — SettingsPatchSchema validation (inlined).
 * Schema: z.record(z.string(), z.unknown()) — accepts any object with string keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined validation from settingsHandlers.ts ───────────────────────────────
// z.record(z.string(), z.unknown()) accepts plain objects, rejects non-objects.

function validateSettingsPatch(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw !== 'object') return false;
  if (Array.isArray(raw)) return false;
  return true;
}

// ── valid patches ─────────────────────────────────────────────────────────────

test('SettingsPatchSchema: accepts empty object', () => {
  assert.ok(validateSettingsPatch({}));
});

test('SettingsPatchSchema: accepts object with string value', () => {
  assert.ok(validateSettingsPatch({ theme: 'dark' }));
});

test('SettingsPatchSchema: accepts object with numeric value', () => {
  assert.ok(validateSettingsPatch({ fontSize: 14 }));
});

test('SettingsPatchSchema: accepts object with boolean value', () => {
  assert.ok(validateSettingsPatch({ autoSave: true }));
});

test('SettingsPatchSchema: accepts object with null value (unknown allows null)', () => {
  assert.ok(validateSettingsPatch({ key: null }));
});

test('SettingsPatchSchema: accepts object with nested object value', () => {
  assert.ok(validateSettingsPatch({ nested: { a: 1 } }));
});

test('SettingsPatchSchema: accepts multiple keys', () => {
  assert.ok(validateSettingsPatch({ theme: 'light', fontSize: 12, sidebar: true }));
});

// ── invalid patches ───────────────────────────────────────────────────────────

test('SettingsPatchSchema: rejects null', () => {
  assert.ok(!validateSettingsPatch(null));
});

test('SettingsPatchSchema: rejects undefined', () => {
  assert.ok(!validateSettingsPatch(undefined));
});

test('SettingsPatchSchema: rejects string', () => {
  assert.ok(!validateSettingsPatch('dark'));
});

test('SettingsPatchSchema: rejects number', () => {
  assert.ok(!validateSettingsPatch(42));
});

test('SettingsPatchSchema: rejects boolean', () => {
  assert.ok(!validateSettingsPatch(true));
});

test('SettingsPatchSchema: rejects array', () => {
  assert.ok(!validateSettingsPatch(['theme', 'dark']));
});

test('SettingsPatchSchema: rejects array of objects', () => {
  assert.ok(!validateSettingsPatch([{ theme: 'dark' }]));
});
