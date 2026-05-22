/**
 * Tests for kanban/service.ts — WIP limit resolution and auto-close parent logic (inlined).
 * Pure logic extracted from KanbanService.move().
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from kanban/service.ts ────────────────────────────────────────────

const DEFAULT_WIP_LIMITS = {
  in_progress: 5,
  in_review: 3,
};

/**
 * Resolve the effective WIP limit for a target status.
 * Project-level wipLimits entries override the defaults.
 * Returns undefined if no limit is configured.
 */
function resolveWipLimit(newStatus, wipLimits) {
  const limitEntry = wipLimits.find((w) => w.status === newStatus);
  const defaultLimit = DEFAULT_WIP_LIMITS[newStatus];
  return limitEntry?.maxTasks ?? defaultLimit;
}

/**
 * Returns true when all siblings (except the currently-moving task itself)
 * are done — used to decide whether to auto-close the parent.
 */
function allSubtasksDone(siblings, currentTaskId) {
  return siblings.every((s) => s.id === currentTaskId || s.status === 'done');
}

// ── resolveWipLimit ───────────────────────────────────────────────────────────

test('resolveWipLimit: returns default in_progress limit of 5', () => {
  assert.equal(resolveWipLimit('in_progress', []), 5);
});

test('resolveWipLimit: returns default in_review limit of 3', () => {
  assert.equal(resolveWipLimit('in_review', []), 3);
});

test('resolveWipLimit: project override takes precedence over default', () => {
  const wipLimits = [{ status: 'in_progress', maxTasks: 2 }];
  assert.equal(resolveWipLimit('in_progress', wipLimits), 2);
});

test('resolveWipLimit: project override for in_review', () => {
  const wipLimits = [{ status: 'in_review', maxTasks: 1 }];
  assert.equal(resolveWipLimit('in_review', wipLimits), 1);
});

test('resolveWipLimit: returns undefined for statuses without default or override', () => {
  assert.equal(resolveWipLimit('backlog', []), undefined);
  assert.equal(resolveWipLimit('done', []), undefined);
  assert.equal(resolveWipLimit('blocked', []), undefined);
  assert.equal(resolveWipLimit('queued', []), undefined);
});

test('resolveWipLimit: project override for status with no default', () => {
  const wipLimits = [{ status: 'backlog', maxTasks: 10 }];
  assert.equal(resolveWipLimit('backlog', wipLimits), 10);
});

test('resolveWipLimit: ignores override for different status', () => {
  const wipLimits = [{ status: 'in_review', maxTasks: 1 }];
  assert.equal(resolveWipLimit('in_progress', wipLimits), 5);
});

// ── allSubtasksDone ───────────────────────────────────────────────────────────

test('allSubtasksDone: returns true when there are no siblings', () => {
  assert.equal(allSubtasksDone([], 'task-1'), true);
});

test('allSubtasksDone: returns true when the only sibling is the current task', () => {
  const siblings = [{ id: 'task-1', status: 'in_progress' }];
  assert.equal(allSubtasksDone(siblings, 'task-1'), true);
});

test('allSubtasksDone: returns true when all other siblings are done', () => {
  const siblings = [
    { id: 'task-1', status: 'in_progress' }, // moving task
    { id: 'task-2', status: 'done' },
    { id: 'task-3', status: 'done' },
  ];
  assert.equal(allSubtasksDone(siblings, 'task-1'), true);
});

test('allSubtasksDone: returns false when another sibling is not done', () => {
  const siblings = [
    { id: 'task-1', status: 'in_progress' }, // moving task
    { id: 'task-2', status: 'done' },
    { id: 'task-3', status: 'in_progress' }, // still active
  ];
  assert.equal(allSubtasksDone(siblings, 'task-1'), false);
});

test('allSubtasksDone: returns false when no siblings are done', () => {
  const siblings = [
    { id: 'task-1', status: 'in_progress' },
    { id: 'task-2', status: 'backlog' },
  ];
  assert.equal(allSubtasksDone(siblings, 'task-1'), false);
});

test('allSubtasksDone: current task itself is excluded from the check regardless of its status', () => {
  // Even if currentTaskId matches a non-done entry, it should be treated as complete
  const siblings = [{ id: 'task-1', status: 'in_progress' }];
  assert.equal(allSubtasksDone(siblings, 'task-1'), true);
});

// ── auto-unblock emit trigger ─────────────────────────────────────────────────
// Mirrors the remaining-length check in KanbanService.move() that decides
// whether to emit 'task:unblocked'. If that condition changes, update here.

function shouldEmitUnblocked(remainingBlockers) {
  return remainingBlockers.length === 0;
}

test('shouldEmitUnblocked: emits when last blocker is removed', () => {
  assert.equal(shouldEmitUnblocked([]), true);
});

test('shouldEmitUnblocked: does not emit when other blockers remain', () => {
  assert.equal(shouldEmitUnblocked(['task-other']), false);
});

test('shouldEmitUnblocked: does not emit when multiple blockers remain', () => {
  assert.equal(shouldEmitUnblocked(['task-a', 'task-b']), false);
});
