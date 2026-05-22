import { eq, and, desc, sql, count, isNotNull } from 'drizzle-orm';
import { getCouncilDrizzle } from './councilDb';
import { councilRuns, councilOutcomes, councilChildMembers, councilRunMembers } from './schema';
import type {
  CouncilRun,
  CouncilOutcomeRecord,
  CouncilMember,
  CouncilOutcomePayload,
} from '../../shared/types/council';

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

type RunRow = typeof councilRuns.$inferSelect;
type OutcomeRow = typeof councilOutcomes.$inferSelect;
type RunMemberDbRow = typeof councilRunMembers.$inferSelect;

function rowToRun(row: RunRow): CouncilRun {
  return {
    id: row.id,
    configId: row.configId,
    parentThreadId: row.parentThreadId,
    prompt: row.prompt,
    childThreadIds: [], // derived from council_run_members — populated by getRun/getRunsByThread
    status: row.status as CouncilRun['status'],
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
  };
}

function getChildThreadIds(runId: string): string[] {
  return getCouncilDrizzle()
    .select({ childThreadId: councilRunMembers.childThreadId })
    .from(councilRunMembers)
    .where(and(eq(councilRunMembers.runId, runId), isNotNull(councilRunMembers.childThreadId)))
    .orderBy(councilRunMembers.memberIdx)
    .all()
    .flatMap((r) => (r.childThreadId ? [r.childThreadId] : []));
}

export function saveRun(run: CouncilRun): void {
  getCouncilDrizzle()
    .insert(councilRuns)
    .values({
      id: run.id,
      configId: run.configId,
      parentThreadId: run.parentThreadId,
      prompt: run.prompt,
      childThreadIds: JSON.stringify(run.childThreadIds),
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? null,
      expiresAt: run.expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: councilRuns.id,
      set: {
        configId: run.configId,
        parentThreadId: run.parentThreadId,
        prompt: run.prompt,
        childThreadIds: JSON.stringify(run.childThreadIds),
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? null,
        expiresAt: run.expiresAt ?? null,
      },
    })
    .run();
}

export function updateRun(runId: string, updates: { status?: string; completedAt?: number; expiresAt?: number }): void {
  const set: { status?: string; completedAt?: number | null; expiresAt?: number | null } = {};
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.completedAt !== undefined) set.completedAt = updates.completedAt;
  if (updates.expiresAt !== undefined) set.expiresAt = updates.expiresAt;
  if (Object.keys(set).length === 0) return;
  getCouncilDrizzle().update(councilRuns).set(set).where(eq(councilRuns.id, runId)).run();
}

/**
 * Atomically marks a run done only when all its members are in a terminal
 * state. Returns true if the UPDATE changed a row (i.e. the run just became
 * done), false if it was already done or members are still running.
 */
export function markRunDoneIfTerminal(runId: string, completedAt: number): boolean {
  const result = getCouncilDrizzle().run(
    sql`UPDATE council_runs
        SET status = 'done', completed_at = ${completedAt}
        WHERE id = ${runId}
          AND status <> 'done'
          AND NOT EXISTS (
            SELECT 1 FROM council_run_members
            WHERE run_id = ${runId}
              AND status NOT IN ('submitted', 'invalid', 'error', 'timeout')
          )`
  );
  return result.changes > 0;
}

export function getRun(runId: string): CouncilRun | null {
  const row = getCouncilDrizzle().select().from(councilRuns).where(eq(councilRuns.id, runId)).get();
  if (!row) return null;
  const run = rowToRun(row);
  run.childThreadIds = getChildThreadIds(runId);
  return run;
}

export function getRunsByThread(parentThreadId: string): CouncilRun[] {
  return getCouncilDrizzle()
    .select()
    .from(councilRuns)
    .where(eq(councilRuns.parentThreadId, parentThreadId))
    .orderBy(desc(councilRuns.createdAt))
    .all()
    .map((row) => {
      const run = rowToRun(row);
      run.childThreadIds = getChildThreadIds(row.id);
      return run;
    });
}

export function getActiveRuns(): CouncilRun[] {
  return getCouncilDrizzle()
    .select()
    .from(councilRuns)
    .where(sql`${councilRuns.status} IN ('running', 'pending')`)
    .all()
    .map(rowToRun);
}

export function hasActiveRunForThread(parentThreadId: string): boolean {
  const row = getCouncilDrizzle()
    .select({ cnt: count() })
    .from(councilRuns)
    .where(and(eq(councilRuns.parentThreadId, parentThreadId), sql`${councilRuns.status} IN ('running', 'pending')`))
    .get();
  return (row?.cnt ?? 0) > 0;
}

export function hasActiveRunForConfig(configId: string): boolean {
  const row = getCouncilDrizzle()
    .select({ cnt: count() })
    .from(councilRuns)
    .where(and(eq(councilRuns.configId, configId), sql`${councilRuns.status} IN ('running', 'pending')`))
    .get();
  return (row?.cnt ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function rowToOutcome(row: OutcomeRow): CouncilOutcomeRecord {
  const hasSummary = typeof row.summary === 'string';
  const outcome: CouncilOutcomePayload | undefined = hasSummary
    ? {
        summary: row.summary as string,
        answer: row.answer as string,
        confidence: row.confidence ?? undefined,
        caveats: row.caveats ? (JSON.parse(row.caveats) as string[]) : undefined,
      }
    : undefined;
  return {
    runId: row.runId,
    childThreadId: row.childThreadId,
    member: { provider: row.memberProvider as CouncilMember['provider'], model: row.memberModel },
    status: row.status as CouncilOutcomeRecord['status'],
    outcome,
    raw: row.raw ?? undefined,
    error: row.error ?? undefined,
    submittedAt: row.submittedAt,
  };
}

/** Returns true if the outcome was newly inserted, false if it already existed (dedup). */
export function saveOutcome(outcome: CouncilOutcomeRecord): boolean {
  const result = getCouncilDrizzle()
    .insert(councilOutcomes)
    .values({
      runId: outcome.runId,
      childThreadId: outcome.childThreadId,
      memberProvider: outcome.member.provider,
      memberModel: outcome.member.model ?? '',
      status: outcome.status,
      summary: outcome.outcome?.summary ?? null,
      answer: outcome.outcome?.answer ?? null,
      confidence: outcome.outcome?.confidence ?? null,
      caveats: outcome.outcome?.caveats ? JSON.stringify(outcome.outcome.caveats) : null,
      raw: outcome.raw ?? null,
      error: outcome.error ?? null,
      submittedAt: outcome.submittedAt,
    })
    .onConflictDoNothing()
    .run();
  return result.changes > 0;
}

export function getOutcomes(runId: string): CouncilOutcomeRecord[] {
  return getCouncilDrizzle()
    .select()
    .from(councilOutcomes)
    .where(eq(councilOutcomes.runId, runId))
    .all()
    .map(rowToOutcome);
}

// ---------------------------------------------------------------------------
// Child member registry
// ---------------------------------------------------------------------------

export function registerChildMember(runId: string, childThreadId: string, member: CouncilMember): void {
  getCouncilDrizzle()
    .insert(councilChildMembers)
    .values({ runId, childThreadId, provider: member.provider, model: member.model ?? '' })
    .onConflictDoNothing()
    .run();
}

export function getMemberForChild(runId: string, childThreadId: string): CouncilMember | null {
  const db = getCouncilDrizzle();
  // council_run_members is authoritative for runs dispatched after the per-member
  // table was introduced. Fall back to council_child_members for older runs.
  const memberRow = db
    .select({ provider: councilRunMembers.provider, model: councilRunMembers.model })
    .from(councilRunMembers)
    .where(and(eq(councilRunMembers.runId, runId), eq(councilRunMembers.childThreadId, childThreadId)))
    .get();
  if (memberRow) return { provider: memberRow.provider as CouncilMember['provider'], model: memberRow.model };
  const row = db
    .select({ provider: councilChildMembers.provider, model: councilChildMembers.model })
    .from(councilChildMembers)
    .where(and(eq(councilChildMembers.runId, runId), eq(councilChildMembers.childThreadId, childThreadId)))
    .get();
  if (!row) return null;
  return { provider: row.provider as CouncilMember['provider'], model: row.model };
}

// ---------------------------------------------------------------------------
// Run members (per-member state machine)
// ---------------------------------------------------------------------------

export interface RunMemberRow {
  memberIdx: number;
  childThreadId: string | null;
  provider: string;
  model: string;
  status: string;
}

function rowToRunMember(row: RunMemberDbRow): RunMemberRow {
  return {
    memberIdx: row.memberIdx,
    childThreadId: row.childThreadId ?? null,
    provider: row.provider,
    model: row.model,
    status: row.status,
  };
}

export function insertRunMember(runId: string, memberIdx: number, member: CouncilMember): void {
  getCouncilDrizzle()
    .insert(councilRunMembers)
    .values({ runId, memberIdx, provider: member.provider, model: member.model ?? '', status: 'pending' })
    .onConflictDoNothing()
    .run();
}

export function updateRunMember(
  runId: string,
  memberIdx: number,
  updates: { childThreadId?: string; status?: string }
): void {
  const db = getCouncilDrizzle();
  const where = and(eq(councilRunMembers.runId, runId), eq(councilRunMembers.memberIdx, memberIdx));
  if (updates.childThreadId !== undefined && updates.status !== undefined) {
    db.update(councilRunMembers)
      .set({ childThreadId: updates.childThreadId, status: updates.status })
      .where(where)
      .run();
  } else if (updates.childThreadId !== undefined) {
    db.update(councilRunMembers).set({ childThreadId: updates.childThreadId }).where(where).run();
  } else if (updates.status !== undefined) {
    db.update(councilRunMembers).set({ status: updates.status }).where(where).run();
  }
}

export function updateRunMemberByChildId(runId: string, childThreadId: string, status: string): void {
  getCouncilDrizzle()
    .update(councilRunMembers)
    .set({ status })
    .where(and(eq(councilRunMembers.runId, runId), eq(councilRunMembers.childThreadId, childThreadId)))
    .run();
}

export function getRunMembers(runId: string): RunMemberRow[] {
  return getCouncilDrizzle()
    .select()
    .from(councilRunMembers)
    .where(eq(councilRunMembers.runId, runId))
    .orderBy(councilRunMembers.memberIdx)
    .all()
    .map(rowToRunMember);
}

export function allRunMembersTerminal(runId: string): boolean {
  const row = getCouncilDrizzle()
    .select({
      total: count(),
      terminal: sql<number>`SUM(CASE WHEN ${councilRunMembers.status} IN ('submitted', 'invalid', 'error', 'timeout') THEN 1 ELSE 0 END)`,
    })
    .from(councilRunMembers)
    .where(eq(councilRunMembers.runId, runId))
    .get();
  if (!row || row.total === 0) return false;
  return (row.terminal ?? 0) >= row.total;
}
