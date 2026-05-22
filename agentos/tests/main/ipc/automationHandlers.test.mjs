/**
 * Tests for ipc/handlers/automationHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from automationHandlers.ts ────────────────────────────

const NOTIFICATION_CHANNELS = ['slack'];
const MAX_MS = 365 * 24 * 60 * 60 * 1000;

function validateSchedule(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.kind === 'cron') return typeof s.expr === 'string' && s.expr.length >= 1 && s.expr.length <= 128;
  if (s.kind === 'every') {
    return Number.isInteger(s.ms) && s.ms > 0 && s.ms <= MAX_MS;
  }
  if (s.kind === 'at') return typeof s.iso === 'string' && s.iso.length >= 1 && s.iso.length <= 64;
  return false;
}

function validateTrigger(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.kind === 'manual') return true;
  if (t.kind === 'schedule') return validateSchedule(t.schedule);
  return false;
}

function validateNotification(n) {
  if (!n || typeof n !== 'object') return false;
  if (!NOTIFICATION_CHANNELS.includes(n.channel)) return false;
  if (typeof n.onSuccess !== 'boolean' || typeof n.onFailure !== 'boolean') return false;
  if (n.slackChannelId !== undefined && (typeof n.slackChannelId !== 'string' || n.slackChannelId.length > 128)) return false;
  return true;
}

function validateCreate(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 256) return false;
  if (typeof req.instructions !== 'string' || req.instructions.length < 1 || req.instructions.length > 100_000) return false;
  if (typeof req.projectId !== 'string' || req.projectId.length < 1 || req.projectId.length > 128) return false;
  if (!validateTrigger(req.trigger)) return false;
  return true;
}

// ── AutomationScheduleSchema ──────────────────────────────────────────────────

test('schedule: cron — valid expr', () => {
  assert.ok(validateSchedule({ kind: 'cron', expr: '0 * * * *' }));
});

test('schedule: cron — rejects empty expr', () => {
  assert.ok(!validateSchedule({ kind: 'cron', expr: '' }));
});

test('schedule: cron — rejects expr over 128 chars', () => {
  assert.ok(!validateSchedule({ kind: 'cron', expr: 'x'.repeat(129) }));
});

test('schedule: cron — accepts 128-char expr', () => {
  assert.ok(validateSchedule({ kind: 'cron', expr: 'x'.repeat(128) }));
});

test('schedule: every — valid ms', () => {
  assert.ok(validateSchedule({ kind: 'every', ms: 60_000 }));
});

test('schedule: every — rejects zero ms', () => {
  assert.ok(!validateSchedule({ kind: 'every', ms: 0 }));
});

test('schedule: every — rejects negative ms', () => {
  assert.ok(!validateSchedule({ kind: 'every', ms: -1 }));
});

test('schedule: every — rejects non-integer ms', () => {
  assert.ok(!validateSchedule({ kind: 'every', ms: 1.5 }));
});

test('schedule: every — accepts max allowed ms (365 days)', () => {
  assert.ok(validateSchedule({ kind: 'every', ms: MAX_MS }));
});

test('schedule: every — rejects ms over 365 days', () => {
  assert.ok(!validateSchedule({ kind: 'every', ms: MAX_MS + 1 }));
});

test('schedule: at — valid iso', () => {
  assert.ok(validateSchedule({ kind: 'at', iso: '2026-12-31T23:59:00Z' }));
});

test('schedule: at — rejects empty iso', () => {
  assert.ok(!validateSchedule({ kind: 'at', iso: '' }));
});

test('schedule: at — rejects iso over 64 chars', () => {
  assert.ok(!validateSchedule({ kind: 'at', iso: 'x'.repeat(65) }));
});

test('schedule: rejects unknown kind', () => {
  assert.ok(!validateSchedule({ kind: 'weekly' }));
});

test('schedule: rejects null', () => {
  assert.ok(!validateSchedule(null));
});

// ── AutomationTriggerSchema ───────────────────────────────────────────────────

test('trigger: manual is valid', () => {
  assert.ok(validateTrigger({ kind: 'manual' }));
});

test('trigger: schedule with valid cron schedule', () => {
  assert.ok(validateTrigger({ kind: 'schedule', schedule: { kind: 'cron', expr: '0 8 * * *' } }));
});

test('trigger: schedule with valid every schedule', () => {
  assert.ok(validateTrigger({ kind: 'schedule', schedule: { kind: 'every', ms: 3_600_000 } }));
});

test('trigger: schedule with invalid schedule is rejected', () => {
  assert.ok(!validateTrigger({ kind: 'schedule', schedule: { kind: 'cron', expr: '' } }));
});

test('trigger: rejects unknown kind', () => {
  assert.ok(!validateTrigger({ kind: 'webhook' }));
});

test('trigger: rejects null', () => {
  assert.ok(!validateTrigger(null));
});

// ── AutomationNotificationSchema ──────────────────────────────────────────────

test('notification: slack with required fields', () => {
  assert.ok(validateNotification({ channel: 'slack', onSuccess: true, onFailure: false }));
});

test('notification: rejects unknown channel', () => {
  assert.ok(!validateNotification({ channel: 'email', onSuccess: true, onFailure: false }));
});

test('notification: rejects missing onSuccess', () => {
  assert.ok(!validateNotification({ channel: 'slack', onFailure: false }));
});

test('notification: rejects slackChannelId over 128 chars', () => {
  assert.ok(!validateNotification({ channel: 'slack', onSuccess: true, onFailure: false, slackChannelId: 'x'.repeat(129) }));
});

test('notification: accepts slackChannelId at 128 chars', () => {
  assert.ok(validateNotification({ channel: 'slack', onSuccess: true, onFailure: false, slackChannelId: 'x'.repeat(128) }));
});

// ── AutomationCreateSchema ────────────────────────────────────────────────────

test('create: valid minimal automation', () => {
  assert.ok(validateCreate({
    name: 'Daily report',
    projectId: 'proj-001',
    trigger: { kind: 'manual' },
    instructions: 'Run the daily report script',
  }));
});

test('create: rejects empty name', () => {
  assert.ok(!validateCreate({
    name: '',
    projectId: 'proj-001',
    trigger: { kind: 'manual' },
    instructions: 'Do something',
  }));
});

test('create: rejects name over 256 chars', () => {
  assert.ok(!validateCreate({
    name: 'x'.repeat(257),
    projectId: 'proj-001',
    trigger: { kind: 'manual' },
    instructions: 'Do something',
  }));
});

test('create: rejects empty instructions', () => {
  assert.ok(!validateCreate({
    name: 'My automation',
    projectId: 'proj-001',
    trigger: { kind: 'manual' },
    instructions: '',
  }));
});

test('create: rejects instructions over 100000 chars', () => {
  assert.ok(!validateCreate({
    name: 'My automation',
    projectId: 'proj-001',
    trigger: { kind: 'manual' },
    instructions: 'x'.repeat(100_001),
  }));
});

test('create: rejects invalid trigger', () => {
  assert.ok(!validateCreate({
    name: 'My automation',
    projectId: 'proj-001',
    trigger: { kind: 'bad' },
    instructions: 'Do something',
  }));
});

test('create: rejects empty projectId', () => {
  assert.ok(!validateCreate({
    name: 'My automation',
    projectId: '',
    trigger: { kind: 'manual' },
    instructions: 'Do something',
  }));
});
