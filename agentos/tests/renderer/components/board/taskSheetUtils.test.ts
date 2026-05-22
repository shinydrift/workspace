import { test, expect } from 'vitest';
import {
  describeTaskEvent,
  getTaskReviewState,
  getTaskBlockerSummary,
} from '../../../../src/renderer/components/board/taskSheetUtils';
import type { KanbanTask, KanbanTaskEvent } from '../../../../src/shared/types';

function makeEvent(overrides: Partial<KanbanTaskEvent>): KanbanTaskEvent {
  return {
    id: 'e1',
    taskId: 't1',
    kind: 'comment',
    data: {},
    createdAt: Date.now(),
    ...overrides,
  } as KanbanTaskEvent;
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'Test',
    status: 'todo',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as KanbanTask;
}

// ── describeTaskEvent ─────────────────────────────────────────────────────────

test('describeTaskEvent: review approved', () => {
  const result = describeTaskEvent(makeEvent({ kind: 'review', data: { verdict: 'approved', summary: 'Looks good.' } }));
  expect(result.title).toBe('Review Approved');
  expect(result.body).toBe('Looks good.');
});

test('describeTaskEvent: blocker cleared', () => {
  const result = describeTaskEvent(
    makeEvent({ kind: 'blocker', data: { blocked: false, summary: 'Unblocked by merge.' } }),
  );
  expect(result.title).toBe('Blocker cleared');
  expect(result.body).toBe('Unblocked by merge.');
});

test('describeTaskEvent: created event', () => {
  const result = describeTaskEvent(makeEvent({ kind: 'created', data: { status: 'todo' } }));
  expect(result.title).toBe('Task created');
});

test('describeTaskEvent: moved event', () => {
  const result = describeTaskEvent(
    makeEvent({ kind: 'moved', data: { fromStatus: 'todo', toStatus: 'in_progress', reason: 'started' } }),
  );
  expect(result.title).toBe('todo -> in_progress');
  expect(result.body).toBe('started');
});

test('describeTaskEvent: progress event', () => {
  const result = describeTaskEvent(makeEvent({ kind: 'progress', data: { progress: 50, note: 'halfway' } }));
  expect(result.title).toBe('Progress 50%');
  expect(result.body).toBe('halfway');
});

test('describeTaskEvent: assigned event', () => {
  const result = describeTaskEvent(makeEvent({ kind: 'assigned' }));
  expect(result.title).toBe('Task assigned');
});

test('describeTaskEvent: comment event (fallback)', () => {
  const result = describeTaskEvent(makeEvent({ kind: 'comment', data: { content: 'hello' } }));
  expect(result.title).toBe('Comment');
  expect(result.body).toBe('hello');
});

// ── getTaskReviewState ────────────────────────────────────────────────────────

test('getTaskReviewState: no events → not pending, no summary', () => {
  const state = getTaskReviewState(makeTask({ status: 'todo' }), []);
  expect(state.pending).toBe(false);
  expect(state.summary).toBeNull();
});

test('getTaskReviewState: review verdict preferred', () => {
  const state = getTaskReviewState(makeTask({ status: 'done' }), [
    makeEvent({ kind: 'moved', data: { fromStatus: 'in_review', toStatus: 'in_progress' }, createdAt: 10 }),
    makeEvent({ kind: 'review', data: { verdict: 'approved', summary: 'Ship it.' }, createdAt: 20 }),
  ]);
  expect(state.pending).toBe(false);
  expect((state.summary as KanbanTaskEvent).kind).toBe('review');
});

test('getTaskReviewState: in_review with no verdict → pending', () => {
  const state = getTaskReviewState(makeTask({ status: 'in_review' }), [
    makeEvent({ kind: 'moved', data: { toStatus: 'in_review' }, createdAt: 10 }),
  ]);
  expect(state.pending).toBe(true);
  expect(state.summary).toBeNull();
});

test('getTaskReviewState: stale approval cleared after task reopened', () => {
  const state = getTaskReviewState(makeTask({ status: 'in_progress' }), [
    makeEvent({ kind: 'review', data: { verdict: 'approved', summary: 'Ship it.' }, createdAt: 10 }),
    makeEvent({ kind: 'moved', data: { fromStatus: 'done', toStatus: 'in_progress' }, createdAt: 20 }),
  ]);
  expect(state.pending).toBe(false);
  expect(state.summary).toBeNull();
});

// ── getTaskBlockerSummary ─────────────────────────────────────────────────────

test('getTaskBlockerSummary: active blocker returned', () => {
  const summary = getTaskBlockerSummary(makeTask({ status: 'in_progress' }), [
    makeEvent({ kind: 'blocker', data: { blocked: true, summary: 'Waiting on API key.' }, createdAt: 10 }),
  ]);
  expect((summary as KanbanTaskEvent).kind).toBe('blocker');
});

test('getTaskBlockerSummary: explicit clear returns null', () => {
  const summary = getTaskBlockerSummary(makeTask({ status: 'in_progress' }), [
    makeEvent({ kind: 'blocker', data: { blocked: true, summary: 'Waiting.' }, createdAt: 10 }),
    makeEvent({ kind: 'blocker', data: { blocked: false, summary: 'Arrived.' }, createdAt: 20 }),
  ]);
  expect(summary).toBeNull();
});

test('getTaskBlockerSummary: blocked status without explicit event uses moved event', () => {
  const summary = getTaskBlockerSummary(makeTask({ status: 'blocked' }), [
    makeEvent({ kind: 'moved', data: { toStatus: 'blocked', reason: 'Waiting.' }, createdAt: 10 }),
    makeEvent({ kind: 'blocker', data: { blocked: false, summary: 'Arrived.' }, createdAt: 20 }),
  ]);
  expect((summary as KanbanTaskEvent).kind).toBe('moved');
});

test('getTaskBlockerSummary: no events and non-blocked status → null', () => {
  expect(getTaskBlockerSummary(makeTask({ status: 'todo' }), [])).toBeNull();
});
