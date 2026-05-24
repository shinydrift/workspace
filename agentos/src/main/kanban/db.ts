import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, asc, lt, isNotNull, isNull, count, inArray, notInArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { getProjectDb } from '../memory/db';
import * as schema from './schema';
import {
  kanbanTasks,
  kanbanTaskNotes,
  kanbanWipLimits,
  kanbanTaskEvents,
  kanbanStages,
  kanbanTaskDeps,
} from './schema';
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskEvent,
  KanbanTaskEventKind,
  KanbanTaskNote,
  KanbanTaskStatus,
  KanbanWipLimit,
  KanbanCreateRequest,
  KanbanClassOfService,
  CfdSnapshot,
} from '../../shared/types/kanban';
import { CLAUDE_EFFORT_VALUES, CODEX_REASONING_VALUES } from '../../shared/types/provider';
import type { ClaudeEffort, CodexReasoning } from '../../shared/types/provider';

const PROVISIONAL_MAIN_THREAD_ID = 'creating';

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'archived']);
export const BACKLOG_STATUS = 'backlog';
// Stage ids that are re-seeded by ensureDefaultStages or otherwise system-managed.
// Renaming away from these would silently duplicate on the next listStages() call.
export const RESERVED_STAGE_IDS: ReadonlySet<string> = new Set(['backlog', 'done', 'archived']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

const DEFAULT_STAGES: KanbanStage[] = [
  { id: 'backlog', label: 'Backlog', order: 0 },
  { id: 'researching', label: 'Researching', order: 1 },
  { id: 'planning', label: 'Planning', order: 2 },
  { id: 'implementing', label: 'Implementing', order: 3 },
  { id: 'reviewing', label: 'Reviewing', order: 4 },
  { id: 'done', label: 'Done', order: 5 },
];

const drizzleCache = new WeakMap<Database.Database, BetterSQLite3Database<typeof schema>>();

function getDb(projectId: string): BetterSQLite3Database<typeof schema> {
  const rawDb = getProjectDb(projectId);
  let db = drizzleCache.get(rawDb);
  if (!db) {
    db = drizzle(rawDb, { schema });
    drizzleCache.set(rawDb, db);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

type TaskRow = typeof kanbanTasks.$inferSelect;
type NoteRow = typeof kanbanTaskNotes.$inferSelect;
type EventRow = typeof kanbanTaskEvents.$inferSelect;
type StageRow = typeof kanbanStages.$inferSelect;

function rowToTask(row: TaskRow, blockedBy: string[] = []): KanbanTask {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status as KanbanTaskStatus,
    priority: row.priority as KanbanTask['priority'],
    progress: row.progress,
    assignedThreadId: row.assignedThreadId,
    mainThreadId: row.mainThreadId,
    skillTags: safeParseJson(row.skillTags, [] as string[]),
    branch: row.branch,
    worktreePath: row.worktreePath,
    classOfService: (row.classOfService ?? 'standard') as KanbanClassOfService,
    parentTaskId: row.parentTaskId,
    dueAt: row.dueAt ?? null,
    slackChannelId: row.slackChannelId ?? null,
    slackThreadTs: row.slackThreadTs ?? null,
    blockedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    metadata: safeParseJson(row.metadata, {} as Record<string, unknown>),
  };
}

function rowToTaskEvent(row: EventRow): KanbanTaskEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    threadId: row.threadId,
    kind: row.kind as KanbanTaskEventKind,
    data: safeParseJson(row.data, {} as Record<string, unknown>),
    createdAt: row.createdAt,
  };
}

function rowToStage(row: StageRow): KanbanStage {
  return {
    id: row.id,
    label: row.label,
    order: row.stageOrder,
    prompt: row.prompt || undefined,
    provider: (row.provider || undefined) as KanbanStage['provider'],
    model: row.model || undefined,
    effort: CLAUDE_EFFORT_VALUES.includes(row.effort as ClaudeEffort) ? (row.effort as ClaudeEffort) : undefined,
    reasoning: CODEX_REASONING_VALUES.includes(row.reasoning as CodexReasoning)
      ? (row.reasoning as CodexReasoning)
      : undefined,
    saveToMemory: row.saveToMemory ?? false,
  };
}

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

export function createTask(req: KanbanCreateRequest): KanbanTask {
  const db = getDb(req.projectId);
  const now = Date.now();
  const id = nanoid();
  const status = req.status ?? BACKLOG_STATUS;
  const priority = (req.priority ?? 'medium') as KanbanTask['priority'];
  const skillTags = req.skillTags ?? [];
  const classOfService: KanbanClassOfService = req.classOfService ?? 'standard';
  const dueAt = req.dueAt ?? null;
  const slackChannelId = req.slackChannelId ?? null;
  const slackThreadTs = req.slackThreadTs ?? null;

  db.insert(kanbanTasks)
    .values({
      id,
      projectId: req.projectId,
      title: req.title,
      description: req.description ?? '',
      status,
      priority,
      progress: 0,
      skillTags: JSON.stringify(skillTags),
      classOfService,
      parentTaskId: req.parentTaskId ?? null,
      dueAt,
      slackChannelId,
      slackThreadTs,
      createdAt: now,
      updatedAt: now,
      metadata: '{}',
    })
    .run();

  return {
    id,
    projectId: req.projectId,
    title: req.title,
    description: req.description ?? '',
    status,
    priority,
    progress: 0,
    assignedThreadId: null,
    mainThreadId: null,
    skillTags,
    branch: null,
    worktreePath: null,
    classOfService,
    parentTaskId: req.parentTaskId ?? null,
    dueAt,
    slackChannelId,
    slackThreadTs,
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    metadata: {},
  };
}

export function getTask(projectId: string, taskId: string): KanbanTask | null {
  const db = getDb(projectId);
  const row = db
    .select()
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .get();
  if (!row) return null;
  const blockedBy = db
    .select({ blocksId: kanbanTaskDeps.blocksId })
    .from(kanbanTaskDeps)
    .where(and(eq(kanbanTaskDeps.projectId, projectId), eq(kanbanTaskDeps.taskId, taskId)))
    .all()
    .map((r) => r.blocksId);
  return rowToTask(row, blockedBy);
}

export function listTasks(projectId: string, status?: KanbanTaskStatus): KanbanTask[] {
  const db = getDb(projectId);
  const rows = status
    ? db
        .select()
        .from(kanbanTasks)
        .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.status, status)))
        .orderBy(asc(kanbanTasks.createdAt))
        .all()
    : db
        .select()
        .from(kanbanTasks)
        .where(eq(kanbanTasks.projectId, projectId))
        .orderBy(asc(kanbanTasks.createdAt))
        .all();

  // Bulk-fetch all deps for this project to avoid N+1 queries
  const depRows = db
    .select({ taskId: kanbanTaskDeps.taskId, blocksId: kanbanTaskDeps.blocksId })
    .from(kanbanTaskDeps)
    .where(eq(kanbanTaskDeps.projectId, projectId))
    .all();
  const depsMap = new Map<string, string[]>();
  for (const dep of depRows) {
    let list = depsMap.get(dep.taskId);
    if (!list) {
      list = [];
      depsMap.set(dep.taskId, list);
    }
    list.push(dep.blocksId);
  }
  return rows.map((row) => rowToTask(row, depsMap.get(row.id) ?? []));
}

export function moveTask(projectId: string, taskId: string, newStatus: KanbanTaskStatus): KanbanTask | null {
  const db = getDb(projectId);
  const now = Date.now();
  const completedAt = TERMINAL_STATUSES.has(newStatus) ? now : null;
  const row = db
    .update(kanbanTasks)
    .set({ status: newStatus, updatedAt: now, completedAt })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .returning()
    .get();
  if (!row) return null;
  const blockedBy = getDependencies(projectId, taskId);
  return rowToTask(row, blockedBy);
}

/**
 * Atomically checks the WIP limit and moves the task within a single transaction,
 * preventing the TOCTOU race where two concurrent agents both pass the limit check.
 * Throws if the WIP limit would be exceeded.
 */
export function moveTaskAtomic(
  projectId: string,
  taskId: string,
  newStatus: KanbanTaskStatus,
  maxAllowed?: number
): KanbanTask | null {
  const db = getDb(projectId);
  return db.transaction((tx) => {
    if (maxAllowed !== undefined) {
      // Exclude blocked tasks (have dep entries) — they don't count against WIP.
      // NOT EXISTS avoids materialising all blocked IDs into a JS array.
      const result = tx
        .select({ n: count() })
        .from(kanbanTasks)
        .where(
          and(
            eq(kanbanTasks.projectId, projectId),
            eq(kanbanTasks.status, newStatus),
            sql`NOT EXISTS (SELECT 1 FROM kanban_task_deps WHERE project_id = ${projectId} AND task_id = kanban_tasks.id)`
          )
        )
        .get();
      const n = result?.n ?? 0;
      if (n >= maxAllowed) {
        throw new Error(`WIP limit reached for column "${newStatus}" (${n}/${maxAllowed})`);
      }
    }
    const now = Date.now();
    const completedAt = TERMINAL_STATUSES.has(newStatus) ? now : null;
    const row = tx
      .update(kanbanTasks)
      .set({ status: newStatus, updatedAt: now, completedAt })
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
      .returning()
      .get();
    if (!row) return null;
    const blockedBy = getDependencies(projectId, taskId);
    return rowToTask(row, blockedBy);
  });
}

export function updateTaskPriority(
  projectId: string,
  taskId: string,
  priority: KanbanTask['priority']
): KanbanTask | null {
  const row = getDb(projectId)
    .update(kanbanTasks)
    .set({ priority, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .returning()
    .get();
  return row ? rowToTask(row) : null;
}

export function updateTaskDescription(projectId: string, taskId: string, description: string): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ description, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function updateProgress(projectId: string, taskId: string, progress: number): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ progress: Math.max(0, Math.min(100, progress)), updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function assignTask(projectId: string, taskId: string, threadId: string | null): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ assignedThreadId: threadId, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function updateTaskSlack(projectId: string, taskId: string, channelId: string, threadTs: string): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ slackChannelId: channelId, slackThreadTs: threadTs, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function setTaskMainThread(projectId: string, taskId: string, mainThreadId: string | null): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ mainThreadId, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function listTasksByMainThread(projectId: string, mainThreadId: string): KanbanTask[] {
  return getDb(projectId)
    .select()
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.mainThreadId, mainThreadId)))
    .all()
    .map((row) => rowToTask(row));
}

export function hasActiveStageWorker(projectId: string, mainThreadId: string): boolean {
  const row = getDb(projectId)
    .select({ id: kanbanTasks.id })
    .from(kanbanTasks)
    .where(
      and(
        eq(kanbanTasks.projectId, projectId),
        eq(kanbanTasks.mainThreadId, mainThreadId),
        isNotNull(kanbanTasks.assignedThreadId)
      )
    )
    .limit(1)
    .get();
  return row != null;
}

export function updateTaskWorktree(
  projectId: string,
  taskId: string,
  branch: string | null,
  worktreePath: string | null
): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ branch, worktreePath, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function setTaskDueDate(projectId: string, taskId: string, dueAt: number | null): KanbanTask | null {
  const row = getDb(projectId)
    .update(kanbanTasks)
    .set({ dueAt, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .returning()
    .get();
  return row ? rowToTask(row) : null;
}

export function listOverdueTasks(projectId: string): KanbanTask[] {
  const now = Date.now();
  return getDb(projectId)
    .select()
    .from(kanbanTasks)
    .where(
      and(
        eq(kanbanTasks.projectId, projectId),
        isNotNull(kanbanTasks.dueAt),
        lt(kanbanTasks.dueAt, now),
        notInArray(kanbanTasks.status, ['done', 'archived'])
      )
    )
    .orderBy(asc(kanbanTasks.dueAt))
    .all()
    .map((row) => rowToTask(row));
}

export function updateTaskClassOfService(
  projectId: string,
  taskId: string,
  classOfService: KanbanClassOfService
): KanbanTask | null {
  const row = getDb(projectId)
    .update(kanbanTasks)
    .set({ classOfService, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .returning()
    .get();
  if (!row) return null;
  const blockedBy = getDependencies(projectId, taskId);
  return rowToTask(row, blockedBy);
}

export function updateTaskMetadata(projectId: string, taskId: string, metadata: Record<string, unknown>): void {
  getDb(projectId)
    .update(kanbanTasks)
    .set({ metadata: JSON.stringify(metadata), updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
    .run();
}

export function deleteTask(projectId: string, taskId: string): void {
  const db = getDb(projectId);
  db.transaction((tx) => {
    tx.update(kanbanTasks)
      .set({ parentTaskId: null, updatedAt: Date.now() })
      .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.parentTaskId, taskId)))
      .run();
    tx.delete(kanbanTasks)
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
      .run();
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function addNote(projectId: string, taskId: string, content: string, threadId?: string): KanbanTaskNote {
  const id = nanoid();
  const now = Date.now();
  getDb(projectId)
    .insert(kanbanTaskNotes)
    .values({ id, taskId, threadId: threadId ?? null, content, createdAt: now })
    .run();
  return { id, taskId, threadId: threadId ?? null, content, createdAt: now };
}

export function getNotes(projectId: string, taskId: string): KanbanTaskNote[] {
  return getDb(projectId)
    .select()
    .from(kanbanTaskNotes)
    .where(eq(kanbanTaskNotes.taskId, taskId))
    .orderBy(asc(kanbanTaskNotes.createdAt))
    .all()
    .map((r: NoteRow) => ({
      id: r.id,
      taskId: r.taskId,
      threadId: r.threadId,
      content: r.content,
      createdAt: r.createdAt,
    }));
}

export function addTaskEvent(
  projectId: string,
  taskId: string,
  kind: KanbanTaskEventKind,
  data: Record<string, unknown> = {},
  threadId?: string
): KanbanTaskEvent {
  const id = nanoid();
  const now = Date.now();
  getDb(projectId)
    .insert(kanbanTaskEvents)
    .values({ id, projectId, taskId, threadId: threadId ?? null, kind, data: JSON.stringify(data), createdAt: now })
    .run();
  return { id, projectId, taskId, threadId: threadId ?? null, kind, data, createdAt: now };
}

export function listTaskEvents(projectId: string, taskId: string): KanbanTaskEvent[] {
  return getDb(projectId)
    .select()
    .from(kanbanTaskEvents)
    .where(and(eq(kanbanTaskEvents.projectId, projectId), eq(kanbanTaskEvents.taskId, taskId)))
    .orderBy(asc(kanbanTaskEvents.createdAt))
    .all()
    .map(rowToTaskEvent);
}

export function deleteNoteEvent(projectId: string, eventId: string): void {
  const db = getDb(projectId);
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(kanbanTaskEvents)
      .where(and(eq(kanbanTaskEvents.id, eventId), eq(kanbanTaskEvents.projectId, projectId)))
      .get();
    if (!row || row.kind !== 'note') return;
    const data = safeParseJson(row.data, {} as Record<string, unknown>);
    tx.delete(kanbanTaskEvents).where(eq(kanbanTaskEvents.id, eventId)).run();
    if (typeof data.noteId === 'string') {
      tx.delete(kanbanTaskNotes).where(eq(kanbanTaskNotes.id, data.noteId)).run();
    }
  });
}

export function editNoteEvent(projectId: string, eventId: string, newText: string): KanbanTaskEvent | null {
  const db = getDb(projectId);
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(kanbanTaskEvents)
      .where(and(eq(kanbanTaskEvents.id, eventId), eq(kanbanTaskEvents.projectId, projectId)))
      .get();
    if (!row || row.kind !== 'note') return null;
    const data = safeParseJson(row.data, {} as Record<string, unknown>);
    const newData = JSON.stringify({ ...data, content: newText });
    tx.update(kanbanTaskEvents).set({ data: newData }).where(eq(kanbanTaskEvents.id, eventId)).run();
    if (typeof data.noteId === 'string') {
      tx.update(kanbanTaskNotes).set({ content: newText }).where(eq(kanbanTaskNotes.id, data.noteId)).run();
    }
    return rowToTaskEvent({ ...row, data: newData });
  });
}

// ---------------------------------------------------------------------------
// WIP limits
// ---------------------------------------------------------------------------

export function getWipLimits(projectId: string): KanbanWipLimit[] {
  return getDb(projectId)
    .select()
    .from(kanbanWipLimits)
    .where(eq(kanbanWipLimits.projectId, projectId))
    .all()
    .map((r) => ({ projectId: r.projectId, status: r.status as KanbanTaskStatus, maxTasks: r.maxTasks }));
}

export function setWipLimit(projectId: string, status: KanbanTaskStatus, maxTasks: number): void {
  getDb(projectId)
    .insert(kanbanWipLimits)
    .values({ projectId, status, maxTasks })
    .onConflictDoUpdate({ target: [kanbanWipLimits.projectId, kanbanWipLimits.status], set: { maxTasks } })
    .run();
}

export function listSubtasks(projectId: string, parentTaskId: string): KanbanTask[] {
  return getDb(projectId)
    .select()
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.parentTaskId, parentTaskId)))
    .orderBy(asc(kanbanTasks.createdAt))
    .all()
    .map((row) => rowToTask(row));
}

/** Returns the main_thread_id for a task without fetching the full row. */
export function getTaskMainThreadId(projectId: string, taskId: string): string | null {
  const row = getDb(projectId)
    .select({ mainThreadId: kanbanTasks.mainThreadId })
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.id, taskId)))
    .get();
  return row?.mainThreadId ?? null;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** Returns the task IDs that `taskId` is blocked by. */
export function getDependencies(projectId: string, taskId: string): string[] {
  return getDb(projectId)
    .select({ blocksId: kanbanTaskDeps.blocksId })
    .from(kanbanTaskDeps)
    .where(and(eq(kanbanTaskDeps.projectId, projectId), eq(kanbanTaskDeps.taskId, taskId)))
    .all()
    .map((r) => r.blocksId);
}

/** Returns the task IDs that are blocked by `blocksId`. */
export function getDependents(projectId: string, blocksId: string): string[] {
  return getDb(projectId)
    .select({ taskId: kanbanTaskDeps.taskId })
    .from(kanbanTaskDeps)
    .where(and(eq(kanbanTaskDeps.projectId, projectId), eq(kanbanTaskDeps.blocksId, blocksId)))
    .all()
    .map((r) => r.taskId);
}

/**
 * Records that `taskId` is blocked by `blocksId`.
 * Rejects self-references and cycles (single recursive CTE — one DB round-trip).
 */
export function addDependency(projectId: string, taskId: string, blocksId: string): void {
  if (taskId === blocksId) throw new Error('A task cannot depend on itself.');
  const rawDb = getProjectDb(projectId);
  const hasCycle = rawDb
    .prepare(
      `WITH RECURSIVE chain(id) AS (
         SELECT blocks_id FROM kanban_task_deps WHERE project_id = ? AND task_id = ?
         UNION
         SELECT d.blocks_id FROM kanban_task_deps d JOIN chain c ON d.task_id = c.id WHERE d.project_id = ?
       )
       SELECT 1 FROM chain WHERE id = ? LIMIT 1`
    )
    .get(projectId, blocksId, projectId, taskId);
  if (hasCycle) throw new Error('Adding this dependency would create a cycle.');
  getDb(projectId).insert(kanbanTaskDeps).values({ projectId, taskId, blocksId }).onConflictDoNothing().run();
}

/** Removes the dependency record (task_id blocked by blocks_id). No-op if absent. */
export function removeDependency(projectId: string, taskId: string, blocksId: string): void {
  getDb(projectId)
    .delete(kanbanTaskDeps)
    .where(
      and(
        eq(kanbanTaskDeps.projectId, projectId),
        eq(kanbanTaskDeps.taskId, taskId),
        eq(kanbanTaskDeps.blocksId, blocksId)
      )
    )
    .run();
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export function listStages(projectId: string): KanbanStage[] {
  return getDb(projectId)
    .select()
    .from(kanbanStages)
    .where(eq(kanbanStages.projectId, projectId))
    .orderBy(asc(kanbanStages.stageOrder))
    .all()
    .map((row) => {
      const stage = rowToStage(row);
      if (TERMINAL_STATUSES.has(stage.id)) stage.terminal = true;
      return stage;
    });
}

export function upsertStage(projectId: string, stage: KanbanStage): void {
  getDb(projectId)
    .insert(kanbanStages)
    .values({
      projectId,
      stageOrder: stage.order,
      id: stage.id,
      label: stage.label,
      prompt: stage.prompt ?? '',
      provider: stage.provider ?? null,
      model: stage.model ?? null,
      effort: stage.effort ?? null,
      reasoning: stage.reasoning ?? null,
      saveToMemory: stage.saveToMemory ?? false,
    })
    .onConflictDoUpdate({
      target: [kanbanStages.projectId, kanbanStages.id],
      set: {
        stageOrder: stage.order,
        label: stage.label,
        prompt: stage.prompt ?? '',
        provider: stage.provider ?? null,
        model: stage.model ?? null,
        effort: stage.effort ?? null,
        reasoning: stage.reasoning ?? null,
        saveToMemory: stage.saveToMemory ?? false,
      },
    })
    .run();
}

export function renameStage(projectId: string, oldId: string, newId: string, overrides?: Partial<KanbanStage>): void {
  if (oldId === newId) return;
  if (RESERVED_STAGE_IDS.has(oldId)) {
    throw new Error(`Cannot rename system-managed stage "${oldId}" — it is re-seeded automatically.`);
  }
  if (RESERVED_STAGE_IDS.has(newId)) {
    throw new Error(`Cannot rename to reserved system id "${newId}".`);
  }
  if (!newId.trim()) {
    throw new Error('New stage id is empty.');
  }
  const db = getDb(projectId);
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(kanbanStages)
      .where(and(eq(kanbanStages.projectId, projectId), eq(kanbanStages.id, oldId)))
      .get();
    if (!existing) {
      throw new Error(`Stage "${oldId}" does not exist for project ${projectId}.`);
    }
    const collision = tx
      .select({ id: kanbanStages.id })
      .from(kanbanStages)
      .where(and(eq(kanbanStages.projectId, projectId), eq(kanbanStages.id, newId)))
      .get();
    if (collision) {
      throw new Error(`Stage id "${newId}" already exists for project ${projectId}.`);
    }
    const merged = {
      ...existing,
      id: newId,
      ...(overrides?.label !== undefined ? { label: overrides.label } : {}),
      ...(overrides?.order !== undefined ? { stageOrder: overrides.order } : {}),
      ...(overrides?.prompt !== undefined ? { prompt: overrides.prompt ?? '' } : {}),
      ...(overrides?.provider !== undefined ? { provider: overrides.provider ?? null } : {}),
      ...(overrides?.model !== undefined ? { model: overrides.model ?? null } : {}),
      ...(overrides?.effort !== undefined ? { effort: overrides.effort ?? null } : {}),
      ...(overrides?.reasoning !== undefined ? { reasoning: overrides.reasoning ?? null } : {}),
      ...(overrides?.saveToMemory !== undefined ? { saveToMemory: overrides.saveToMemory } : {}),
    };
    tx.insert(kanbanStages).values(merged).run();
    tx.update(kanbanTasks)
      .set({ status: newId })
      .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.status, oldId)))
      .run();
    // wip_limits PK is (project_id, status); collision guard above ensures no row at newId.
    tx.update(kanbanWipLimits)
      .set({ status: newId })
      .where(and(eq(kanbanWipLimits.projectId, projectId), eq(kanbanWipLimits.status, oldId)))
      .run();
    tx.delete(kanbanStages)
      .where(and(eq(kanbanStages.projectId, projectId), eq(kanbanStages.id, oldId)))
      .run();
  });
}

export function ensureDefaultStages(projectId: string): KanbanStage[] {
  const db = getDb(projectId);
  const result = db.select({ n: count() }).from(kanbanStages).where(eq(kanbanStages.projectId, projectId)).get();
  db.transaction((tx) => {
    if ((result?.n ?? 0) === 0) {
      // New project: seed all default stages.
      for (const s of DEFAULT_STAGES) {
        tx.insert(kanbanStages)
          .values({
            projectId,
            stageOrder: s.order,
            id: s.id,
            label: s.label,
            prompt: '',
            provider: null,
            model: null,
          })
          .onConflictDoNothing()
          .run();
      }
    } else {
      // Existing project: ensure backlog stage exists (migration for projects created before backlog was added).
      // Use stageOrder -1 so it sorts before the existing stages without renumbering them.
      tx.insert(kanbanStages)
        .values({
          projectId,
          stageOrder: -1,
          id: BACKLOG_STATUS,
          label: 'Backlog',
          prompt: '',
          provider: null,
          model: null,
        })
        .onConflictDoNothing()
        .run();
    }
  });
  return listStages(projectId);
}

export function deleteStage(projectId: string, stageId: string): void {
  getDb(projectId)
    .delete(kanbanStages)
    .where(and(eq(kanbanStages.projectId, projectId), eq(kanbanStages.id, stageId)))
    .run();
}

export function getStageByStatus(projectId: string, status: string): KanbanStage | null {
  const row = getDb(projectId)
    .select()
    .from(kanbanStages)
    .where(and(eq(kanbanStages.projectId, projectId), eq(kanbanStages.id, status)))
    .get();
  return row ? rowToStage(row) : null;
}

/**
 * Atomically claims the main-thread slot for a task. Returns true only if this call
 * was the one to set main_thread_id (i.e. it was null before). Prevents duplicate
 * orchestrators from spawning when events fire concurrently or on reconcile races.
 */
export function claimTaskMainThread(projectId: string, taskId: string): boolean {
  const row = getDb(projectId)
    .update(kanbanTasks)
    .set({ mainThreadId: PROVISIONAL_MAIN_THREAD_ID, updatedAt: Date.now() })
    .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId), isNull(kanbanTasks.mainThreadId)))
    .returning({ id: kanbanTasks.id })
    .get();
  return row != null;
}

export { PROVISIONAL_MAIN_THREAD_ID };

/** Returns only tasks that have at least one unresolved dependency. */
export function getBlockedTasksFromDb(projectId: string): KanbanTask[] {
  const db = getDb(projectId);
  const depRows = db
    .select({ taskId: kanbanTaskDeps.taskId, blocksId: kanbanTaskDeps.blocksId })
    .from(kanbanTaskDeps)
    .where(eq(kanbanTaskDeps.projectId, projectId))
    .all();
  if (depRows.length === 0) return [];
  // inArray generates IN (...) — safe up to SQLite's default 999-parameter limit.
  // Boards would need >999 simultaneously blocked tasks to hit this; fine in practice.
  const blockedIds = [...new Set(depRows.map((d) => d.taskId))];
  const depsMap = new Map<string, string[]>();
  for (const dep of depRows) {
    let list = depsMap.get(dep.taskId);
    if (!list) {
      list = [];
      depsMap.set(dep.taskId, list);
    }
    list.push(dep.blocksId);
  }
  return db
    .select()
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.projectId, projectId), inArray(kanbanTasks.id, blockedIds)))
    .all()
    .map((row) => rowToTask(row, depsMap.get(row.id) ?? []));
}

/** Atomically merges `patch` into a task's metadata JSON. */
export function patchTaskMetadata(
  projectId: string,
  taskId: string,
  patch: Record<string, unknown>
): KanbanTask | null {
  const db = getDb(projectId);
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(kanbanTasks)
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
      .get();
    if (!row) return null;
    const current = safeParseJson(row.metadata, {} as Record<string, unknown>);
    const merged = { ...current, ...patch };
    const updated = tx
      .update(kanbanTasks)
      .set({ metadata: JSON.stringify(merged), updatedAt: Date.now() })
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.projectId, projectId)))
      .returning()
      .get();
    return updated ? rowToTask(updated) : null;
  });
}

export function countTasksInStatus(projectId: string, status: KanbanTaskStatus): number {
  const result = getDb(projectId)
    .select({ n: count() })
    .from(kanbanTasks)
    .where(and(eq(kanbanTasks.projectId, projectId), eq(kanbanTasks.status, status)))
    .get();
  return result?.n ?? 0;
}

export function listTasksDoneOlderThan(projectId: string, cutoffMs: number): KanbanTask[] {
  return getDb(projectId)
    .select()
    .from(kanbanTasks)
    .where(
      and(
        eq(kanbanTasks.projectId, projectId),
        eq(kanbanTasks.status, 'done'),
        isNotNull(kanbanTasks.completedAt),
        lt(kanbanTasks.completedAt, cutoffMs)
      )
    )
    .all()
    .map((row) => rowToTask(row));
}

// ---------------------------------------------------------------------------
// CFD data
// ---------------------------------------------------------------------------

export function getCfdData(projectId: string, days: number): CfdSnapshot[] {
  const db = getDb(projectId);
  const nowMs = Date.now();

  // All tasks that exist now (excludes hard-deleted tasks — acceptable for CFD purposes)
  const tasks = db
    .select({ id: kanbanTasks.id, status: kanbanTasks.status, createdAt: kanbanTasks.createdAt })
    .from(kanbanTasks)
    .where(eq(kanbanTasks.projectId, projectId))
    .all();

  // Initial status per task from 'created' events
  const createdRows = db
    .select({ taskId: kanbanTaskEvents.taskId, data: kanbanTaskEvents.data })
    .from(kanbanTaskEvents)
    .where(and(eq(kanbanTaskEvents.projectId, projectId), eq(kanbanTaskEvents.kind, 'created')))
    .all();
  const initialStatus = new Map<string, string>();
  for (const row of createdRows) {
    const d = JSON.parse(row.data) as { status?: string };
    initialStatus.set(row.taskId, d.status ?? 'researching');
  }

  // All move events ordered ascending
  const moveRows = db
    .select({ taskId: kanbanTaskEvents.taskId, data: kanbanTaskEvents.data, createdAt: kanbanTaskEvents.createdAt })
    .from(kanbanTaskEvents)
    .where(and(eq(kanbanTaskEvents.projectId, projectId), eq(kanbanTaskEvents.kind, 'moved')))
    .orderBy(asc(kanbanTaskEvents.createdAt))
    .all();

  // Build per-task move timeline: [{ts, toStatus}]
  const timelines = new Map<string, Array<{ ts: number; toStatus: string }>>();
  for (const row of moveRows) {
    const d = JSON.parse(row.data) as { toStatus: string };
    if (!timelines.has(row.taskId)) timelines.set(row.taskId, []);
    timelines.get(row.taskId)!.push({ ts: row.createdAt, toStatus: d.toStatus });
  }

  // For each day in [now - (days-1) days, today], produce a snapshot at end-of-day
  const snapshots: CfdSnapshot[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const eod = new Date(nowMs);
    eod.setDate(eod.getDate() - i);
    eod.setHours(23, 59, 59, 999);
    const eodMs = eod.getTime();

    const sod = new Date(eodMs);
    sod.setHours(0, 0, 0, 0);
    const sodMs = sod.getTime();

    const counts: Record<string, number> = {};
    for (const task of tasks) {
      if (task.createdAt > eodMs) continue; // not yet created on this day
      const moves = timelines.get(task.id) ?? [];
      const pastMoves = moves.filter((m) => m.ts <= eodMs);
      const status =
        pastMoves.length > 0 ? pastMoves[pastMoves.length - 1].toStatus : (initialStatus.get(task.id) ?? task.status);
      counts[status] = (counts[status] ?? 0) + 1;
    }

    snapshots.push({ date: sodMs, counts });
  }

  return snapshots;
}
