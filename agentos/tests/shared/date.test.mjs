/**
 * Tests for shared/utils/date.ts — localDateString (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from shared/utils/date.ts ────────────────────────────────────────

function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('localDateString formats a basic date', () => {
  assert.equal(localDateString(new Date(2026, 4, 23)), '2026-05-23');
});

test('localDateString pads month with leading zero', () => {
  assert.equal(localDateString(new Date(2026, 5, 5)), '2026-06-05');
});

test('localDateString pads day with leading zero', () => {
  assert.equal(localDateString(new Date(2026, 6, 1)), '2026-07-01');
});

test('localDateString handles December 31st', () => {
  assert.equal(localDateString(new Date(2026, 11, 31)), '2026-12-31');
});

test('localDateString handles January 1st', () => {
  assert.equal(localDateString(new Date(2027, 0, 1)), '2027-01-01');
});

test('localDateString returns YYYY-MM-DD format', () => {
  const result = localDateString(new Date(2026, 5, 15));
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});
