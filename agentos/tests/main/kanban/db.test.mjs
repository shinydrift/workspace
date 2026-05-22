/**
 * Tests for kanban/db.ts — rowToTask pure transform (inlined).
 * No DB calls needed — pure data shape transformation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from kanban/db.ts ─────────────────────────────────────────────────

function rowToTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    assignedThreadId: row.assigned_thread_id,
    skillTags: JSON.parse(row.skill_tags),
    branch: row.branch,
    worktreePath: row.worktree_path,
    taskType: row.task_type,
    parentTaskId: row.parent_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    metadata: JSON.parse(row.metadata),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    title: 'My Task',
    description: 'A description',
    status: 'refinement',
    priority: 'medium',
    progress: 0,
    assigned_thread_id: null,
    skill_tags: '[]',
    branch: null,
    worktree_path: null,
    task_type: 'dev',
    parent_task_id: null,
    created_at: 1000,
    updated_at: 2000,
    completed_at: null,
    metadata: '{}',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('rowToTask: maps all snake_case fields to camelCase', () => {
  const row = makeRow({
    id: 'abc',
    project_id: 'p1',
    title: 'Test',
    description: 'Desc',
    status: 'in_progress',
    priority: 'high',
    progress: 42,
    assigned_thread_id: 'thread-x',
    skill_tags: '["ts","react"]',
    branch: 'feat/branch',
    worktree_path: '/tmp/wt',
    task_type: 'review',
    parent_task_id: 'parent-1',
    created_at: 100,
    updated_at: 200,
    completed_at: 300,
    metadata: '{"foo":"bar"}',
  });
  const task = rowToTask(row);
  assert.equal(task.id, 'abc');
  assert.equal(task.projectId, 'p1');
  assert.equal(task.title, 'Test');
  assert.equal(task.description, 'Desc');
  assert.equal(task.status, 'in_progress');
  assert.equal(task.priority, 'high');
  assert.equal(task.progress, 42);
  assert.equal(task.assignedThreadId, 'thread-x');
  assert.deepEqual(task.skillTags, ['ts', 'react']);
  assert.equal(task.branch, 'feat/branch');
  assert.equal(task.worktreePath, '/tmp/wt');
  assert.equal(task.taskType, 'review');
  assert.equal(task.parentTaskId, 'parent-1');
  assert.equal(task.createdAt, 100);
  assert.equal(task.updatedAt, 200);
  assert.equal(task.completedAt, 300);
  assert.deepEqual(task.metadata, { foo: 'bar' });
});

test('rowToTask: handles null optional fields', () => {
  const task = rowToTask(makeRow());
  assert.equal(task.assignedThreadId, null);
  assert.equal(task.branch, null);
  assert.equal(task.worktreePath, null);
  assert.equal(task.parentTaskId, null);
  assert.equal(task.completedAt, null);
});

test('rowToTask: parses empty skillTags array', () => {
  const task = rowToTask(makeRow({ skill_tags: '[]' }));
  assert.deepEqual(task.skillTags, []);
});

test('rowToTask: parses non-empty skillTags', () => {
  const task = rowToTask(makeRow({ skill_tags: '["python","ml"]' }));
  assert.deepEqual(task.skillTags, ['python', 'ml']);
});

test('rowToTask: parses empty metadata object', () => {
  const task = rowToTask(makeRow({ metadata: '{}' }));
  assert.deepEqual(task.metadata, {});
});

test('rowToTask: parses non-empty metadata', () => {
  const task = rowToTask(makeRow({ metadata: '{"estimatedHours":4,"tags":["urgent"]}' }));
  assert.deepEqual(task.metadata, { estimatedHours: 4, tags: ['urgent'] });
});

test('rowToTask: passes through progress value unchanged', () => {
  assert.equal(rowToTask(makeRow({ progress: 0 })).progress, 0);
  assert.equal(rowToTask(makeRow({ progress: 50 })).progress, 50);
  assert.equal(rowToTask(makeRow({ progress: 100 })).progress, 100);
});

test('rowToTask: maps all status values', () => {
  for (const status of ['refinement', 'in_progress', 'in_review', 'done']) {
    assert.equal(rowToTask(makeRow({ status })).status, status);
  }
});

test('rowToTask: maps all priority values', () => {
  for (const priority of ['low', 'medium', 'high', 'critical']) {
    assert.equal(rowToTask(makeRow({ priority })).priority, priority);
  }
});

test('rowToTask: maps all taskType values', () => {
  for (const taskType of ['dev', 'review', 'refine', 'research']) {
    assert.equal(rowToTask(makeRow({ task_type: taskType })).taskType, taskType);
  }
});
