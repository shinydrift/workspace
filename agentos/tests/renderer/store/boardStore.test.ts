import { test, expect } from 'vitest';
import { useBoardStore, selectTasksByStatus, selectWipLimit } from '../../../src/renderer/store/boardStore';
import type { KanbanTask, KanbanWipLimit } from '../../../src/shared/types/kanban';

function reset() {
  useBoardStore.setState({ tasks: [], notes: {}, wipLimits: [], loading: false, error: null });
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return { id: 't1', title: 'Task', status: 'todo', projectId: 'p1', ...overrides } as KanbanTask;
}

// ── Initial state ─────────────────────────────────────────────────────────────

test('boardStore: initial state', () => {
  reset();
  const s = useBoardStore.getState();
  expect(s.tasks).toEqual([]);
  expect(s.notes).toEqual({});
  expect(s.wipLimits).toEqual([]);
  expect(s.loading).toBe(false);
  expect(s.error).toBe(null);
});

// ── setTasks ──────────────────────────────────────────────────────────────────

test('boardStore: setTasks replaces task list', () => {
  reset();
  const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
  useBoardStore.getState().setTasks(tasks);
  expect(useBoardStore.getState().tasks.length).toBe(2);
});

// ── upsertTask ────────────────────────────────────────────────────────────────

test('boardStore: upsertTask adds new task', () => {
  reset();
  useBoardStore.getState().upsertTask(makeTask({ id: 'new' }));
  expect(useBoardStore.getState().tasks.length).toBe(1);
  expect(useBoardStore.getState().tasks[0].id).toBe('new');
});

test('boardStore: upsertTask updates existing task', () => {
  reset();
  useBoardStore.getState().upsertTask(makeTask({ id: 'x', title: 'Old' }));
  useBoardStore.getState().upsertTask(makeTask({ id: 'x', title: 'New' }));
  const tasks = useBoardStore.getState().tasks;
  expect(tasks.length).toBe(1);
  expect(tasks[0].title).toBe('New');
});

// ── removeTask ────────────────────────────────────────────────────────────────

test('boardStore: removeTask removes by id', () => {
  reset();
  useBoardStore.getState().setTasks([makeTask({ id: 'keep' }), makeTask({ id: 'del' })]);
  useBoardStore.getState().removeTask('del');
  const tasks = useBoardStore.getState().tasks;
  expect(tasks.length).toBe(1);
  expect(tasks[0].id).toBe('keep');
});

test('boardStore: removeTask is a no-op for unknown id', () => {
  reset();
  useBoardStore.getState().setTasks([makeTask({ id: 'a' })]);
  useBoardStore.getState().removeTask('missing');
  expect(useBoardStore.getState().tasks.length).toBe(1);
});

// ── setNotes ──────────────────────────────────────────────────────────────────

test('boardStore: setNotes stores notes by taskId', () => {
  reset();
  useBoardStore.getState().setNotes('t1', [{ id: 'n1', content: 'hi', taskId: 't1', createdAt: 0 }]);
  expect(useBoardStore.getState().notes['t1']?.length).toBe(1);
});

test('boardStore: setNotes preserves other task notes', () => {
  reset();
  useBoardStore.getState().setNotes('t1', [{ id: 'n1', content: 'a', taskId: 't1', createdAt: 0 }]);
  useBoardStore.getState().setNotes('t2', [{ id: 'n2', content: 'b', taskId: 't2', createdAt: 0 }]);
  expect(useBoardStore.getState().notes['t1']).toBeTruthy();
  expect(useBoardStore.getState().notes['t2']).toBeTruthy();
});

// ── setWipLimits / setLoading / setError ──────────────────────────────────────

test('boardStore: setWipLimits replaces limits', () => {
  reset();
  const limits: KanbanWipLimit[] = [{ status: 'todo', maxTasks: 5 }];
  useBoardStore.getState().setWipLimits(limits);
  expect(useBoardStore.getState().wipLimits.length).toBe(1);
});

test('boardStore: setLoading sets loading flag', () => {
  reset();
  useBoardStore.getState().setLoading(true);
  expect(useBoardStore.getState().loading).toBe(true);
  useBoardStore.getState().setLoading(false);
  expect(useBoardStore.getState().loading).toBe(false);
});

test('boardStore: setError sets error string', () => {
  reset();
  useBoardStore.getState().setError('oops');
  expect(useBoardStore.getState().error).toBe('oops');
  useBoardStore.getState().setError(null);
  expect(useBoardStore.getState().error).toBe(null);
});

// ── Selectors ─────────────────────────────────────────────────────────────────

test('selectTasksByStatus: filters tasks by status', () => {
  const tasks = [makeTask({ id: 'a', status: 'todo' }), makeTask({ id: 'b', status: 'done' })];
  const result = selectTasksByStatus(tasks, 'todo');
  expect(result.length).toBe(1);
  expect(result[0].id).toBe('a');
});

test('selectTasksByStatus: returns empty array when none match', () => {
  const tasks = [makeTask({ id: 'a', status: 'todo' })];
  expect(selectTasksByStatus(tasks, 'done')).toEqual([]);
});

test('selectWipLimit: returns maxTasks for matching status', () => {
  const limits: KanbanWipLimit[] = [{ status: 'todo', maxTasks: 3 }];
  expect(selectWipLimit(limits, 'todo')).toBe(3);
});

test('selectWipLimit: returns null when status not found', () => {
  expect(selectWipLimit([], 'todo')).toBe(null);
});
