import { test, expect } from 'vitest';
import { statusColors, threadStatusDot } from '../../../src/renderer/lib/status-colors';

// ── statusColors ──────────────────────────────────────────────────────────────

test('statusColors: has success, warning, error, idle keys', () => {
  expect('success' in statusColors).toBeTruthy();
  expect('warning' in statusColors).toBeTruthy();
  expect('error' in statusColors).toBeTruthy();
  expect('idle' in statusColors).toBeTruthy();
});

test('statusColors: each key has dot, badge, text properties', () => {
  for (const key of Object.keys(statusColors) as (keyof typeof statusColors)[]) {
    expect(typeof statusColors[key].dot).toBe('string');
    expect(typeof statusColors[key].badge).toBe('string');
    expect(typeof statusColors[key].text).toBe('string');
  }
});

// ── threadStatusDot ───────────────────────────────────────────────────────────

test('threadStatusDot: has entry for every ThreadStatus', () => {
  const expectedStatuses = ['running', 'building', 'idle', 'error', 'stopped', 'archived'] as const;
  for (const s of expectedStatuses) {
    expect(s in threadStatusDot).toBeTruthy();
    expect(typeof threadStatusDot[s]).toBe('string');
  }
});

test('threadStatusDot: values are non-empty strings', () => {
  for (const val of Object.values(threadStatusDot)) {
    expect((val as string).length > 0).toBeTruthy();
  }
});

test('statusColors.success: uses success token', () => {
  expect(statusColors.success.dot.includes('success')).toBeTruthy();
  expect(statusColors.success.badge.includes('success')).toBeTruthy();
  expect(statusColors.success.text.includes('success')).toBeTruthy();
});

test('statusColors.error: uses error token', () => {
  expect(statusColors.error.dot.includes('error')).toBeTruthy();
  expect(statusColors.error.badge.includes('error')).toBeTruthy();
  expect(statusColors.error.text.includes('error')).toBeTruthy();
});

test('threadStatusDot: all values are border-* classes', () => {
  for (const [status, cls] of Object.entries(threadStatusDot)) {
    expect((cls as string).startsWith('border-')).toBeTruthy();
    void status;
  }
});

test('threadStatusDot: running uses success token (active)', () => {
  expect(threadStatusDot.running.includes('success')).toBeTruthy();
});

test('threadStatusDot: stopped and archived share same class', () => {
  expect(threadStatusDot.stopped).toBe(threadStatusDot.archived);
});
