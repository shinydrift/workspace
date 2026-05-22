import { eq, and, desc, asc, inArray, ne, sql } from 'drizzle-orm';
import { getThreadsDb, getThreadsDrizzle } from './db';
import { threads, threadPromptHistory } from './schema';
import type { Thread } from '../../shared/types';

type ThreadRow = typeof threads.$inferSelect;
type ThreadInsert = typeof threads.$inferInsert;
type StoredThread = Omit<Thread, 'logBuffer' | 'pid' | 'sessionStartedAt' | 'personalityOverride'>;

const db = () => getThreadsDrizzle();

function rowToThread(row: ThreadRow): StoredThread {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    workingDirectory: row.workingDirectory,
    projectPath: row.projectPath ?? undefined,
    usingWorktree: row.usingWorktree != null ? Boolean(row.usingWorktree) : undefined,
    provider: (row.provider as Thread['provider']) ?? undefined,
    model: row.model ?? undefined,
    effort: (row.effort as Thread['effort']) ?? undefined,
    reasoning: (row.reasoning as Thread['reasoning']) ?? undefined,
    status: row.status as Thread['status'],
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    exitCode: row.exitCode ?? undefined,
    queueDepth: row.queueDepth ?? undefined,
    autopilotEnabled: row.autopilotEnabled != null ? Boolean(row.autopilotEnabled) : undefined,
    autopilotState: (row.autopilotState as Thread['autopilotState']) ?? undefined,
    autopilotLastReason: row.autopilotLastReason ?? undefined,
    autopilotConsecutiveTurns: row.autopilotConsecutiveTurns ?? undefined,
    claudeSessionId: row.claudeSessionId ?? undefined,
    codexSessionId: row.codexSessionId ?? undefined,
    geminiSessionId: row.geminiSessionId ?? undefined,
    piSessionId: row.piSessionId ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    agentRole: (row.agentRole as Thread['agentRole']) ?? undefined,
    taskId: row.taskId ?? undefined,
    skillTags: row.skillTags ? (JSON.parse(row.skillTags) as string[]) : undefined,
    parentThreadId: row.parentThreadId ?? undefined,
    councilRunId: row.councilRunId ?? undefined,
    recordingId: row.recordingId ?? undefined,
    promptHistory: [],
  };
}

function threadToInsert(t: StoredThread): ThreadInsert {
  return {
    id: t.id,
    name: t.name,
    projectId: t.projectId,
    workingDirectory: t.workingDirectory,
    projectPath: t.projectPath ?? null,
    usingWorktree: t.usingWorktree != null ? (t.usingWorktree ? 1 : 0) : null,
    provider: t.provider ?? null,
    model: t.model ?? null,
    effort: t.effort ?? null,
    reasoning: t.reasoning ?? null,
    status: t.status,
    createdAt: t.createdAt,
    lastActiveAt: t.lastActiveAt,
    exitCode: t.exitCode ?? null,
    queueDepth: t.queueDepth ?? null,
    autopilotEnabled: t.autopilotEnabled != null ? (t.autopilotEnabled ? 1 : 0) : null,
    autopilotState: t.autopilotState ?? null,
    autopilotLastReason: t.autopilotLastReason ?? null,
    autopilotConsecutiveTurns: t.autopilotConsecutiveTurns ?? null,
    claudeSessionId: t.claudeSessionId ?? null,
    codexSessionId: t.codexSessionId ?? null,
    geminiSessionId: t.geminiSessionId ?? null,
    piSessionId: t.piSessionId ?? null,
    archivedAt: t.archivedAt ?? null,
    agentRole: t.agentRole ?? null,
    taskId: t.taskId ?? null,
    skillTags: t.skillTags ? JSON.stringify(t.skillTags) : null,
    parentThreadId: t.parentThreadId ?? null,
    councilRunId: t.councilRunId ?? null,
    recordingId: t.recordingId ?? null,
  };
}

// Allow null for any persisted field, signalling "clear this column".
type ThreadUpdatePatch = {
  [K in keyof Omit<Thread, 'id' | 'logBuffer' | 'pid' | 'sessionStartedAt' | 'personalityOverride'>]?: Thread[K] | null;
};

// Persisted Thread fields that map to INTEGER boolean columns.
// Listed explicitly so a future field added with an unhandled type fails loudly below
// instead of silently passing through as the wrong column affinity.
const BOOLEAN_PATCH_KEYS: ReadonlySet<string> = new Set(['usingWorktree', 'autopilotEnabled']);

// Drizzle accepts undefined to skip a column in .set(). Convert booleans → 0/1,
// skillTags → JSON, and pass `null` through to clear nullable columns.
function patchToSet(patch: ThreadUpdatePatch): Partial<ThreadInsert> {
  const set: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'promptHistory') continue; // handled separately
    if (value === null) {
      set[key] = null;
      continue;
    }
    if (key === 'skillTags') {
      set[key] = JSON.stringify(value);
      continue;
    }
    if (BOOLEAN_PATCH_KEYS.has(key)) {
      set[key] = value ? 1 : 0;
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(
        `updateThread: unexpected value type for "${key}" (${typeof value}) — add a handler in patchToSet`
      );
    }
    set[key] = value;
  }
  return set as Partial<ThreadInsert>;
}

function replacePromptHistory(threadId: string, prompts: string[]): void {
  const raw = getThreadsDb();
  raw.prepare(`DELETE FROM thread_prompt_history WHERE thread_id = ?`).run(threadId);
  const insert = raw.prepare(`INSERT INTO thread_prompt_history (thread_id, prompt, position) VALUES (?, ?, ?)`);
  const kept = prompts.slice(-100);
  for (let i = 0; i < kept.length; i++) {
    insert.run(threadId, kept[i], i);
  }
}

export function getThread(id: string): StoredThread | null {
  const row = db().select().from(threads).where(eq(threads.id, id)).get();
  if (!row) return null;
  const thread = rowToThread(row);
  thread.promptHistory = getPromptHistory(id);
  return thread;
}

export function getAllThreads(): StoredThread[] {
  // Prompt history loaded lazily — callers that need it call getThread() or getPromptHistory().
  return db().select().from(threads).orderBy(desc(threads.lastActiveAt)).all().map(rowToThread);
}

export function getThreadsByProject(projectId: string): StoredThread[] {
  return db()
    .select()
    .from(threads)
    .where(eq(threads.projectId, projectId))
    .orderBy(desc(threads.lastActiveAt))
    .all()
    .map(rowToThread);
}

/**
 * UPSERT the thread row only. Prompt history is *not* touched — saveThread used
 * to wipe it as a side-effect of INSERT OR REPLACE + ON DELETE CASCADE, which
 * meant any caller forgetting `promptHistory` would silently erase the user's
 * prompts. Callers that need to set/clear history call `updateThread({ id,
 * promptHistory })` or `replacePromptHistory` directly.
 */
export function saveThread(thread: StoredThread): void {
  const row = threadToInsert(thread);
  const { id: _id, ...set } = row;
  db().insert(threads).values(row).onConflictDoUpdate({ target: threads.id, set }).run();
}

/**
 * Targeted UPDATE — only updates the columns present in patch.
 * Pass `null` (not `undefined`) to clear a nullable column.
 * `promptHistory` in the patch triggers a full replace of thread_prompt_history.
 * `pid`, `logBuffer`, `sessionStartedAt`, `personalityOverride` are silently ignored.
 */
export function updateThread(id: string, patch: ThreadUpdatePatch): void {
  const set = patchToSet(patch);
  const raw = getThreadsDb();
  raw.transaction(() => {
    if (Object.keys(set).length > 0) {
      db().update(threads).set(set).where(eq(threads.id, id)).run();
    }
    if (patch.promptHistory !== undefined) {
      replacePromptHistory(id, patch.promptHistory ?? []);
    }
  })();
}

/**
 * Conditional UPDATE: sets status + exitCode only when the current status differs from notStatus.
 * Returns true if the row was updated.
 * Used by setExited to avoid overwriting a user-initiated 'stopped' with a late PTY exit signal.
 */
export function updateThreadIfNotStatus(
  id: string,
  notStatus: Thread['status'],
  patch: { status: Thread['status']; exitCode?: number | null }
): boolean {
  const set: Partial<ThreadInsert> = { status: patch.status };
  if (patch.exitCode !== undefined) set.exitCode = patch.exitCode;
  const result = db()
    .update(threads)
    .set(set)
    .where(and(eq(threads.id, id), ne(threads.status, notStatus)))
    .run();
  return result.changes > 0;
}

export function deleteThread(id: string): void {
  // ON DELETE CASCADE handles thread_prompt_history
  db().delete(threads).where(eq(threads.id, id)).run();
}

/**
 * Resets all listed thread IDs to status='stopped' and provider=COALESCE(provider,'claude')
 * in a single statement. Used at startup to sanitize threads left running before app exit.
 */
export function resetToStopped(ids: string[]): void {
  if (ids.length === 0) return;
  db()
    .update(threads)
    .set({ status: 'stopped', provider: sql`COALESCE(${threads.provider}, 'claude')` })
    .where(inArray(threads.id, ids))
    .run();
}

export function getPromptHistory(threadId: string): string[] {
  return db()
    .select({ prompt: threadPromptHistory.prompt })
    .from(threadPromptHistory)
    .where(eq(threadPromptHistory.threadId, threadId))
    .orderBy(asc(threadPromptHistory.position))
    .all()
    .map((r) => r.prompt);
}

export function appendPrompt(threadId: string, prompt: string): void {
  // Position derivation and the 100-row cap are subqueries on the same table —
  // raw SQL is clearer than drizzle expression-builders here, and both run in
  // one transaction so a concurrent appender can't race the cap.
  // The cap is count-based (LIMIT (COUNT - 100)) rather than position-based
  // (`position <= MAX - 100`) so it caps to exactly 100 rows even if positions
  // ever become sparse.
  const raw = getThreadsDb();
  raw.transaction(() => {
    raw
      .prepare(
        `INSERT INTO thread_prompt_history (thread_id, prompt, position)
         VALUES (?, ?, COALESCE((SELECT MAX(position) + 1 FROM thread_prompt_history WHERE thread_id = ?), 0))`
      )
      .run(threadId, prompt, threadId);
    raw
      .prepare(
        `DELETE FROM thread_prompt_history
         WHERE thread_id = ?
           AND id IN (
             SELECT id FROM thread_prompt_history
             WHERE thread_id = ?
             ORDER BY position ASC
             LIMIT max(0, (SELECT COUNT(*) - 100 FROM thread_prompt_history WHERE thread_id = ?))
           )`
      )
      .run(threadId, threadId, threadId);
  })();
}
