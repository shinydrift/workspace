/**
 * Tests for renderer/components/automations/scheduleUtils.ts
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined types + logic from scheduleUtils.ts ───────────────────────────────

const EMPTY_FORM = {
  name: '',
  description: '',
  projectId: '',
  instructions: '',
  triggerKind: 'schedule',
  scheduleKind: 'every',
  cronExpr: '0 9 * * 1-5',
  everyValue: 1,
  everyUnit: 'hours',
  atIsoLocal: '',
  notificationChannel: 'none',
  notifyOnSuccess: true,
  notifyOnFailure: true,
  notificationSlackChannelId: '',
  enabled: true,
  deleteAfterRun: false,
};

function toSchedule(form) {
  if (form.scheduleKind === 'cron') {
    return { kind: 'cron', expr: form.cronExpr.trim() };
  }
  if (form.scheduleKind === 'at') {
    const dt = form.atIsoLocal ? new Date(form.atIsoLocal) : new Date();
    return { kind: 'at', iso: dt.toISOString() };
  }
  const unitMs = form.everyUnit === 'minutes' ? 60_000 : form.everyUnit === 'hours' ? 3_600_000 : 86_400_000;
  return { kind: 'every', ms: Math.max(1, Math.floor(form.everyValue)) * unitMs };
}

function toTrigger(form) {
  if (form.triggerKind === 'manual') return { kind: 'manual' };
  return { kind: 'schedule', schedule: toSchedule(form) };
}

function describeSchedule(schedule) {
  if (schedule.kind === 'cron') return `Cron: ${schedule.expr}`;
  if (schedule.kind === 'every') {
    const totalMinutes = Math.floor(schedule.ms / 60_000);
    if (totalMinutes < 60) return `Every ${Math.max(totalMinutes, 1)} minute(s)`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `Every ${hours} hour(s)`;
    return `Every ${Math.floor(hours / 24)} day(s)`;
  }
  return `Once at ${new Date(schedule.iso).toLocaleString()}`;
}

function describeTrigger(trigger) {
  if (trigger.kind === 'manual') return 'Manual';
  return describeSchedule(trigger.schedule);
}

function triggerLabel(editing) {
  if (editing.triggerKind === 'manual') return 'Manual';
  if (editing.scheduleKind === 'cron') return `Cron: ${editing.cronExpr}`;
  if (editing.scheduleKind === 'at')
    return editing.atIsoLocal
      ? `Once at ${new Date(editing.atIsoLocal).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : 'Once (not set)';
  return `Every ${editing.everyValue} ${editing.everyUnit}`;
}

function fromJob(job) {
  const base = {
    id: job.id,
    name: job.name,
    description: job.description ?? '',
    projectId: job.projectId,
    instructions: job.instructions,
    notificationChannel: job.notification?.channel ?? 'none',
    notifyOnSuccess: job.notification?.onSuccess ?? true,
    notifyOnFailure: job.notification?.onFailure ?? true,
    notificationSlackChannelId: job.notification?.slackChannelId ?? '',
    enabled: job.enabled,
    deleteAfterRun: job.deleteAfterRun,
    triggerKind: job.trigger.kind,
  };

  if (job.trigger.kind === 'schedule') {
    const { schedule } = job.trigger;
    if (schedule.kind === 'cron') {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'cron', cronExpr: schedule.expr };
    }
    if (schedule.kind === 'at') {
      const d = new Date(schedule.iso);
      const local = Number.isFinite(d.getTime())
        ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
        : '';
      return { ...EMPTY_FORM, ...base, scheduleKind: 'at', atIsoLocal: local };
    }
    const minutes = Math.max(1, Math.floor(schedule.ms / 60_000));
    if (minutes % (60 * 24) === 0) {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes / (60 * 24), everyUnit: 'days' };
    }
    if (minutes % 60 === 0) {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes / 60, everyUnit: 'hours' };
    }
    return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes, everyUnit: 'minutes' };
  }

  return { ...EMPTY_FORM, ...base };
}

// ── toSchedule ────────────────────────────────────────────────────────────────

test('toSchedule: cron kind returns expr trimmed', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'cron', cronExpr: '  0 9 * * 1-5  ' });
  assert.deepEqual(result, { kind: 'cron', expr: '0 9 * * 1-5' });
});

test('toSchedule: at kind returns ISO from atIsoLocal', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: '2026-06-15T10:00' });
  assert.equal(result.kind, 'at');
  assert.match(result.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  const parsed = new Date(result.iso);
  assert.ok(!Number.isNaN(parsed.getTime()));
  assert.equal(parsed.getUTCFullYear(), 2026);
});

test('toSchedule: every minutes', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 5, everyUnit: 'minutes' });
  assert.deepEqual(result, { kind: 'every', ms: 5 * 60_000 });
});

test('toSchedule: every hours', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 2, everyUnit: 'hours' });
  assert.deepEqual(result, { kind: 'every', ms: 2 * 3_600_000 });
});

test('toSchedule: every days', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 1, everyUnit: 'days' });
  assert.deepEqual(result, { kind: 'every', ms: 86_400_000 });
});

test('toSchedule: fractional everyValue floored', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 1.9, everyUnit: 'hours' });
  assert.deepEqual(result, { kind: 'every', ms: 3_600_000 });
});

// ── toTrigger ─────────────────────────────────────────────────────────────────

test('toTrigger: manual', () => {
  const result = toTrigger({ ...EMPTY_FORM, triggerKind: 'manual' });
  assert.deepEqual(result, { kind: 'manual' });
});

test('toTrigger: schedule wraps toSchedule result', () => {
  const result = toTrigger({ ...EMPTY_FORM, triggerKind: 'schedule', scheduleKind: 'cron', cronExpr: '0 * * * *' });
  assert.equal(result.kind, 'schedule');
  assert.deepEqual(result.schedule, { kind: 'cron', expr: '0 * * * *' });
});

// ── describeSchedule / describeTrigger ────────────────────────────────────────

test('describeSchedule: cron', () => {
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * *' }), 'Cron: 0 9 * * *');
});

test('describeSchedule: every minutes', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 5 * 60_000 }), 'Every 5 minute(s)');
});

test('describeSchedule: every hours', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 2 * 3_600_000 }), 'Every 2 hour(s)');
});

test('describeSchedule: every days', () => {
  assert.equal(describeSchedule({ kind: 'every', ms: 2 * 86_400_000 }), 'Every 2 day(s)');
});

test('describeSchedule: at uses toLocaleString', () => {
  const iso = new Date('2026-06-01T10:00:00.000Z').toISOString();
  const result = describeSchedule({ kind: 'at', iso });
  assert.ok(result.startsWith('Once at '));
});

test('describeTrigger: manual', () => {
  assert.equal(describeTrigger({ kind: 'manual' }), 'Manual');
});

test('describeTrigger: schedule delegates to describeSchedule', () => {
  assert.equal(describeTrigger({ kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *' } }), 'Cron: 0 9 * * *');
});

// ── triggerLabel ──────────────────────────────────────────────────────────────

test('triggerLabel: manual', () => {
  assert.equal(triggerLabel({ ...EMPTY_FORM, triggerKind: 'manual' }), 'Manual');
});

test('triggerLabel: cron', () => {
  assert.equal(triggerLabel({ ...EMPTY_FORM, scheduleKind: 'cron', cronExpr: '0 9 * * *' }), 'Cron: 0 9 * * *');
});

test('triggerLabel: at without value shows not-set', () => {
  assert.equal(triggerLabel({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: '' }), 'Once (not set)');
});

test('triggerLabel: every', () => {
  assert.equal(triggerLabel({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 3, everyUnit: 'hours' }), 'Every 3 hours');
});

// ── toSchedule edge cases ─────────────────────────────────────────────────────

test('toSchedule: at with empty atIsoLocal falls back to current time', () => {
  const before = Date.now();
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: '' });
  const after = Date.now();
  assert.equal(result.kind, 'at');
  const parsed = new Date(result.iso).getTime();
  assert.ok(parsed >= before && parsed <= after);
});

test('toSchedule: everyValue 0 is coerced to 1', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 0, everyUnit: 'minutes' });
  assert.deepEqual(result, { kind: 'every', ms: 60_000 });
});

test('toSchedule: everyValue negative is coerced to 1', () => {
  const result = toSchedule({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: -5, everyUnit: 'hours' });
  assert.deepEqual(result, { kind: 'every', ms: 3_600_000 });
});

// ── computeNextRun ────────────────────────────────────────────────────────────

function everyUnitToMs(unit) {
  return unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000;
}

function computeNextRun(editing, job) {
  if (editing.triggerKind === 'manual') return '—';
  if (editing.scheduleKind === 'at') {
    if (!editing.atIsoLocal) return '—';
    const d = new Date(editing.atIsoLocal);
    if (d.getTime() <= Date.now()) return 'In the past';
    return new Date(d.getTime()).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  if (editing.scheduleKind === 'every') {
    if (!job?.lastRunAt) return 'Not yet run';
    const intervalMs = Math.max(1, editing.everyValue) * everyUnitToMs(editing.everyUnit);
    const nextTs = job.lastRunAt + intervalMs;
    if (nextTs <= Date.now()) return 'Pending';
    return new Date(nextTs).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  return triggerLabel(editing);
}

test('computeNextRun: manual trigger returns em-dash', () => {
  assert.equal(computeNextRun({ ...EMPTY_FORM, triggerKind: 'manual' }), '—');
});

test('computeNextRun: at with no atIsoLocal returns em-dash', () => {
  assert.equal(computeNextRun({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: '' }), '—');
});

test('computeNextRun: at with past date returns "In the past"', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 16);
  assert.equal(computeNextRun({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: past }), 'In the past');
});

test('computeNextRun: at with future date returns formatted string', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
  const result = computeNextRun({ ...EMPTY_FORM, scheduleKind: 'at', atIsoLocal: future });
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.notEqual(result, '—');
  assert.notEqual(result, 'In the past');
});

test('computeNextRun: every with no job returns "Not yet run"', () => {
  assert.equal(computeNextRun({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 1, everyUnit: 'hours' }), 'Not yet run');
});

test('computeNextRun: every with job but expired nextTs returns "Pending"', () => {
  const job = { lastRunAt: Date.now() - 2 * 3_600_000 };
  const result = computeNextRun({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 1, everyUnit: 'hours' }, job);
  assert.equal(result, 'Pending');
});

test('computeNextRun: every with future nextTs returns formatted string', () => {
  const job = { lastRunAt: Date.now() };
  const result = computeNextRun({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 2, everyUnit: 'hours' }, job);
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.notEqual(result, 'Pending');
  assert.notEqual(result, 'Not yet run');
});

test('computeNextRun: cron falls through to triggerLabel', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'cron', cronExpr: '0 9 * * *' };
  assert.equal(computeNextRun(form), triggerLabel(form));
});

// ── fromJob ───────────────────────────────────────────────────────────────────

const baseJob = {
  id: 'j1',
  name: 'My Job',
  projectId: 'p1',
  instructions: 'do it',
  enabled: true,
  deleteAfterRun: false,
  trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 3_600_000 } },
};

test('fromJob: every-hours schedule roundtrips', () => {
  const form = fromJob(baseJob);
  assert.equal(form.scheduleKind, 'every');
  assert.equal(form.everyValue, 1);
  assert.equal(form.everyUnit, 'hours');
});

test('fromJob: every-days schedule', () => {
  const form = fromJob({ ...baseJob, trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 86_400_000 } } });
  assert.equal(form.everyUnit, 'days');
  assert.equal(form.everyValue, 1);
});

test('fromJob: cron schedule', () => {
  const form = fromJob({ ...baseJob, trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *' } } });
  assert.equal(form.scheduleKind, 'cron');
  assert.equal(form.cronExpr, '0 9 * * *');
});

test('fromJob: manual trigger', () => {
  const form = fromJob({ ...baseJob, trigger: { kind: 'manual' } });
  assert.equal(form.triggerKind, 'manual');
});

test('fromJob: missing notification defaults to none', () => {
  const form = fromJob(baseJob);
  assert.equal(form.notificationChannel, 'none');
  assert.equal(form.notifyOnSuccess, true);
  assert.equal(form.notifyOnFailure, true);
});

test('fromJob: notification details preserved', () => {
  const job = { ...baseJob, notification: { channel: 'slack', onSuccess: false, onFailure: true, slackChannelId: 'C123' } };
  const form = fromJob(job);
  assert.equal(form.notificationChannel, 'slack');
  assert.equal(form.notifyOnSuccess, false);
  assert.equal(form.notifyOnFailure, true);
  assert.equal(form.notificationSlackChannelId, 'C123');
});

test('fromJob: at schedule with valid iso produces atIsoLocal', () => {
  const iso = '2026-06-15T09:30:00.000Z';
  const form = fromJob({ ...baseJob, trigger: { kind: 'schedule', schedule: { kind: 'at', iso } } });
  assert.equal(form.scheduleKind, 'at');
  assert.ok(form.atIsoLocal.startsWith('2026-06-'));
  assert.ok(form.atIsoLocal.length === 16);
});

test('fromJob: at schedule with invalid iso produces empty atIsoLocal', () => {
  const form = fromJob({ ...baseJob, trigger: { kind: 'schedule', schedule: { kind: 'at', iso: 'not-a-date' } } });
  assert.equal(form.scheduleKind, 'at');
  assert.equal(form.atIsoLocal, '');
});

test('fromJob: every-minutes schedule (non-divisible by 60)', () => {
  const form = fromJob({ ...baseJob, trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 30 * 60_000 } } });
  assert.equal(form.scheduleKind, 'every');
  assert.equal(form.everyUnit, 'minutes');
  assert.equal(form.everyValue, 30);
});

test('fromJob: null description defaults to empty string', () => {
  const form = fromJob({ ...baseJob, description: null });
  assert.equal(form.description, '');
});

test('fromJob: deleteAfterRun preserved', () => {
  const form = fromJob({ ...baseJob, deleteAfterRun: true });
  assert.equal(form.deleteAfterRun, true);
});
