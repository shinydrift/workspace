import { getAutomationJob } from '../threads/db';
import { getProjectDb } from '../memory/projectDb';
import { safeDb, getProjectIdForThread } from './analyticsHelpers';
import { eventLogger } from '../utils/eventLog';
import {
  getProjectWindowTotals,
  getGlobalWindowTotals,
  getDailyStatsRows,
  getModelBreakdownRows,
  getPerProjectRows,
  toProjectInsightsWindow,
  toGlobalInsightsWindow,
  type DailyStatsRow,
  type ModelBreakdownRow,
} from './overviewQueries';
import type {
  SessionMetrics,
  AnalyticsRunRecord,
  ProjectInsights,
  GlobalInsights,
  ProjectInsightsOverview,
  GlobalInsightsOverview,
  ProjectInsightsWindow,
  GlobalInsightsWindow,
  ToolCallStats,
} from '../../shared/types';

function mapDailyRow(r: DailyStatsRow) {
  return {
    date: r.date,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    costUsdMicro: r.cost_usd_micro,
  };
}

function mapModelRow(r: ModelBreakdownRow) {
  return {
    model: r.model || 'unknown',
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    costUsdMicro: r.cost_usd_micro,
  };
}

function rowToSessionMetrics(row: Record<string, unknown>): SessionMetrics {
  return {
    threadId: String(row.thread_id),
    projectId: String(row.project_id),
    provider: String(row.provider),
    model: String(row.model ?? ''),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at != null ? Number(row.ended_at) : null,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    turnCount: Number(row.turn_count),
    toolCallCount: Number(row.tool_call_count),
    costUsdMicro: Number(row.cost_usd_micro),
  };
}

const VALID_RUN_STATUSES = new Set<AnalyticsRunRecord['status']>(['ok', 'error', 'skipped']);
function toRunStatus(raw: string): AnalyticsRunRecord['status'] {
  if (VALID_RUN_STATUSES.has(raw as AnalyticsRunRecord['status'])) return raw as AnalyticsRunRecord['status'];
  eventLogger.error('analytics', 'Unknown run status in DB', { status: raw });
  return 'error';
}

function rowToAnalyticsRunRecord(row: Record<string, unknown>): AnalyticsRunRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    threadId: String(row.thread_id),
    projectId: String(row.project_id),
    startedAt: Number(row.started_at),
    completedAt: row.completed_at != null ? Number(row.completed_at) : null,
    status: toRunStatus(String(row.status)),
    errorMessage: row.error_message != null ? String(row.error_message) : null,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    turnCount: Number(row.turn_count),
    toolCallCount: Number(row.tool_call_count),
    costUsdMicro: Number(row.cost_usd_micro),
  };
}

export class AnalyticsQueries {
  private _globalMemoryGetCountCache: { data: number; expiry: number } | null = null;
  private _memoryGetWeeklyCache: { thisWeek: number; lastWeek: number; expiry: number } | null = null;

  invalidateCaches(): void {
    this._globalMemoryGetCountCache = null;
    this._memoryGetWeeklyCache = null;
  }

  getProjectMemoryGetCount(projectId: string): number {
    const gdb = safeDb();
    if (!gdb) return 0;
    const row = gdb
      .prepare('SELECT COALESCE(memory_get_count, 0) AS n FROM project_totals WHERE project_id = ?')
      .get(projectId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  getGlobalMemoryGetCount(): number {
    const now = Date.now();
    if (this._globalMemoryGetCountCache && now < this._globalMemoryGetCountCache.expiry) {
      return this._globalMemoryGetCountCache.data;
    }
    const gdb = safeDb();
    if (!gdb) return 0;
    const row = gdb.prepare('SELECT COALESCE(SUM(memory_get_count), 0) AS n FROM project_totals').get() as {
      n: number;
    };
    const total = row.n;
    this._globalMemoryGetCountCache = { data: total, expiry: now + 60_000 };
    return total;
  }

  getProjectToolBreakdown(projectId: string): ToolCallStats[] {
    const gdb = safeDb();
    if (!gdb) return [];
    const rows = gdb
      .prepare(
        `SELECT tool_name, count, success_count, error_count
         FROM project_tool_stats
         WHERE project_id = ?
         ORDER BY count DESC, tool_name ASC`
      )
      .all(projectId) as Array<{ tool_name: string; count: number; success_count: number; error_count: number }>;
    return rows.map((row) => ({
      name: row.tool_name,
      count: row.count,
      successCount: row.success_count,
      errorCount: row.error_count,
    }));
  }

  replaceProjectToolBreakdown(projectId: string, stats: ToolCallStats[]): void {
    const gdb = safeDb();
    if (!gdb) return;
    gdb.transaction(() => {
      gdb.prepare('DELETE FROM project_tool_stats WHERE project_id = ?').run(projectId);
      if (stats.length === 0) return;
      const insert = gdb.prepare(
        `INSERT INTO project_tool_stats (project_id, tool_name, count, success_count, error_count)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const stat of stats) {
        insert.run(projectId, stat.name, stat.count, stat.successCount, stat.errorCount);
      }
    })();
  }

  getGlobalToolBreakdown(): ToolCallStats[] {
    const gdb = safeDb();
    if (!gdb) return [];
    const rows = gdb
      .prepare(
        `SELECT tool_name, SUM(count) AS count, SUM(success_count) AS success_count, SUM(error_count) AS error_count
         FROM project_tool_stats
         GROUP BY tool_name
         ORDER BY count DESC, tool_name ASC`
      )
      .all() as Array<{ tool_name: string; count: number; success_count: number; error_count: number }>;
    return rows.map((row) => ({
      name: row.tool_name,
      count: row.count,
      successCount: row.success_count,
      errorCount: row.error_count,
    }));
  }

  getSessionMetrics(threadId: string): SessionMetrics | null {
    const projectId = getProjectIdForThread(threadId);
    if (!projectId) return null;
    const db = safeDb();
    if (!db) return null;

    const row = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get(threadId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToSessionMetrics(row);
  }

  getAutomationRuns(jobId: string, limit = 50, since?: number): AnalyticsRunRecord[] {
    limit = Math.min(Math.max(1, limit), 500);
    const job = getAutomationJob(jobId);
    if (!job) return [];
    const db = safeDb();
    if (!db) return [];

    const rows = db
      .prepare('SELECT * FROM automation_runs WHERE job_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?')
      .all(jobId, since ?? 0, limit) as Record<string, unknown>[];

    return rows.map(rowToAnalyticsRunRecord);
  }

  getTopCostThreads(projectId: string, limit = 10): SessionMetrics[] {
    limit = Math.min(Math.max(1, limit), 100);
    const db = safeDb();
    if (!db) return [];
    const rows = db
      .prepare('SELECT * FROM session_metrics WHERE project_id = ? ORDER BY cost_usd_micro DESC LIMIT ?')
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map(rowToSessionMetrics);
  }

  getProjectOverview(projectId: string): ProjectInsightsOverview {
    const gdb = safeDb();
    const emptyAllTime: ProjectInsights = {
      projectId,
      since: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUsdMicro: 0,
      dailyStats: [],
      modelBreakdown: [],
    };
    const emptyWindow: ProjectInsightsWindow = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUsdMicro: 0,
      sessionCount: 0,
    };
    if (!gdb) {
      return {
        projectId,
        allTime: emptyAllTime,
        thisWeek: emptyWindow,
        lastWeek: emptyWindow,
        activeTimeSecsThisWeek: 0,
        activeTimeSecsLastWeek: 0,
        memoryGetThisWeek: 0,
        memoryGetLastWeek: 0,
        expansionThisWeek: 0,
        expansionLastWeek: 0,
      };
    }

    const totalsRow = getProjectWindowTotals(gdb, projectId);
    const dailyRows = getDailyStatsRows(gdb, projectId);
    const modelRows = getModelBreakdownRows(gdb, projectId);

    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgoMs = nowMs - 14 * 24 * 60 * 60 * 1000;

    const sessionStmt = gdb.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN started_at >= $sevenDaysAgoMs AND ended_at IS NOT NULL THEN (ended_at - started_at) ELSE 0 END), 0) / 1000 AS week_active_secs,
         COALESCE(SUM(CASE WHEN started_at >= $fourteenDaysAgoMs AND started_at < $sevenDaysAgoMs AND ended_at IS NOT NULL THEN (ended_at - started_at) ELSE 0 END), 0) / 1000 AS prev_active_secs,
         COALESCE(SUM(CASE WHEN started_at >= $sevenDaysAgoMs THEN memory_get_count ELSE 0 END), 0) AS week_memory_get,
         COALESCE(SUM(CASE WHEN started_at >= $fourteenDaysAgoMs AND started_at < $sevenDaysAgoMs THEN memory_get_count ELSE 0 END), 0) AS prev_memory_get
       FROM session_metrics
       WHERE project_id = $projectId`
    );
    const sessionRow = sessionStmt.get({ sevenDaysAgoMs, fourteenDaysAgoMs, projectId }) as {
      week_active_secs: number;
      prev_active_secs: number;
      week_memory_get: number;
      prev_memory_get: number;
    };

    let expansionThisWeek = 0;
    let expansionLastWeek = 0;
    try {
      const memDb = getProjectDb(projectId);
      const expansionRow = memDb
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN expanded_at >= ? THEN 1 ELSE 0 END), 0) AS this_week,
             COALESCE(SUM(CASE WHEN expanded_at >= ? AND expanded_at < ? THEN 1 ELSE 0 END), 0) AS last_week
           FROM chunk_expansions`
        )
        .get(sevenDaysAgoMs, fourteenDaysAgoMs, sevenDaysAgoMs) as { this_week: number; last_week: number };
      expansionThisWeek = expansionRow.this_week;
      expansionLastWeek = expansionRow.last_week;
    } catch (err) {
      eventLogger.warn('analytics', 'Failed to query chunk_expansions', { projectId, err });
    }

    return {
      projectId,
      allTime: {
        projectId,
        since: 0,
        totalInputTokens: totalsRow.total_input,
        totalOutputTokens: totalsRow.total_output,
        totalCacheReadTokens: totalsRow.total_cache_read,
        totalCacheCreationTokens: totalsRow.total_cache_creation,
        totalCostUsdMicro: totalsRow.total_cost,
        dailyStats: dailyRows.map((r) => ({ ...mapDailyRow(r), sessionCount: r.session_count })),
        modelBreakdown: modelRows.map(mapModelRow),
      },
      thisWeek: toProjectInsightsWindow(totalsRow, 'week'),
      lastWeek: toProjectInsightsWindow(totalsRow, 'prev'),
      activeTimeSecsThisWeek: sessionRow.week_active_secs,
      activeTimeSecsLastWeek: sessionRow.prev_active_secs,
      memoryGetThisWeek: sessionRow.week_memory_get,
      memoryGetLastWeek: sessionRow.prev_memory_get,
      expansionThisWeek,
      expansionLastWeek,
    };
  }

  getGlobalOverview(): GlobalInsightsOverview {
    const gdb = safeDb();
    const emptyAllTime: GlobalInsights = {
      since: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUsdMicro: 0,
      perProject: [],
      dailyStats: [],
      modelBreakdown: [],
    };
    const emptyWindow: GlobalInsightsWindow = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUsdMicro: 0,
      sessionCount: 0,
      projectCount: 0,
    };
    if (!gdb) {
      return {
        allTime: emptyAllTime,
        thisWeek: emptyWindow,
        lastWeek: emptyWindow,
        globalMemoryGetCallCount: 0,
        memoryGetThisWeek: 0,
        memoryGetLastWeek: 0,
        perProjectMemoryGet: [],
        activeTimeSecsThisWeek: 0,
        activeTimeSecsLastWeek: 0,
      };
    }

    const totalsRow = getGlobalWindowTotals(gdb);
    const perProjectRows = getPerProjectRows(gdb);
    const dailyRows = getDailyStatsRows(gdb);
    const modelRows = getModelBreakdownRows(gdb);

    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgoMs = nowMs - 14 * 24 * 60 * 60 * 1000;

    let memoryGetThisWeek: number;
    let memoryGetLastWeek: number;
    if (this._memoryGetWeeklyCache && nowMs < this._memoryGetWeeklyCache.expiry) {
      ({ thisWeek: memoryGetThisWeek, lastWeek: memoryGetLastWeek } = this._memoryGetWeeklyCache);
    } else {
      memoryGetThisWeek = 0;
      memoryGetLastWeek = 0;
      const db = safeDb();
      if (db) {
        const weekStmt =
          'SELECT COALESCE(SUM(CASE WHEN started_at >= ? THEN memory_get_count ELSE 0 END), 0) AS this_week, COALESCE(SUM(CASE WHEN started_at >= ? AND started_at < ? THEN memory_get_count ELSE 0 END), 0) AS last_week FROM session_metrics';
        const row = db.prepare(weekStmt).get(sevenDaysAgoMs, fourteenDaysAgoMs, sevenDaysAgoMs) as {
          this_week: number;
          last_week: number;
        };
        memoryGetThisWeek = row.this_week;
        memoryGetLastWeek = row.last_week;
      }
      this._memoryGetWeeklyCache = { thisWeek: memoryGetThisWeek, lastWeek: memoryGetLastWeek, expiry: nowMs + 60_000 };
    }

    const activeTimeRow = gdb
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN started_at >= $sevenDaysAgoMs AND ended_at IS NOT NULL THEN (ended_at - started_at) ELSE 0 END), 0) / 1000 AS week_active_secs,
           COALESCE(SUM(CASE WHEN started_at >= $fourteenDaysAgoMs AND started_at < $sevenDaysAgoMs AND ended_at IS NOT NULL THEN (ended_at - started_at) ELSE 0 END), 0) / 1000 AS prev_active_secs
         FROM session_metrics`
      )
      .get({ sevenDaysAgoMs, fourteenDaysAgoMs }) as { week_active_secs: number; prev_active_secs: number };

    const perProjectMemoryGetRows = gdb
      .prepare(
        'SELECT project_id, memory_get_count FROM project_totals WHERE memory_get_count > 0 ORDER BY memory_get_count DESC'
      )
      .all() as Array<{ project_id: string; memory_get_count: number }>;
    const perProjectMemoryGet = perProjectMemoryGetRows.map((r) => ({
      projectId: r.project_id,
      count: r.memory_get_count,
    }));

    return {
      allTime: {
        since: 0,
        totalInputTokens: totalsRow.total_input,
        totalOutputTokens: totalsRow.total_output,
        totalCacheReadTokens: totalsRow.total_cache_read,
        totalCacheCreationTokens: totalsRow.total_cache_creation,
        totalCostUsdMicro: totalsRow.total_cost,
        perProject: perProjectRows.map((r) => ({
          projectId: r.project_id,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheReadTokens: r.cache_read_tokens,
          cacheCreationTokens: r.cache_creation_tokens,
          costUsdMicro: r.cost_usd_micro,
        })),
        dailyStats: dailyRows.map((r) => ({ ...mapDailyRow(r), sessionCount: r.session_count })),
        modelBreakdown: modelRows.map(mapModelRow),
      },
      thisWeek: toGlobalInsightsWindow(totalsRow, 'week'),
      lastWeek: toGlobalInsightsWindow(totalsRow, 'prev'),
      globalMemoryGetCallCount: this.getGlobalMemoryGetCount(),
      memoryGetThisWeek,
      memoryGetLastWeek,
      perProjectMemoryGet,
      activeTimeSecsThisWeek: activeTimeRow.week_active_secs,
      activeTimeSecsLastWeek: activeTimeRow.prev_active_secs,
    };
  }
}
