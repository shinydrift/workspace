import type Sqlite3 from 'better-sqlite3';
import { localDateString } from '../../shared/utils/date';
import type { ProjectInsightsWindow, GlobalInsightsWindow } from '../../shared/types';

// ── Row types ──────────────────────────────────────────────────────────────────

export type ProjectWindowTotalsRow = {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_creation: number;
  total_cost: number;
  week_input: number;
  week_output: number;
  week_cache_read: number;
  week_cache_creation: number;
  week_cost: number;
  week_sessions: number;
  prev_input: number;
  prev_output: number;
  prev_cache_read: number;
  prev_cache_creation: number;
  prev_cost: number;
  prev_sessions: number;
};

export type GlobalWindowTotalsRow = ProjectWindowTotalsRow & {
  week_projects: number;
  prev_projects: number;
};

export type DailyStatsRow = {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd_micro: number;
  session_count: number;
};

export type ModelBreakdownRow = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd_micro: number;
};

type PerProjectRow = {
  project_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd_micro: number;
};

// ── Date helpers ───────────────────────────────────────────────────────────────

function weekWindowDates() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return {
    sevenDaysAgo: localDateString(new Date(y, m, d - 7)),
    fourteenDaysAgo: localDateString(new Date(y, m, d - 14)),
  };
}

// ── Window totals queries ──────────────────────────────────────────────────────

export function getProjectWindowTotals(gdb: Sqlite3.Database, projectId: string): ProjectWindowTotalsRow {
  const { sevenDaysAgo, fourteenDaysAgo } = weekWindowDates();
  return gdb
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS total_input,
         COALESCE(SUM(output_tokens), 0) AS total_output,
         COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
         COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation,
         COALESCE(SUM(cost_usd_micro), 0) AS total_cost,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN input_tokens ELSE 0 END), 0) AS week_input,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN output_tokens ELSE 0 END), 0) AS week_output,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cache_read_tokens ELSE 0 END), 0) AS week_cache_read,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cache_creation_tokens ELSE 0 END), 0) AS week_cache_creation,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cost_usd_micro ELSE 0 END), 0) AS week_cost,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN session_count ELSE 0 END), 0) AS week_sessions,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN input_tokens ELSE 0 END), 0) AS prev_input,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN output_tokens ELSE 0 END), 0) AS prev_output,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cache_read_tokens ELSE 0 END), 0) AS prev_cache_read,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cache_creation_tokens ELSE 0 END), 0) AS prev_cache_creation,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cost_usd_micro ELSE 0 END), 0) AS prev_cost,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN session_count ELSE 0 END), 0) AS prev_sessions
       FROM project_daily_stats
       WHERE project_id = $projectId`
    )
    .get({ sevenDaysAgo, fourteenDaysAgo, projectId }) as ProjectWindowTotalsRow;
}

export function getGlobalWindowTotals(gdb: Sqlite3.Database): GlobalWindowTotalsRow {
  const { sevenDaysAgo, fourteenDaysAgo } = weekWindowDates();
  return gdb
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS total_input,
         COALESCE(SUM(output_tokens), 0) AS total_output,
         COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
         COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation,
         COALESCE(SUM(cost_usd_micro), 0) AS total_cost,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN input_tokens ELSE 0 END), 0) AS week_input,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN output_tokens ELSE 0 END), 0) AS week_output,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cache_read_tokens ELSE 0 END), 0) AS week_cache_read,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cache_creation_tokens ELSE 0 END), 0) AS week_cache_creation,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN cost_usd_micro ELSE 0 END), 0) AS week_cost,
         COALESCE(SUM(CASE WHEN date >= $sevenDaysAgo THEN session_count ELSE 0 END), 0) AS week_sessions,
         COUNT(DISTINCT CASE WHEN date >= $sevenDaysAgo THEN project_id END) AS week_projects,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN input_tokens ELSE 0 END), 0) AS prev_input,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN output_tokens ELSE 0 END), 0) AS prev_output,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cache_read_tokens ELSE 0 END), 0) AS prev_cache_read,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cache_creation_tokens ELSE 0 END), 0) AS prev_cache_creation,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN cost_usd_micro ELSE 0 END), 0) AS prev_cost,
         COALESCE(SUM(CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN session_count ELSE 0 END), 0) AS prev_sessions,
         COUNT(DISTINCT CASE WHEN date >= $fourteenDaysAgo AND date < $sevenDaysAgo THEN project_id END) AS prev_projects
       FROM project_daily_stats`
    )
    .get({ sevenDaysAgo, fourteenDaysAgo }) as GlobalWindowTotalsRow;
}

// ── Aggregate row queries ──────────────────────────────────────────────────────

export function getDailyStatsRows(gdb: Sqlite3.Database, projectId?: string): DailyStatsRow[] {
  if (projectId) {
    return gdb
      .prepare(
        `SELECT date,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(cost_usd_micro) AS cost_usd_micro,
           SUM(session_count) AS session_count
         FROM project_daily_stats
         WHERE project_id = ?
         GROUP BY date
         ORDER BY date ASC`
      )
      .all(projectId) as DailyStatsRow[];
  }
  return gdb
    .prepare(
      `SELECT date,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_creation_tokens) AS cache_creation_tokens,
         SUM(cost_usd_micro) AS cost_usd_micro,
         SUM(session_count) AS session_count
       FROM project_daily_stats
       GROUP BY date
       ORDER BY date ASC`
    )
    .all() as DailyStatsRow[];
}

export function getModelBreakdownRows(gdb: Sqlite3.Database, projectId?: string): ModelBreakdownRow[] {
  if (projectId) {
    return gdb
      .prepare(
        `SELECT model,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(cost_usd_micro) AS cost_usd_micro
         FROM project_daily_stats
         WHERE project_id = ?
         GROUP BY model
         ORDER BY cost_usd_micro DESC`
      )
      .all(projectId) as ModelBreakdownRow[];
  }
  return gdb
    .prepare(
      `SELECT model,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_creation_tokens) AS cache_creation_tokens,
         SUM(cost_usd_micro) AS cost_usd_micro
       FROM project_daily_stats
       GROUP BY model
       ORDER BY cost_usd_micro DESC`
    )
    .all() as ModelBreakdownRow[];
}

export function getPerProjectRows(gdb: Sqlite3.Database): PerProjectRow[] {
  return gdb
    .prepare(
      `SELECT project_id,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_creation_tokens) AS cache_creation_tokens,
         SUM(cost_usd_micro) AS cost_usd_micro
       FROM project_daily_stats
       GROUP BY project_id
       ORDER BY cost_usd_micro DESC`
    )
    .all() as PerProjectRow[];
}

// ── Window-to-insights mappers ─────────────────────────────────────────────────

export function toProjectInsightsWindow(row: ProjectWindowTotalsRow, prefix: 'week' | 'prev'): ProjectInsightsWindow {
  if (prefix === 'week') {
    return {
      totalInputTokens: row.week_input,
      totalOutputTokens: row.week_output,
      totalCacheReadTokens: row.week_cache_read,
      totalCacheCreationTokens: row.week_cache_creation,
      totalCostUsdMicro: row.week_cost,
      sessionCount: row.week_sessions,
    };
  }
  return {
    totalInputTokens: row.prev_input,
    totalOutputTokens: row.prev_output,
    totalCacheReadTokens: row.prev_cache_read,
    totalCacheCreationTokens: row.prev_cache_creation,
    totalCostUsdMicro: row.prev_cost,
    sessionCount: row.prev_sessions,
  };
}

export function toGlobalInsightsWindow(row: GlobalWindowTotalsRow, prefix: 'week' | 'prev'): GlobalInsightsWindow {
  return {
    ...toProjectInsightsWindow(row, prefix),
    projectCount: prefix === 'week' ? row.week_projects : row.prev_projects,
  };
}
