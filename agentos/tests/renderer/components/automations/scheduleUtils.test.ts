import { test, expect } from 'vitest';
import {
  fromJob,
  toTrigger,
  toSchedule,
  describeTrigger,
  describeSchedule,
  triggerLabel,
  computeNextRun,
  EMPTY_FORM,
} from '../../../../src/renderer/components/automations/scheduleUtils';
import type { AutomationJob, AutomationSchedule } from '../../../../src/shared/types';

function makeJob(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: 'j1',
    name: 'Test Job',
    projectId: 'p1',
    instructions: 'do stuff',
    enabled: true,
    deleteAfterRun: false,
    trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 3_600_000 } },
    ...overrides,
  } as AutomationJob;
}

// ── EMPTY_FORM ────────────────────────────────────────────────────────────────

test('EMPTY_FORM: has expected defaults', () => {
  expect(EMPTY_FORM.triggerKind).toBe('schedule');
  expect(EMPTY_FORM.scheduleKind).toBe('every');
  expect(EMPTY_FORM.everyUnit).toBe('hours');
  expect(EMPTY_FORM.enabled).toBe(true);
});

// ── fromJob ───────────────────────────────────────────────────────────────────

test('fromJob: maps base fields', () => {
  const job = makeJob({ name: 'My Job', projectId: 'proj-99' });
  const form = fromJob(job);
  expect(form.name).toBe('My Job');
  expect(form.projectId).toBe('proj-99');
});

test('fromJob: every-hours schedule', () => {
  const job = makeJob({ trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 2 * 3_600_000 } } });
  const form = fromJob(job);
  expect(form.scheduleKind).toBe('every');
  expect(form.everyValue).toBe(2);
  expect(form.everyUnit).toBe('hours');
});

test('fromJob: every-minutes schedule', () => {
  const job = makeJob({ trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 30 * 60_000 } } });
  const form = fromJob(job);
  expect(form.everyUnit).toBe('minutes');
  expect(form.everyValue).toBe(30);
});

test('fromJob: every-days schedule', () => {
  const job = makeJob({ trigger: { kind: 'schedule', schedule: { kind: 'every', ms: 2 * 86_400_000 } } });
  const form = fromJob(job);
  expect(form.everyUnit).toBe('days');
  expect(form.everyValue).toBe(2);
});

test('fromJob: cron schedule', () => {
  const job = makeJob({ trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * 1-5' } } });
  const form = fromJob(job);
  expect(form.scheduleKind).toBe('cron');
  expect(form.cronExpr).toBe('0 9 * * 1-5');
});

test('fromJob: manual trigger', () => {
  const job = makeJob({ trigger: { kind: 'manual' } });
  const form = fromJob(job);
  expect(form.triggerKind).toBe('manual');
});

// ── toTrigger ─────────────────────────────────────────────────────────────────

test('toTrigger: manual form → manual trigger', () => {
  const form = { ...EMPTY_FORM, triggerKind: 'manual' as const };
  expect(toTrigger(form)).toEqual({ kind: 'manual' });
});

test('toTrigger: schedule form → schedule trigger', () => {
  const form = { ...EMPTY_FORM, triggerKind: 'schedule' as const, scheduleKind: 'cron' as const, cronExpr: '* * * * *' };
  const trigger = toTrigger(form);
  expect(trigger.kind).toBe('schedule');
});

// ── toSchedule ────────────────────────────────────────────────────────────────

test('toSchedule: cron', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'cron' as const, cronExpr: '  0 8 * * *  ' };
  const s = toSchedule(form);
  expect(s.kind).toBe('cron');
  if (s.kind === 'cron') expect(s.expr).toBe('0 8 * * *');
});

test('toSchedule: every hours', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'every' as const, everyValue: 3, everyUnit: 'hours' as const };
  const s = toSchedule(form);
  expect(s.kind).toBe('every');
  if (s.kind === 'every') expect(s.ms).toBe(3 * 3_600_000);
});

test('toSchedule: at ISO', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'at' as const, atIsoLocal: '2026-06-01T09:00' };
  const s = toSchedule(form);
  expect(s.kind).toBe('at');
  if (s.kind === 'at') expect(s.iso.startsWith('2026-06-01')).toBeTruthy();
});

// ── describeSchedule / describeTrigger ────────────────────────────────────────

test('describeSchedule: cron', () => {
  const s: AutomationSchedule = { kind: 'cron', expr: '0 9 * * *' };
  expect(describeSchedule(s)).toBe('Cron: 0 9 * * *');
});

test('describeSchedule: every minutes', () => {
  const s: AutomationSchedule = { kind: 'every', ms: 30 * 60_000 };
  expect(describeSchedule(s).includes('30')).toBeTruthy();
});

test('describeSchedule: every hours', () => {
  const s: AutomationSchedule = { kind: 'every', ms: 2 * 3_600_000 };
  expect(describeSchedule(s).includes('2 hour')).toBeTruthy();
});

test('describeSchedule: every days', () => {
  const s: AutomationSchedule = { kind: 'every', ms: 3 * 86_400_000 };
  expect(describeSchedule(s).includes('3 day')).toBeTruthy();
});

test('describeTrigger: manual', () => {
  expect(describeTrigger({ kind: 'manual' })).toBe('Manual');
});

// ── triggerLabel ──────────────────────────────────────────────────────────────

test('triggerLabel: manual → "Manual"', () => {
  expect(triggerLabel({ ...EMPTY_FORM, triggerKind: 'manual' })).toBe('Manual');
});

test('triggerLabel: cron → includes cron expression', () => {
  const label = triggerLabel({ ...EMPTY_FORM, scheduleKind: 'cron', cronExpr: '0 9 * * *' });
  expect(label.includes('0 9 * * *')).toBeTruthy();
});

test('triggerLabel: every → human description', () => {
  const label = triggerLabel({ ...EMPTY_FORM, scheduleKind: 'every', everyValue: 2, everyUnit: 'hours' });
  expect(label.includes('2')).toBeTruthy();
  expect(label.includes('hours')).toBeTruthy();
});

// ── computeNextRun ────────────────────────────────────────────────────────────

test('computeNextRun: manual → —', () => {
  expect(computeNextRun({ ...EMPTY_FORM, triggerKind: 'manual' })).toBe('—');
});

test('computeNextRun: every with no lastRunAt → "Not yet run"', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'every' as const, everyValue: 1, everyUnit: 'hours' as const };
  expect(computeNextRun(form, undefined)).toBe('Not yet run');
});

test('computeNextRun: at without date → —', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'at' as const, atIsoLocal: '' };
  expect(computeNextRun(form)).toBe('—');
});

test('computeNextRun: at in the past → "In the past"', () => {
  const form = { ...EMPTY_FORM, scheduleKind: 'at' as const, atIsoLocal: '2026-05-23T00:00' };
  expect(computeNextRun(form)).toBe('In the past');
});
