/**
 * Tests for automations/scheduler.ts — toCronExpression, describeSchedule.
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from automations/scheduler.ts ────────────────────────────────────

function toCronExpression(schedule) {
  if (schedule.kind === 'cron') return schedule.expr;

  if (schedule.kind === 'every') {
    const ms = Math.floor(schedule.ms);
    if (!Number.isFinite(ms) || ms < 1_000) return null;
    const seconds = Math.floor(ms / 1_000);
    if (seconds <= 59) return `*/${seconds} * * * * *`;
    if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      if (minutes <= 59) return `*/${minutes} * * * *`;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        if (hours <= 23) return `0 */${hours} * * *`;
      }
    }
    return null;
  }

  if (schedule.kind === 'at') {
    const d = new Date(schedule.iso);
    if (!Number.isFinite(d.getTime())) return null;
    return `${d.getSeconds()} ${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
  }

  return null;
}

function describeSchedule(schedule) {
  if (schedule.kind === 'cron') return `Cron: ${schedule.expr}`;
  if (schedule.kind === 'every') {
    const totalMinutes = Math.floor(schedule.ms / 60_000);
    if (totalMinutes < 60) return `Every ${Math.max(totalMinutes, 1)} minute(s)`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `Every ${hours} hour(s)`;
    const days = Math.floor(hours / 24);
    return `Every ${days} day(s)`;
  }
  if (schedule.kind === 'at') return `Once at ${new Date(schedule.iso).toLocaleString()}`;
  return 'Unknown';
}

// ── toCronExpression ──────────────────────────────────────────────────────────

test('toCronExpression: cron kind returns expr unchanged', () => {
  assert.equal(toCronExpression({ kind: 'cron', expr: '0 9 * * 1' }), '0 9 * * 1');
});

test('toCronExpression: every 30 seconds', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 30_000 }), '*/30 * * * * *');
});

test('toCronExpression: every 1 second', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 1_000 }), '*/1 * * * * *');
});

test('toCronExpression: every 59 seconds', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 59_000 }), '*/59 * * * * *');
});

test('toCronExpression: every 5 minutes', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 5 * 60_000 }), '*/5 * * * *');
});

test('toCronExpression: every 1 hour', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 60 * 60_000 }), '0 */1 * * *');
});

test('toCronExpression: every 6 hours', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 6 * 60 * 60_000 }), '0 */6 * * *');
});

test('toCronExpression: every 23 hours', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 23 * 60 * 60_000 }), '0 */23 * * *');
});

test('toCronExpression: every 24 hours returns null (not representable)', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 24 * 60 * 60_000 }), null);
});

test('toCronExpression: every ms < 1000 returns null', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 500 }), null);
});

test('toCronExpression: every ms = 0 returns null', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 0 }), null);
});

test('toCronExpression: every 90s (not divisible to whole minutes) returns null', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: 90_000 }), null);
});

test('toCronExpression: every negative ms returns null', () => {
  assert.equal(toCronExpression({ kind: 'every', ms: -5000 }), null);
});

test('toCronExpression: non-round interval (90 minutes) returns null', () => {
  // 90 minutes is not expressible as a clean cron interval
  assert.equal(toCronExpression({ kind: 'every', ms: 90 * 60_000 }), null);
});

test('toCronExpression: at kind with valid ISO returns 6-part cron string', () => {
  // The function uses local-time getters (getHours etc.), so only check structure,
  // not exact values, to stay timezone-agnostic.
  const iso = new Date('2026-06-15T09:30:00.000Z').toISOString();
  const result = toCronExpression({ kind: 'at', iso });
  assert.ok(typeof result === 'string');
  const parts = result.split(' ');
  assert.equal(parts.length, 6);
  assert.equal(parts[5], '*');
});

test('toCronExpression: at kind with invalid ISO returns null', () => {
  assert.equal(toCronExpression({ kind: 'at', iso: 'not-a-date' }), null);
});

test('toCronExpression: unknown kind returns null', () => {
  assert.equal(toCronExpression({ kind: 'unknown' }), null);
});

// ── describeSchedule ──────────────────────────────────────────────────────────

test('describeSchedule: cron includes expression', () => {
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * 1' }), 'Cron: 0 9 * * 1');
});

test('describeSchedule: every 5 minutes', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 5 * 60_000 }), 'Every 5 minute(s)');
});

test('describeSchedule: every < 1 minute shows 1 minute', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 30_000 }), 'Every 1 minute(s)');
});

test('describeSchedule: every 2 hours', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 2 * 60 * 60_000 }), 'Every 2 hour(s)');
});

test('describeSchedule: every 3 days', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 3 * 24 * 60 * 60_000 }), 'Every 3 day(s)');
});

test('describeSchedule: at kind includes "Once at"', () => {
  const result = describeSchedule({ kind: 'at', iso: new Date().toISOString() });
  assert.ok(result.startsWith('Once at'));
});

test('describeSchedule: unknown kind returns "Unknown"', () => {
  assert.equal(describeSchedule({ kind: 'other' }), 'Unknown');
});
