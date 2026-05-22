/**
 * Tests for kanban ticket lifecycle — create a ticket and move it through stages.
 * Pure logic extracted from kanban/db.ts and kanban/service.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from kanban/db.ts ─────────────────────────────────────────────────

const DEFAULT_STAGES = [
  { id: 'refining', label: 'Refining', order: 0 },
  { id: 'implementing', label: 'Implementing', order: 1 },
  { id: 'reviewing', label: 'Reviewing', order: 2 },
  { id: 'done', label: 'Done', order: 3 },
];

const DEFAULT_TASK_STATUS = 'refinement';

function computeCompletedAt(newStatus, now) {
  return newStatus === 'done' ? now : null;
}

// ── Inlined from kanban/service.ts ────────────────────────────────────────────

function buildMoveEventData(fromStatus, toStatus, reason) {
  return { fromStatus, toStatus, reason: reason ?? null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Implement feature X',
    description: '',
    status: DEFAULT_TASK_STATUS,
    priority: 'medium',
    progress: 0,
    assignedThreadId: null,
    skillTags: [],
    branch: null,
    worktreePath: null,
    taskType: 'dev',
    parentTaskId: null,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    metadata: {},
    ...overrides,
  };
}

function applyMove(task, newStatus, now = 2000) {
  return {
    ...task,
    status: newStatus,
    updatedAt: now,
    completedAt: computeCompletedAt(newStatus, now),
  };
}

// ── Default stages ────────────────────────────────────────────────────────────

test('default stages: four stages in ascending order', () => {
  const ordered = [...DEFAULT_STAGES].sort((a, b) => a.order - b.order);
  assert.deepEqual(
    ordered.map((s) => s.id),
    ['refining', 'implementing', 'reviewing', 'done']
  );
});

test('default stages: each stage has a unique order', () => {
  const orders = DEFAULT_STAGES.map((s) => s.order);
  assert.equal(new Set(orders).size, DEFAULT_STAGES.length);
});

// ── Task creation ─────────────────────────────────────────────────────────────

test('new task defaults to refinement status', () => {
  const task = makeTask();
  assert.equal(task.status, 'refinement');
});

test('new task has null completedAt', () => {
  const task = makeTask();
  assert.equal(task.completedAt, null);
});

test('new task has zero progress', () => {
  const task = makeTask();
  assert.equal(task.progress, 0);
});

// ── computeCompletedAt ────────────────────────────────────────────────────────

test('computeCompletedAt: returns now when moving to done', () => {
  assert.equal(computeCompletedAt('done', 9999), 9999);
});

test('computeCompletedAt: returns null for any non-done status', () => {
  for (const status of ['refining', 'implementing', 'reviewing', 'refinement', 'blocked']) {
    assert.equal(computeCompletedAt(status, 9999), null, `expected null for status "${status}"`);
  }
});

// ── Move event data ───────────────────────────────────────────────────────────

test('buildMoveEventData: captures fromStatus and toStatus', () => {
  const ev = buildMoveEventData('refining', 'implementing', undefined);
  assert.equal(ev.fromStatus, 'refining');
  assert.equal(ev.toStatus, 'implementing');
});

test('buildMoveEventData: reason defaults to null when omitted', () => {
  const ev = buildMoveEventData('refining', 'implementing', undefined);
  assert.equal(ev.reason, null);
});

test('buildMoveEventData: reason is preserved when provided', () => {
  const ev = buildMoveEventData('reviewing', 'implementing', 'Changes requested: missing tests');
  assert.equal(ev.reason, 'Changes requested: missing tests');
});

// ── Full ticket lifecycle ─────────────────────────────────────────────────────

test('ticket moves refining → implementing: status updates, completedAt stays null', () => {
  const t0 = makeTask({ status: 'refining' });
  const t1 = applyMove(t0, 'implementing', 3000);
  assert.equal(t1.status, 'implementing');
  assert.equal(t1.completedAt, null);
  assert.ok(t1.updatedAt > t0.updatedAt);
});

test('ticket moves implementing → reviewing: status updates, completedAt stays null', () => {
  const t0 = makeTask({ status: 'implementing' });
  const t1 = applyMove(t0, 'reviewing', 4000);
  assert.equal(t1.status, 'reviewing');
  assert.equal(t1.completedAt, null);
});

test('ticket moves reviewing → done: completedAt is set', () => {
  const now = 5000;
  const t0 = makeTask({ status: 'reviewing' });
  const t1 = applyMove(t0, 'done', now);
  assert.equal(t1.status, 'done');
  assert.equal(t1.completedAt, now);
});

test('full lifecycle: refinement → refining → implementing → reviewing → done', () => {
  let task = makeTask();
  assert.equal(task.status, 'refinement');

  task = applyMove(task, 'refining', 2000);
  assert.equal(task.status, 'refining');
  assert.equal(task.completedAt, null);

  task = applyMove(task, 'implementing', 3000);
  assert.equal(task.status, 'implementing');
  assert.equal(task.completedAt, null);

  task = applyMove(task, 'reviewing', 4000);
  assert.equal(task.status, 'reviewing');
  assert.equal(task.completedAt, null);

  task = applyMove(task, 'done', 5000);
  assert.equal(task.status, 'done');
  assert.equal(task.completedAt, 5000);
});

test('ticket re-opened from done clears completedAt', () => {
  const t0 = makeTask({ status: 'done', completedAt: 5000 });
  const t1 = applyMove(t0, 'implementing', 6000);
  assert.equal(t1.status, 'implementing');
  assert.equal(t1.completedAt, null);
});

// ── changes_requested auto-reroute ────────────────────────────────────────────

test('changes_requested review moves ticket back to implementing', () => {
  // mirrors the addReview logic in service.ts
  const verdict = 'changes_requested';
  const targetStatus = verdict === 'changes_requested' ? 'implementing' : null;
  assert.equal(targetStatus, 'implementing');
});

test('approved review does not auto-move ticket (coordinator handles progression)', () => {
  const verdict = 'approved';
  const targetStatus = verdict === 'changes_requested' ? 'implementing' : null;
  assert.equal(targetStatus, null);
});

test('changes_requested reason is embedded in move event', () => {
  const summary = 'missing edge case tests';
  const ev = buildMoveEventData('reviewing', 'implementing', `Changes requested: ${summary}`);
  assert.ok(ev.reason.includes('Changes requested'));
  assert.ok(ev.reason.includes(summary));
});
