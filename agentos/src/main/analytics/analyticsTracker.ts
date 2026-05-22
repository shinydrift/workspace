import { nanoid } from 'nanoid';
import * as threadStore from '../threads/threadStore';
import { calcCostUsdMicro } from '../../shared/pricing';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { safeDb, getProjectIdForThread } from './analyticsHelpers';
import { localDateString } from '../../shared/utils/date';
// better-sqlite3 exports both a default constructor and a `Database` namespace
// (for `.Statement` etc.). Using `Database` as the default-import name is the
// idiomatic way to access both — this rule's warning is a false positive here.
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import type { TokenUsageEvent, ThreadIdleEvent } from '../events';
import type { ToolCallStats } from '../../shared/types';

type TrackerStmts = {
  selectSession: Database.Statement;
  insertSession: Database.Statement;
  updateSession: Database.Statement;
  rollup: Database.Statement;
  updateSessionEnded: Database.Statement;
  upsertSessionCounts: Database.Statement;
  upsertProjectMemory: Database.Statement;
  upsertProjectToolStat: Database.Statement;
  selectAutomationMetrics: Database.Statement;
  insertAutomationRun: Database.Statement;
};

const _stmtCache = new WeakMap<Database.Database, TrackerStmts>();

function getStmts(db: Database.Database): TrackerStmts {
  let s = _stmtCache.get(db);
  if (!s) {
    s = {
      selectSession: db.prepare(
        'SELECT input_tokens, output_tokens, started_at, cost_usd_micro, cache_read_tokens, cache_creation_tokens, provider FROM session_metrics WHERE thread_id = ?'
      ),
      insertSession: db.prepare(
        `INSERT INTO session_metrics
           (thread_id, project_id, provider, model, started_at, input_tokens, output_tokens, cost_usd_micro, cache_read_tokens, cache_creation_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      // Backfills provider when a placeholder '' was written by onAssistantMessage before the first token event.
      updateSession: db.prepare(
        `UPDATE session_metrics
         SET input_tokens = ?, output_tokens = ?, cost_usd_micro = ?,
             cache_read_tokens = ?, cache_creation_tokens = ?,
             model = COALESCE(model, ?),
             provider = COALESCE(NULLIF(provider, ''), ?)
         WHERE thread_id = ?`
      ),
      rollup: db.prepare(
        `INSERT INTO project_daily_stats
           (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, cache_read_tokens, cache_creation_tokens, session_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date, project_id, model) DO UPDATE SET
           input_tokens          = input_tokens          + excluded.input_tokens,
           output_tokens         = output_tokens         + excluded.output_tokens,
           cost_usd_micro        = cost_usd_micro        + excluded.cost_usd_micro,
           cache_read_tokens     = cache_read_tokens     + excluded.cache_read_tokens,
           cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
           session_count         = session_count         + excluded.session_count`
      ),
      updateSessionEnded: db.prepare('UPDATE session_metrics SET ended_at = ? WHERE thread_id = ?'),
      // Uses '' for provider when creating a stub row before the first token event fires.
      upsertSessionCounts: db.prepare(
        `INSERT INTO session_metrics
           (thread_id, project_id, provider, started_at, turn_count, tool_call_count, memory_get_count)
         VALUES (?, ?, '', ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           turn_count       = turn_count       + excluded.turn_count,
           tool_call_count  = tool_call_count  + excluded.tool_call_count,
           memory_get_count = memory_get_count + excluded.memory_get_count`
      ),
      upsertProjectMemory: db.prepare(
        `INSERT INTO project_totals (project_id, memory_get_count)
         VALUES (?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           memory_get_count = memory_get_count + excluded.memory_get_count`
      ),
      upsertProjectToolStat: db.prepare(
        `INSERT INTO project_tool_stats (project_id, tool_name, count, success_count, error_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, tool_name) DO UPDATE SET
           count         = count         + excluded.count,
           success_count = success_count + excluded.success_count,
           error_count   = error_count   + excluded.error_count`
      ),
      selectAutomationMetrics: db.prepare(
        'SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, turn_count, tool_call_count, model, provider FROM session_metrics WHERE thread_id = ?'
      ),
      insertAutomationRun: db.prepare(
        `INSERT INTO automation_runs
           (id, job_id, thread_id, project_id, started_at, completed_at, status,
            error_message, input_tokens, output_tokens, turn_count, tool_call_count, cost_usd_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
    };
    _stmtCache.set(db, s);
  }
  return s;
}

export type RecordAutomationRunInput = {
  jobId: string;
  threadId: string;
  projectId: string;
  startedAt: number;
  completedAt: number;
  status: 'ok' | 'error' | 'skipped';
  errorMessage: string | null;
};

export class AnalyticsTracker {
  constructor(private readonly onCacheInvalidate: () => void) {}

  onTokenUsage({
    threadId,
    projectId,
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
  }: TokenUsageEvent): void {
    const db = safeDb();
    if (!db) return;

    const thread = threadStore.getThread(threadId);
    // Codex reports cumulative totals per turn; other providers report per-call deltas.
    const isCumulative = provider === 'codex';

    // Single transaction covering both session_metrics and project_daily_stats so
    // the two tables can never diverge (previously split across two DB connections).
    const stmts = getStmts(db);
    try {
      db.transaction(() => {
        const existing = stmts.selectSession.get(threadId) as
          | {
              input_tokens: number;
              output_tokens: number;
              started_at: number;
              cost_usd_micro: number;
              cache_read_tokens: number;
              cache_creation_tokens: number;
              provider: string;
            }
          | undefined;

        const newInput = isCumulative ? inputTokens : (existing?.input_tokens ?? 0) + inputTokens;
        const newOutput = isCumulative ? outputTokens : (existing?.output_tokens ?? 0) + outputTokens;
        const newCacheRead = isCumulative ? cacheReadTokens : (existing?.cache_read_tokens ?? 0) + cacheReadTokens;
        const newCacheCreation = isCumulative
          ? cacheCreationTokens
          : (existing?.cache_creation_tokens ?? 0) + cacheCreationTokens;

        // Clamp negative cumulative deltas: Codex counters can reset or arrive out of order.
        const rawDeltaInput = newInput - (existing?.input_tokens ?? 0);
        const rawDeltaOutput = newOutput - (existing?.output_tokens ?? 0);
        const rawDeltaCacheRead = newCacheRead - (existing?.cache_read_tokens ?? 0);
        const rawDeltaCacheCreation = newCacheCreation - (existing?.cache_creation_tokens ?? 0);

        if (
          isCumulative &&
          (rawDeltaInput < 0 || rawDeltaOutput < 0 || rawDeltaCacheRead < 0 || rawDeltaCacheCreation < 0)
        ) {
          eventLogger.warn('analytics', 'Ignoring negative cumulative token delta', {
            threadId,
            provider,
            model,
            rawDeltaInput,
            rawDeltaOutput,
            rawDeltaCacheRead,
            rawDeltaCacheCreation,
          });
        }

        const deltaInput = isCumulative ? Math.max(0, rawDeltaInput) : inputTokens;
        const deltaOutput = isCumulative ? Math.max(0, rawDeltaOutput) : outputTokens;
        const deltaCacheRead = isCumulative ? Math.max(0, rawDeltaCacheRead) : cacheReadTokens;
        const deltaCacheCreation = isCumulative ? Math.max(0, rawDeltaCacheCreation) : cacheCreationTokens;

        // Cost for the daily rollup increment: use the per-category breakdown so cache tokens
        // are priced at their correct rate rather than the full input rate.
        // Codex reports cumulative input that includes cache_read; Claude/Gemini already
        // report non-overlapping input (cache_read is separate), so only subtract when cumulative.
        const uniqueDeltaInput = isCumulative ? Math.max(0, deltaInput - deltaCacheRead) : deltaInput;
        const deltaCost = calcCostUsdMicro(uniqueDeltaInput, deltaOutput, model, deltaCacheRead, deltaCacheCreation);

        // Cumulative session cost stored in session_metrics.
        // Codex: re-derive from its cumulative token totals with cache breakdown.
        // Claude: accumulate delta costs so cache pricing is preserved across turns.
        const newCost = isCumulative
          ? calcCostUsdMicro(
              Math.max(0, inputTokens - cacheReadTokens),
              outputTokens,
              model,
              cacheReadTokens,
              cacheCreationTokens
            )
          : (existing?.cost_usd_micro ?? 0) + deltaCost;

        if (!existing) {
          stmts.insertSession.run(
            threadId,
            projectId,
            provider,
            model ?? null,
            thread?.createdAt ?? Date.now(),
            newInput,
            newOutput,
            newCost,
            newCacheRead,
            newCacheCreation
          );
        } else {
          stmts.updateSession.run(
            newInput,
            newOutput,
            newCost,
            newCacheRead,
            newCacheCreation,
            model ?? null,
            provider,
            threadId
          );
        }

        // Use the session's start date so turns that complete after midnight are
        // still attributed to the day the session was initiated.
        const sessionStart = existing?.started_at ?? thread?.createdAt ?? Date.now();
        const date = localDateString(new Date(sessionStart));
        // Count the session on the first real token event. A stub row created by
        // onAssistantMessage has provider='' and has not been counted yet.
        const sessionCount = !existing || existing.provider === '' ? 1 : 0;

        stmts.rollup.run(
          date,
          projectId,
          model ?? '',
          uniqueDeltaInput,
          deltaOutput,
          deltaCost,
          deltaCacheRead,
          deltaCacheCreation,
          sessionCount
        );
      })();

      this.onCacheInvalidate();
    } catch (err) {
      eventLogger.error('analytics', 'Failed to record token usage', { error: getErrorMessage(err) });
    }
  }

  onThreadIdle({ threadId }: ThreadIdleEvent): void {
    const projectId = getProjectIdForThread(threadId);
    if (!projectId) return;
    const db = safeDb();
    if (!db) return;

    try {
      getStmts(db).updateSessionEnded.run(Date.now(), threadId);
    } catch (err) {
      eventLogger.error('analytics', 'Failed to record session end time', { error: getErrorMessage(err) });
    }
  }

  // Called by runner.ts after each automation run.
  recordAutomationRun(record: RecordAutomationRunInput): void {
    const db = safeDb();
    if (!db) return;

    try {
      const stmts = getStmts(db);
      // Pull final token counts (and model) from session_metrics accumulated during the run.
      const metrics = stmts.selectAutomationMetrics.get(record.threadId) as
        | {
            input_tokens: number;
            output_tokens: number;
            cache_read_tokens: number;
            cache_creation_tokens: number;
            turn_count: number;
            tool_call_count: number;
            model: string | null;
            provider: string | null;
          }
        | undefined;

      const inputTokens = metrics?.input_tokens ?? 0;
      const outputTokens = metrics?.output_tokens ?? 0;
      const cacheReadTokens = metrics?.cache_read_tokens ?? 0;
      const cacheCreationTokens = metrics?.cache_creation_tokens ?? 0;
      const turnCount = metrics?.turn_count ?? 0;
      const toolCallCount = metrics?.tool_call_count ?? 0;
      const model = metrics?.model ?? undefined;
      // Codex stores gross input (includes cache_read) in session_metrics; Claude/Gemini
      // store unique input (cache_read is separate). Subtract only for the cumulative provider.
      const uniqueInput = metrics?.provider === 'codex' ? Math.max(0, inputTokens - cacheReadTokens) : inputTokens;
      const costUsdMicro = calcCostUsdMicro(uniqueInput, outputTokens, model, cacheReadTokens, cacheCreationTokens);

      stmts.insertAutomationRun.run(
        nanoid(),
        record.jobId,
        record.threadId,
        record.projectId,
        record.startedAt,
        record.completedAt,
        record.status,
        record.errorMessage,
        inputTokens,
        outputTokens,
        turnCount,
        toolCallCount,
        costUsdMicro
      );

      this.onCacheInvalidate();
    } catch (err) {
      eventLogger.error('analytics', 'Failed to record automation run', {
        jobId: record.jobId,
        threadId: record.threadId,
        error: getErrorMessage(err),
      });
    }
  }

  // Increment turn_count, tool_call_count, and memory_get_count for a thread.
  // Uses UPSERT so stats are preserved even when this fires before the first token event.
  onAssistantMessage(
    threadId: string,
    turnCountDelta: number,
    toolStats: ToolCallStats[],
    memoryGetCallCount: number
  ): void {
    const projectId = getProjectIdForThread(threadId);
    if (!projectId) return;
    const db = safeDb();
    if (!db) return;

    const thread = threadStore.getThread(threadId);
    const toolCallCount = toolStats.reduce((sum, stat) => sum + stat.count, 0);

    const stmts = getStmts(db);
    try {
      db.transaction(() => {
        stmts.upsertSessionCounts.run(
          threadId,
          projectId,
          thread?.createdAt ?? Date.now(),
          turnCountDelta,
          toolCallCount,
          memoryGetCallCount
        );

        if (memoryGetCallCount > 0) {
          stmts.upsertProjectMemory.run(projectId, memoryGetCallCount);
        }

        if (toolStats.length > 0) {
          for (const stat of toolStats) {
            stmts.upsertProjectToolStat.run(projectId, stat.name, stat.count, stat.successCount, stat.errorCount);
          }
        }
      })();
    } catch (err) {
      eventLogger.error('analytics', 'Failed to record assistant message stats', { error: getErrorMessage(err) });
    }

    if (memoryGetCallCount > 0) this.onCacheInvalidate();
  }
}
