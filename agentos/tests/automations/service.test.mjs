/**
 * Regression tests for automations/service.ts — pure logic extracted from AutomationService.
 *
 * Known bug documented here:
 *   executeJob() catches errors from executeRun() but does NOT rethrow, so runNow() always
 *   returns { ok: true } even when the underlying run fails. The catch block in runNow() is
 *   dead code. See the maintainability review notes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined core logic from service.ts ───────────────────────────────────────

/**
 * Mirrors the real executeJob — catches all errors and never rethrows.
 * This is the buggy implementation.
 */
async function executeJob_buggy(executeRun) {
  try {
    await executeRun();
    // mark run ok (side effect omitted)
  } catch {
    // catches and swallows — never rethrows
    // mark run error (side effect omitted)
  }
}

/**
 * Mirrors the real runNow — its catch block is dead because executeJob never throws.
 */
async function runNow_buggy(executeRun) {
  try {
    await executeJob_buggy(executeRun);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * What executeJob SHOULD look like — rethrows after logging/marking.
 */
async function executeJob_correct(executeRun) {
  try {
    await executeRun();
  } catch (error) {
    // mark run error...
    throw error; // propagate so runNow can report failure
  }
}

async function runNow_correct(executeRun) {
  try {
    await executeJob_correct(executeRun);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ── Bug demonstration — these tests document current (broken) behavior ────────

test('[bug] runNow returns ok:true even when executeRun throws', async () => {
  const failingRun = async () => {
    throw new Error('run failed');
  };
  const result = await runNow_buggy(failingRun);
  // BUG: this passes because executeJob swallows the error
  assert.equal(result.ok, true, 'bug: ok is true despite failure');
  assert.equal(result.error, undefined, 'bug: no error is surfaced');
});

test('[bug] runNow catch block is unreachable', async () => {
  let catchReached = false;
  const failingRun = async () => {
    throw new Error('boom');
  };
  try {
    await executeJob_buggy(failingRun);
  } catch {
    catchReached = true;
  }
  assert.equal(catchReached, false, 'bug: executeJob never rethrows');
});

// ── Correct behavior — these tests specify what SHOULD happen after the fix ──

test('[correct] runNow should return ok:false when executeRun throws', async () => {
  const failingRun = async () => {
    throw new Error('run failed');
  };
  const result = await runNow_correct(failingRun);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'run failed');
});

test('[correct] runNow should return ok:true when executeRun succeeds', async () => {
  const successRun = async () => {
    /* noop */
  };
  const result = await runNow_correct(successRun);
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
});

// ── markRun logic (pure, inlined) ────────────────────────────────────────────

function markRun(existing, status, error, trigger = 'schedule') {
  const record = { at: Date.now(), status, trigger, ...(error ? { error } : {}) };
  const history = [...(existing.runHistory ?? []), record].slice(-50);
  return {
    ...existing,
    lastRunStatus: status,
    lastRunError: error,
    runCountOk: status === 'ok' ? (existing.runCountOk ?? 0) + 1 : (existing.runCountOk ?? 0),
    runCountError: status === 'error' ? (existing.runCountError ?? 0) + 1 : (existing.runCountError ?? 0),
    runHistory: history,
  };
}

test('markRun increments runCountOk on ok status', () => {
  const job = { runCountOk: 2, runCountError: 1 };
  const updated = markRun(job, 'ok');
  assert.equal(updated.runCountOk, 3);
  assert.equal(updated.runCountError, 1);
});

test('markRun increments runCountError on error status', () => {
  const job = { runCountOk: 0, runCountError: 0 };
  const updated = markRun(job, 'error', 'boom');
  assert.equal(updated.runCountError, 1);
  assert.equal(updated.lastRunError, 'boom');
  assert.equal(updated.lastRunStatus, 'error');
});

test('markRun keeps at most 50 history entries', () => {
  const job = { runHistory: Array.from({ length: 50 }, (_, i) => ({ at: i, status: 'ok', trigger: 'schedule' })) };
  const updated = markRun(job, 'ok');
  assert.equal(updated.runHistory.length, 50);
});

test('markRun sets lastRunStatus and trigger', () => {
  const job = {};
  const updated = markRun(job, 'ok', undefined, 'manual');
  assert.equal(updated.lastRunStatus, 'ok');
  assert.equal(updated.runHistory[0].trigger, 'manual');
});

test('markRun does not include error key when error is undefined', () => {
  const job = {};
  const updated = markRun(job, 'ok', undefined);
  assert.ok(!('error' in updated.runHistory[0]));
});

// ── syncPersonalityRefresh upsert logic (pure, inlined) ──────────────────────
//
// Mirrors the upsert in service.ts: when enabling, overwrite canonical fields
// while preserving history/counters/createdAt from any existing job.

const PERSONALITY_REFRESH_JOB_ID = 'agentos-builtin-personality-refresh';

function buildPersonalityRefreshJob(projectId, existing, now) {
  const jobId = `${PERSONALITY_REFRESH_JOB_ID}-${projectId}`;
  return {
    id: jobId,
    name: 'Personality Refresh',
    projectId,
    trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 12 * * *' } },
    instructions:
      'Refresh my personality profile by analyzing my recent conversations and updating the personality profile.',
    isSystem: true,
    enabled: true,
    deleteAfterRun: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt,
    // lastRunStatus/lastRunError intentionally dropped: sync is administrative,
    // and carrying a stale error into a repaired state misleads the UI.
    runCountOk: existing?.runCountOk ?? 0,
    runCountError: existing?.runCountError ?? 0,
    runHistory: existing?.runHistory,
  };
}

test('syncPersonalityRefresh: builds a canonical job when none exists', () => {
  const now = 1_700_000_000_000;
  const job = buildPersonalityRefreshJob('proj-a', undefined, now);
  assert.equal(job.id, 'agentos-builtin-personality-refresh-proj-a');
  assert.equal(job.projectId, 'proj-a');
  assert.equal(job.isSystem, true);
  assert.equal(job.enabled, true);
  assert.equal(job.createdAt, now);
  assert.equal(job.updatedAt, now);
  assert.equal(job.runCountOk, 0);
  assert.equal(job.runCountError, 0);
  assert.equal(job.runHistory, undefined);
  assert.equal(job.trigger.schedule.expr, '0 12 * * *');
});

test('syncPersonalityRefresh: preserves history, counters, and createdAt across upsert', () => {
  const originalCreatedAt = 1_600_000_000_000;
  const now = 1_700_000_000_000;
  const existing = {
    id: 'agentos-builtin-personality-refresh-proj-a',
    createdAt: originalCreatedAt,
    runCountOk: 42,
    runCountError: 3,
    lastRunAt: 1_650_000_000_000,
    lastRunStatus: 'error',
    lastRunError: 'stale error from a prior run',
    runHistory: [{ at: 1, status: 'ok', trigger: 'schedule' }],
    // Imagine a prior version had a different (now-stale) cron or name
    name: 'Old Name',
    trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 0 * * *' } },
    enabled: false, // user/store could have ended up disabled; upsert must repair
  };
  const job = buildPersonalityRefreshJob('proj-a', existing, now);

  // Preserved — analytics continuity
  assert.equal(job.createdAt, originalCreatedAt, 'createdAt must persist across upsert');
  assert.equal(job.runCountOk, 42);
  assert.equal(job.runCountError, 3);
  assert.equal(job.lastRunAt, 1_650_000_000_000);
  assert.deepEqual(job.runHistory, [{ at: 1, status: 'ok', trigger: 'schedule' }]);

  // Overwritten — canonical values re-applied
  assert.equal(job.name, 'Personality Refresh');
  assert.equal(job.trigger.schedule.expr, '0 12 * * *');
  assert.equal(job.enabled, true, 'upsert repairs disabled state');
  assert.equal(job.updatedAt, now, 'updatedAt reflects the sync');

  // Dropped — last-run status/error would misrepresent a freshly repaired job
  assert.equal(job.lastRunStatus, undefined, 'stale lastRunStatus must be dropped');
  assert.equal(job.lastRunError, undefined, 'stale lastRunError must be dropped');
});

test('syncPersonalityRefresh: zero counters when existing lacks them', () => {
  const existing = { createdAt: 1, runHistory: [] };
  const job = buildPersonalityRefreshJob('proj-a', existing, 2);
  assert.equal(job.runCountOk, 0);
  assert.equal(job.runCountError, 0);
});

// ── removeByProjectId cascade logic (pure, inlined) ──────────────────────────

function removeByProjectId(jobs, projectId) {
  const kept = [];
  const removed = [];
  for (const job of jobs) {
    if (job.projectId === projectId) removed.push(job.id);
    else kept.push(job);
  }
  return { kept, removed };
}

test('removeByProjectId: removes only jobs for the target project', () => {
  const jobs = [
    { id: 'a', projectId: 'p1' },
    { id: 'b', projectId: 'p2' },
    { id: 'c', projectId: 'p1' },
    { id: 'd', projectId: 'p3' },
  ];
  const { kept, removed } = removeByProjectId(jobs, 'p1');
  assert.deepEqual(removed.sort(), ['a', 'c']);
  assert.deepEqual(kept.map((j) => j.id).sort(), ['b', 'd']);
});

test('removeByProjectId: includes system jobs in cascade', () => {
  const jobs = [
    { id: 'user-job', projectId: 'p1', isSystem: false },
    { id: 'agentos-builtin-personality-refresh-p1', projectId: 'p1', system: true },
    { id: 'other', projectId: 'p2', isSystem: false },
  ];
  const { removed } = removeByProjectId(jobs, 'p1');
  assert.ok(removed.includes('agentos-builtin-personality-refresh-p1'), 'system job must be cascaded');
  assert.equal(removed.length, 2);
});
