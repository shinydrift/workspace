import type { Thread } from '../../../shared/types';
import type { KanbanTask, KanbanTaskEvent } from '../../../shared/types/kanban';

// Threads eligible to be assigned as the kanban agent for a task: same project,
// has an agentRole, not a sub-thread (council members + stage workers carry
// parentThreadId and would otherwise leak into the picker), not archived.
export function listAssignableAgentThreads(threads: Record<string, Thread>, projectId: string): Thread[] {
  return Object.values(threads).filter(
    (t) => t.projectId === projectId && !!t.agentRole && !t.parentThreadId && t.status !== 'archived'
  );
}

export function matchesAgentQuery(thread: Thread, query: string): boolean {
  if (query === '') return true;
  const q = query.toLowerCase();
  return thread.name.toLowerCase().includes(q) || (thread.agentRole ?? '').toLowerCase().includes(q);
}

export function getTaskActorLabel(event: KanbanTaskEvent, threads: Record<string, Thread>): string {
  if (!event.threadId) return 'manual';
  const eventThread = threads[event.threadId];
  if (!eventThread) return `thread ${event.threadId.slice(0, 8)}`;
  if (eventThread.agentRole && eventThread.name) return `${eventThread.agentRole} · ${eventThread.name}`;
  return eventThread.agentRole ?? eventThread.name ?? `thread ${event.threadId.slice(0, 8)}`;
}

// One-line title + optional body for a task event, used by activity views.
export function describeTaskEvent(event: KanbanTaskEvent): { title: string; body?: string } {
  const data = event.data;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  switch (event.kind) {
    case 'created':
      return { title: 'Task created' };
    case 'assigned':
      return { title: 'Task assigned' };
    case 'moved': {
      const from = String(data.fromStatus ?? 'unknown');
      const to = String(data.toStatus ?? 'unknown');
      return { title: `${from} -> ${to}`, body: str(data.reason) };
    }
    case 'progress': {
      const pct = typeof data.progress === 'number' ? `${data.progress}%` : 'updated';
      return { title: `Progress ${pct}`, body: str(data.note) };
    }
    case 'review':
      return { title: data.verdict === 'approved' ? 'Review Approved' : 'Changes Requested', body: str(data.summary) };
    case 'blocker':
      return { title: data.blocked === false ? 'Blocker cleared' : 'Blocked', body: str(data.summary) };
    default:
      return { title: 'Comment', body: str(data.content) };
  }
}

export function getTaskReviewState(task: KanbanTask | null, events: KanbanTaskEvent[]) {
  const reversedEvents = [...events].reverse();
  const latestReviewVerdict = reversedEvents.find((event) => event.kind === 'review') ?? null;
  const latestReviewEntry = reversedEvents.find(
    (event) => event.kind === 'moved' && event.data.toStatus === 'in_review'
  );
  const latestReviewExit = reversedEvents.find(
    (event) =>
      event.kind === 'moved' &&
      event.data.fromStatus === 'in_review' &&
      (event.data.toStatus === 'done' || event.data.toStatus === 'in_progress')
  );
  const latestMoveAfterVerdict = latestReviewVerdict
    ? (reversedEvents.find((event) => event.kind === 'moved' && event.createdAt > latestReviewVerdict.createdAt) ??
      null)
    : null;
  const effectiveReviewVerdict =
    latestReviewVerdict?.data.verdict === 'approved' &&
    latestMoveAfterVerdict &&
    latestMoveAfterVerdict.data.toStatus !== 'done'
      ? null
      : latestReviewVerdict;
  const pending =
    task?.status === 'in_review' &&
    (!effectiveReviewVerdict ||
      (!!latestReviewEntry && latestReviewEntry.createdAt > effectiveReviewVerdict.createdAt));

  return {
    pending,
    summary: pending ? null : (effectiveReviewVerdict ?? latestReviewExit ?? null),
  };
}

export function getTaskBlockerSummary(task: KanbanTask | null, events: KanbanTaskEvent[]) {
  const latestBlockerEvent = [...events].reverse().find((event) => event.kind === 'blocker') ?? null;
  if (latestBlockerEvent) {
    if (latestBlockerEvent.data.blocked === false && task?.status !== 'blocked') return null;
    if (latestBlockerEvent.data.blocked !== false) return latestBlockerEvent;
  }
  if (task?.status !== 'blocked') return null;
  return [...events].reverse().find((event) => event.kind === 'moved' && event.data.toStatus === 'blocked') ?? null;
}
