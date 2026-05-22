/**
 * Tests for council/db.ts — rowToRun and rowToOutcome pure transforms (inlined).
 * No DB calls needed — pure row-to-object mapping logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from council/db.ts ────────────────────────────────────────────────

function rowToRun(row) {
  return {
    id: row.id,
    configId: row.config_id,
    parentThreadId: row.parent_thread_id,
    prompt: row.prompt,
    childThreadIds: JSON.parse((row.child_thread_ids) || '[]'),
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function rowToOutcome(row) {
  const hasSummary = typeof row.summary === 'string';
  const outcome = hasSummary
    ? {
        summary: row.summary,
        answer: row.answer,
        confidence: row.confidence != null ? row.confidence : undefined,
        caveats: row.caveats ? JSON.parse(row.caveats) : undefined,
      }
    : undefined;
  return {
    runId: row.run_id,
    childThreadId: row.child_thread_id,
    member: { provider: row.member_provider, model: row.member_model },
    status: row.status,
    outcome,
    raw: row.raw,
    error: row.error,
    submittedAt: row.submitted_at,
  };
}

// ── rowToRun ──────────────────────────────────────────────────────────────────

test('rowToRun: maps all snake_case fields to camelCase', () => {
  const row = {
    id: 'run-1',
    config_id: 'cfg-1',
    parent_thread_id: 'thread-p',
    prompt: 'What do you think?',
    child_thread_ids: '["ch1","ch2"]',
    status: 'running',
    created_at: 1000,
    completed_at: null,
  };
  const run = rowToRun(row);
  assert.equal(run.id, 'run-1');
  assert.equal(run.configId, 'cfg-1');
  assert.equal(run.parentThreadId, 'thread-p');
  assert.equal(run.prompt, 'What do you think?');
  assert.deepEqual(run.childThreadIds, ['ch1', 'ch2']);
  assert.equal(run.status, 'running');
  assert.equal(run.createdAt, 1000);
  assert.equal(run.completedAt, null);
});

test('rowToRun: empty child_thread_ids parses to empty array', () => {
  const row = {
    id: 'r',
    config_id: 'c',
    parent_thread_id: 'p',
    prompt: '',
    child_thread_ids: '[]',
    status: 'running',
    created_at: 1,
    completed_at: null,
  };
  assert.deepEqual(rowToRun(row).childThreadIds, []);
});

test('rowToRun: null child_thread_ids falls back to empty array', () => {
  const row = {
    id: 'r',
    config_id: 'c',
    parent_thread_id: 'p',
    prompt: '',
    child_thread_ids: null,
    status: 'running',
    created_at: 1,
    completed_at: null,
  };
  assert.deepEqual(rowToRun(row).childThreadIds, []);
});

test('rowToRun: completedAt passes through when set', () => {
  const row = {
    id: 'r',
    config_id: 'c',
    parent_thread_id: 'p',
    prompt: '',
    child_thread_ids: '[]',
    status: 'done',
    created_at: 1,
    completed_at: 9999,
  };
  assert.equal(rowToRun(row).completedAt, 9999);
});

// ── rowToOutcome ──────────────────────────────────────────────────────────────

test('rowToOutcome: maps submitted outcome with all fields', () => {
  const row = {
    run_id: 'run-1',
    child_thread_id: 'ch-1',
    member_provider: 'claude',
    member_model: 'opus',
    status: 'submitted',
    summary: 'Looks good',
    answer: 'Yes',
    confidence: 0.9,
    caveats: '["caveat1","caveat2"]',
    raw: null,
    error: null,
    submitted_at: 2000,
  };
  const outcome = rowToOutcome(row);
  assert.equal(outcome.runId, 'run-1');
  assert.equal(outcome.childThreadId, 'ch-1');
  assert.deepEqual(outcome.member, { provider: 'claude', model: 'opus' });
  assert.equal(outcome.status, 'submitted');
  assert.equal(outcome.outcome?.summary, 'Looks good');
  assert.equal(outcome.outcome?.answer, 'Yes');
  assert.equal(outcome.outcome?.confidence, 0.9);
  assert.deepEqual(outcome.outcome?.caveats, ['caveat1', 'caveat2']);
  assert.equal(outcome.submittedAt, 2000);
});

test('rowToOutcome: outcome is undefined when summary is null', () => {
  const row = {
    run_id: 'run-1',
    child_thread_id: 'ch-2',
    member_provider: 'codex',
    member_model: 'gpt-5',
    status: 'error',
    summary: null,
    answer: null,
    confidence: null,
    caveats: null,
    raw: null,
    error: 'timeout',
    submitted_at: 3000,
  };
  const outcome = rowToOutcome(row);
  assert.equal(outcome.outcome, undefined);
  assert.equal(outcome.error, 'timeout');
});

test('rowToOutcome: confidence is undefined when null in DB', () => {
  const row = {
    run_id: 'r',
    child_thread_id: 'c',
    member_provider: 'claude',
    member_model: 'sonnet',
    status: 'submitted',
    summary: 'summary text',
    answer: 'answer text',
    confidence: null,
    caveats: null,
    raw: null,
    error: null,
    submitted_at: 1,
  };
  const outcome = rowToOutcome(row);
  assert.equal(outcome.outcome?.confidence, undefined);
  assert.equal(outcome.outcome?.caveats, undefined);
});

test('rowToOutcome: raw field passes through', () => {
  const row = {
    run_id: 'r',
    child_thread_id: 'c',
    member_provider: 'gemini',
    member_model: 'flash',
    status: 'submitted',
    summary: 's',
    answer: 'a',
    confidence: null,
    caveats: null,
    raw: 'raw text response',
    error: null,
    submitted_at: 1,
  };
  assert.equal(rowToOutcome(row).raw, 'raw text response');
});
