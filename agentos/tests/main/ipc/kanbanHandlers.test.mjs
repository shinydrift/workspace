/**
 * Tests for ipc/handlers/kanbanHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from kanbanHandlers.ts ────────────────────────────────

const STATUSES = ['backlog', 'refined', 'queued', 'in_progress', 'in_review', 'blocked', 'done'];

function isValidStatus(s) {
  return typeof s === 'string' && STATUSES.includes(s);
}

function isValidShortId(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 128;
}

function validateKanbanList(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId)) return false;
  if (req.status !== undefined && !isValidStatus(req.status)) return false;
  return true;
}

function validateKanbanCreate(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId)) return false;
  if (typeof req.title !== 'string' || req.title.length < 1 || req.title.length > 256) return false;
  if (req.description !== undefined) {
    if (typeof req.description !== 'string' || req.description.length > 50_000) return false;
  }
  if (req.priority !== undefined && !['low', 'medium', 'high'].includes(req.priority)) return false;
  if (req.taskType !== undefined && !['dev', 'research', 'review', 'refine'].includes(req.taskType)) return false;
  if (req.skillTags !== undefined) {
    if (!Array.isArray(req.skillTags) || req.skillTags.length > 20) return false;
    if (req.skillTags.some((t) => typeof t !== 'string' || t.length > 64)) return false;
  }
  if (req.status !== undefined && !isValidStatus(req.status)) return false;
  return true;
}

function validateKanbanMove(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId) || !isValidShortId(req.taskId)) return false;
  if (!isValidStatus(req.status)) return false;
  if (req.reason !== undefined) {
    if (typeof req.reason !== 'string' || req.reason.length > 1024) return false;
  }
  return true;
}

function validateUpdateProgress(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId) || !isValidShortId(req.taskId)) return false;
  if (!Number.isInteger(req.progress) || req.progress < 0 || req.progress > 100) return false;
  if (req.note !== undefined) {
    if (typeof req.note !== 'string' || req.note.length > 10_000) return false;
  }
  return true;
}

function validateAddNote(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId) || !isValidShortId(req.taskId)) return false;
  if (typeof req.content !== 'string' || req.content.length < 1 || req.content.length > 50_000) return false;
  return true;
}

function validateAddReview(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId) || !isValidShortId(req.taskId)) return false;
  if (!['approved', 'changes_requested'].includes(req.verdict)) return false;
  if (req.summary !== undefined) {
    if (typeof req.summary !== 'string' || req.summary.length > 10_000) return false;
  }
  return true;
}

function validateSetBlocker(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId) || !isValidShortId(req.taskId)) return false;
  if (typeof req.blocked !== 'boolean') return false;
  if (req.summary !== undefined) {
    if (typeof req.summary !== 'string' || req.summary.length > 10_000) return false;
  }
  return true;
}

function validateSetWipLimit(req) {
  if (!req || typeof req !== 'object') return false;
  if (!isValidShortId(req.projectId)) return false;
  if (!isValidStatus(req.status)) return false;
  if (!Number.isInteger(req.maxTasks) || req.maxTasks < 1 || req.maxTasks > 50) return false;
  return true;
}

// ── statusEnum ────────────────────────────────────────────────────────────────

test('statusEnum: all valid statuses accepted', () => {
  for (const s of STATUSES) assert.ok(isValidStatus(s), `${s} should be valid`);
});

test('statusEnum: rejects unknown status', () => {
  assert.ok(!isValidStatus('unknown'));
  assert.ok(!isValidStatus(''));
  assert.ok(!isValidStatus(null));
});

// ── KANBAN_LIST ───────────────────────────────────────────────────────────────

test('KANBAN_LIST: valid without optional status', () => {
  assert.ok(validateKanbanList({ projectId: 'proj-1' }));
});

test('KANBAN_LIST: valid with optional status', () => {
  assert.ok(validateKanbanList({ projectId: 'proj-1', status: 'in_progress' }));
});

test('KANBAN_LIST: rejects invalid status', () => {
  assert.ok(!validateKanbanList({ projectId: 'proj-1', status: 'invalid' }));
});

test('KANBAN_LIST: rejects empty projectId', () => {
  assert.ok(!validateKanbanList({ projectId: '' }));
});

// ── KANBAN_CREATE ─────────────────────────────────────────────────────────────

test('KANBAN_CREATE: valid minimal', () => {
  assert.ok(validateKanbanCreate({ projectId: 'p1', title: 'Fix bug' }));
});

test('KANBAN_CREATE: valid with all optional fields', () => {
  assert.ok(
    validateKanbanCreate({
      projectId: 'p1',
      title: 'Research task',
      description: 'details',
      priority: 'high',
      taskType: 'research',
      skillTags: ['ts', 'react'],
      status: 'backlog',
    })
  );
});

test('KANBAN_CREATE: rejects empty title', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: '' }));
});

test('KANBAN_CREATE: rejects title over 256 chars', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'x'.repeat(257) }));
});

test('KANBAN_CREATE: accepts title exactly 256 chars', () => {
  assert.ok(validateKanbanCreate({ projectId: 'p1', title: 'x'.repeat(256) }));
});

test('KANBAN_CREATE: accepts description exactly 50000 chars', () => {
  assert.ok(validateKanbanCreate({ projectId: 'p1', title: 'T', description: 'x'.repeat(50_000) }));
});

test('KANBAN_CREATE: rejects description over 50000 chars', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', description: 'x'.repeat(50_001) }));
});

test('KANBAN_CREATE: rejects invalid priority', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', priority: 'urgent' }));
});

test('KANBAN_CREATE: rejects invalid taskType', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', taskType: 'bug' }));
});

test('KANBAN_CREATE: rejects skillTags over 20 entries', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', skillTags: Array(21).fill('ts') }));
});

test('KANBAN_CREATE: rejects skill tag over 64 chars', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', skillTags: ['x'.repeat(65)] }));
});

test('KANBAN_CREATE: rejects non-string skill tag', () => {
  assert.ok(!validateKanbanCreate({ projectId: 'p1', title: 'T', skillTags: ['ts', 42] }));
});

test('KANBAN_CREATE: accepts skill tag exactly 64 chars', () => {
  assert.ok(validateKanbanCreate({ projectId: 'p1', title: 'T', skillTags: ['x'.repeat(64)] }));
});

// ── KANBAN_MOVE ───────────────────────────────────────────────────────────────

test('KANBAN_MOVE: valid minimal', () => {
  assert.ok(validateKanbanMove({ projectId: 'p1', taskId: 't1', status: 'done' }));
});

test('KANBAN_MOVE: valid with reason', () => {
  assert.ok(validateKanbanMove({ projectId: 'p1', taskId: 't1', status: 'in_review', reason: 'ready' }));
});

test('KANBAN_MOVE: rejects invalid status', () => {
  assert.ok(!validateKanbanMove({ projectId: 'p1', taskId: 't1', status: 'pending' }));
});

test('KANBAN_MOVE: rejects reason over 1024 chars', () => {
  assert.ok(!validateKanbanMove({ projectId: 'p1', taskId: 't1', status: 'done', reason: 'x'.repeat(1025) }));
});

test('KANBAN_MOVE: accepts reason exactly 1024 chars', () => {
  assert.ok(validateKanbanMove({ projectId: 'p1', taskId: 't1', status: 'done', reason: 'x'.repeat(1024) }));
});

// ── KANBAN_UPDATE_PROGRESS ────────────────────────────────────────────────────

test('KANBAN_UPDATE_PROGRESS: valid progress 0', () => {
  assert.ok(validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 0 }));
});

test('KANBAN_UPDATE_PROGRESS: valid progress 100', () => {
  assert.ok(validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 100 }));
});

test('KANBAN_UPDATE_PROGRESS: valid progress 50 with note', () => {
  assert.ok(validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 50, note: 'halfway' }));
});

test('KANBAN_UPDATE_PROGRESS: rejects negative progress', () => {
  assert.ok(!validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: -1 }));
});

test('KANBAN_UPDATE_PROGRESS: rejects progress over 100', () => {
  assert.ok(!validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 101 }));
});

test('KANBAN_UPDATE_PROGRESS: rejects non-integer progress', () => {
  assert.ok(!validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 50.5 }));
});

test('KANBAN_UPDATE_PROGRESS: rejects note over 10000 chars', () => {
  assert.ok(!validateUpdateProgress({ projectId: 'p1', taskId: 't1', progress: 50, note: 'x'.repeat(10_001) }));
});

// ── KANBAN_ADD_NOTE ───────────────────────────────────────────────────────────

test('KANBAN_ADD_NOTE: valid content', () => {
  assert.ok(validateAddNote({ projectId: 'p1', taskId: 't1', content: 'done with review' }));
});

test('KANBAN_ADD_NOTE: rejects empty content', () => {
  assert.ok(!validateAddNote({ projectId: 'p1', taskId: 't1', content: '' }));
});

test('KANBAN_ADD_NOTE: rejects content over 50000 chars', () => {
  assert.ok(!validateAddNote({ projectId: 'p1', taskId: 't1', content: 'x'.repeat(50_001) }));
});

test('KANBAN_ADD_NOTE: accepts content exactly 50000 chars', () => {
  assert.ok(validateAddNote({ projectId: 'p1', taskId: 't1', content: 'x'.repeat(50_000) }));
});

// ── KANBAN_ADD_REVIEW ────────────────────────────────────────────────────────

test('KANBAN_ADD_REVIEW: valid approved verdict', () => {
  assert.ok(validateAddReview({ projectId: 'p1', taskId: 't1', verdict: 'approved', summary: 'ship it' }));
});

test('KANBAN_ADD_REVIEW: rejects invalid verdict', () => {
  assert.ok(!validateAddReview({ projectId: 'p1', taskId: 't1', verdict: 'pending' }));
});

test('KANBAN_ADD_REVIEW: rejects summary over 10000 chars', () => {
  assert.ok(!validateAddReview({ projectId: 'p1', taskId: 't1', verdict: 'approved', summary: 'x'.repeat(10_001) }));
});

// ── KANBAN_SET_BLOCKER ───────────────────────────────────────────────────────

test('KANBAN_SET_BLOCKER: valid blocked payload', () => {
  assert.ok(validateSetBlocker({ projectId: 'p1', taskId: 't1', blocked: true, summary: 'waiting on review' }));
});

test('KANBAN_SET_BLOCKER: rejects non-boolean blocked field', () => {
  assert.ok(!validateSetBlocker({ projectId: 'p1', taskId: 't1', blocked: 'yes' }));
});

// ── KANBAN_SET_WIP_LIMIT ──────────────────────────────────────────────────────

test('KANBAN_SET_WIP_LIMIT: valid', () => {
  assert.ok(validateSetWipLimit({ projectId: 'p1', status: 'in_progress', maxTasks: 5 }));
});

test('KANBAN_SET_WIP_LIMIT: valid maxTasks 1', () => {
  assert.ok(validateSetWipLimit({ projectId: 'p1', status: 'in_review', maxTasks: 1 }));
});

test('KANBAN_SET_WIP_LIMIT: valid maxTasks 50', () => {
  assert.ok(validateSetWipLimit({ projectId: 'p1', status: 'queued', maxTasks: 50 }));
});

test('KANBAN_SET_WIP_LIMIT: rejects maxTasks 0', () => {
  assert.ok(!validateSetWipLimit({ projectId: 'p1', status: 'in_progress', maxTasks: 0 }));
});

test('KANBAN_SET_WIP_LIMIT: rejects maxTasks 51', () => {
  assert.ok(!validateSetWipLimit({ projectId: 'p1', status: 'in_progress', maxTasks: 51 }));
});

test('KANBAN_SET_WIP_LIMIT: rejects non-integer maxTasks', () => {
  assert.ok(!validateSetWipLimit({ projectId: 'p1', status: 'in_progress', maxTasks: 2.5 }));
});

test('KANBAN_SET_WIP_LIMIT: rejects invalid status', () => {
  assert.ok(!validateSetWipLimit({ projectId: 'p1', status: 'unknown', maxTasks: 5 }));
});

// ── spawn_stage_worker blocked guard ─────────────────────────────────────────
// Mirrors the guard in mcpServer.ts spawn_stage_worker:
//   throw if task.blockedBy.length > 0.

function canSpawnWorker(task) {
  if (!task.mainThreadId) return { ok: false, reason: 'no main thread' };
  if (task.blockedBy.length > 0) return { ok: false, reason: `blocked by: ${task.blockedBy.join(', ')}` };
  return { ok: true };
}

test('spawn_stage_worker: allows spawn when blockedBy is empty', () => {
  const result = canSpawnWorker({ mainThreadId: 't1', blockedBy: [] });
  assert.equal(result.ok, true);
});

test('spawn_stage_worker: rejects spawn when task has one blocker', () => {
  const result = canSpawnWorker({ mainThreadId: 't1', blockedBy: ['task-dep'] });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('task-dep'));
});

test('spawn_stage_worker: rejects spawn when task has multiple blockers', () => {
  const result = canSpawnWorker({ mainThreadId: 't1', blockedBy: ['dep-a', 'dep-b'] });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('dep-a'));
  assert.ok(result.reason.includes('dep-b'));
});

