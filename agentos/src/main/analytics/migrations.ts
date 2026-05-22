import type { MigrationDef } from '../db/drizzleMigrate';

export const ANALYTICS_MIGRATION_NAMES = ['0001_baseline'] as const;

export const ANALYTICS_MIGRATIONS: MigrationDef[] = [
  {
    name: '0001_baseline',
    sql: `
CREATE TABLE IF NOT EXISTS analytics_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS session_metrics (
  thread_id             TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  provider              TEXT NOT NULL,
  model                 TEXT,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  turn_count            INTEGER NOT NULL DEFAULT 0,
  tool_call_count       INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro        INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  memory_get_count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL,
  thread_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  status          TEXT NOT NULL,
  error_message   TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  turn_count      INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_daily_stats (
  date                  TEXT NOT NULL,
  project_id            TEXT NOT NULL,
  model                 TEXT NOT NULL DEFAULT '',
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro        INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  session_count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, project_id, model)
);

CREATE TABLE IF NOT EXISTS project_totals (
  project_id        TEXT PRIMARY KEY,
  memory_get_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_tool_stats (
  project_id     TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  success_count  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_pds_project_date ON project_daily_stats(project_id, date);
CREATE INDEX IF NOT EXISTS idx_pds_date ON project_daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_automation_runs_job_id ON automation_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_started_at ON automation_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_automation_runs_job_started ON automation_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_metrics_project_started ON session_metrics(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_metrics_project_cost ON session_metrics(project_id, cost_usd_micro DESC);
CREATE INDEX IF NOT EXISTS idx_project_tool_stats_project_count ON project_tool_stats(project_id, count DESC);
`,
  },
];
