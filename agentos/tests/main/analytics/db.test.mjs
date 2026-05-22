/**
 * Tests for analytics/db.ts — schema setup, DB lifecycle, CRUD.
 * Uses better-sqlite3 via require() in a tmpdir (no Electron ABI needed here
 * since analytics DB does not use sqlite-vec).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ── Schema SQL (inlined from analytics/db.ts) ─────────────────────────────────

const GLOBAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_daily_stats (
  date           TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, project_id, model)
);
CREATE INDEX IF NOT EXISTS idx_pds_project_date ON project_daily_stats(project_id, date);
CREATE INDEX IF NOT EXISTS idx_pds_date ON project_daily_stats(date);

CREATE TABLE IF NOT EXISTS project_totals (
  project_id       TEXT PRIMARY KEY,
  memory_get_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_tool_stats (
  project_id     TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  success_count  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, tool_name)
);
CREATE INDEX IF NOT EXISTS idx_project_tool_stats_project_count ON project_tool_stats(project_id, count DESC);

CREATE TABLE IF NOT EXISTS analytics_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_metrics (
  thread_id       TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  turn_count      INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro  INTEGER NOT NULL DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_automation_runs_job_id ON automation_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_started_at ON automation_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_automation_runs_job_started ON automation_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_metrics_project_started ON session_metrics(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_metrics_project_cost ON session_metrics(project_id, cost_usd_micro DESC);
`;

function openAnalyticsDb(dir, projectId) {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, `${projectId}.sqlite`);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  return db;
}

function openGlobalDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'global.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(GLOBAL_SCHEMA_SQL);
  return db;
}

// ── Schema creation ───────────────────────────────────────────────────────────

test('analytics db creates session_metrics table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_metrics'").get();
    assert.ok(row);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('analytics db creates automation_runs table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_runs'").get();
    assert.ok(row);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('global db creates project_daily_stats table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_daily_stats'").get();
    assert.ok(row);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('global db creates project_totals, project_tool_stats, and analytics_meta tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    const totals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_totals'").get();
    const tools = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_tool_stats'").get();
    const meta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_meta'").get();
    assert.ok(totals);
    assert.ok(tools);
    assert.ok(meta);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('analytics db is idempotent — exec schema twice does not error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.exec(SCHEMA_SQL); // second time — should be no-op
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

// ── session_metrics CRUD ──────────────────────────────────────────────────────

test('session_metrics INSERT and SELECT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('thread-1', 'proj1', 'claude', Date.now(), 100, 50, 1000, 3, 5);
    const row = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('thread-1');
    assert.equal(row.thread_id, 'thread-1');
    assert.equal(row.input_tokens, 100);
    assert.equal(row.output_tokens, 50);
    assert.equal(row.turn_count, 3);
    assert.equal(row.tool_call_count, 5);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('session_metrics defaults: ended_at is null, model is null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t2', 'proj1', 'claude', Date.now(), 0, 0, 0, 0, 0);
    const row = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t2');
    assert.equal(row.ended_at, null);
    assert.equal(row.model, null);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('session_metrics UPDATE sets ended_at', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t3', 'proj1', 'claude', 1000, 0, 0, 0, 0, 0);
    const endedAt = Date.now();
    db.prepare('UPDATE session_metrics SET ended_at = ? WHERE thread_id = ?').run(endedAt, 't3');
    const row = db.prepare('SELECT ended_at FROM session_metrics WHERE thread_id = ?').get('t3');
    assert.equal(row.ended_at, endedAt);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('session_metrics accumulates token counts via UPDATE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t4', 'proj1', 'claude', Date.now(), 100, 50, 0, 1, 2);
    db.prepare(
      'UPDATE session_metrics SET input_tokens = ?, output_tokens = ? WHERE thread_id = ?'
    ).run(200, 100, 't4');
    const row = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t4');
    assert.equal(row.input_tokens, 200);
    assert.equal(row.output_tokens, 100);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

// ── automation_runs CRUD ──────────────────────────────────────────────────────

test('automation_runs INSERT and SELECT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO automation_runs (id, job_id, thread_id, project_id, started_at, status, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('run-1', 'job-1', 'thread-1', 'proj1', Date.now(), 'ok', 100, 50, 500, 2, 3);
    const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('run-1');
    assert.equal(row.job_id, 'job-1');
    assert.equal(row.status, 'ok');
    assert.equal(row.turn_count, 2);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('automation_runs supports error status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openAnalyticsDb(path.join(dir, 'analytics'), 'proj1');
    db.prepare(
      `INSERT INTO automation_runs (id, job_id, thread_id, project_id, started_at, status, error_message, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('run-2', 'job-1', 'thread-2', 'proj1', Date.now(), 'error', 'timeout', 0, 0, 0, 0, 0);
    const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('run-2');
    assert.equal(row.status, 'error');
    assert.equal(row.error_message, 'timeout');
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

// ── project_daily_stats CRUD ──────────────────────────────────────────────────

test('project_daily_stats INSERT and SELECT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('2026-05-23', 'proj1', 'claude-sonnet', 1000, 500, 10000);
    const row = db.prepare("SELECT * FROM project_daily_stats WHERE date = '2026-05-23'").get();
    assert.equal(row.project_id, 'proj1');
    assert.equal(row.input_tokens, 1000);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('project_daily_stats UPSERT accumulates tokens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    const upsert = db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, project_id, model) DO UPDATE SET
         input_tokens   = input_tokens   + excluded.input_tokens,
         output_tokens  = output_tokens  + excluded.output_tokens,
         cost_usd_micro = cost_usd_micro + excluded.cost_usd_micro`
    );
    upsert.run('2026-05-23', 'proj1', 'model', 100, 50, 500);
    upsert.run('2026-05-23', 'proj1', 'model', 200, 100, 1000);
    const row = db.prepare("SELECT * FROM project_daily_stats WHERE date = '2026-05-23'").get();
    assert.equal(row.input_tokens, 300);
    assert.equal(row.output_tokens, 150);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('project_daily_stats primary key is (date, project_id, model)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('2026-05-23', 'proj1', 'model-a', 100, 0, 0);
    db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('2026-05-23', 'proj1', 'model-b', 200, 0, 0);
    const rows = db.prepare("SELECT * FROM project_daily_stats WHERE date = '2026-05-23'").all();
    assert.equal(rows.length, 2);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('project_totals upsert accumulates memory_get_count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    const upsert = db.prepare(
      `INSERT INTO project_totals (project_id, memory_get_count)
       VALUES (?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         memory_get_count = memory_get_count + excluded.memory_get_count`
    );
    upsert.run('proj1', 2);
    upsert.run('proj1', 3);
    const row = db.prepare('SELECT memory_get_count FROM project_totals WHERE project_id = ?').get('proj1');
    assert.equal(row.memory_get_count, 5);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('project_tool_stats primary key is (project_id, tool_name)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-analytics-test-'));
  let db;
  try {
    db = openGlobalDb(path.join(dir, 'analytics'));
    db.prepare(
      `INSERT INTO project_tool_stats (project_id, tool_name, count, success_count, error_count)
       VALUES (?, ?, ?, ?, ?)`
    ).run('proj1', 'Read', 1, 1, 0);
    assert.throws(() => {
      db.prepare(
        `INSERT INTO project_tool_stats (project_id, tool_name, count, success_count, error_count)
         VALUES (?, ?, ?, ?, ?)`
      ).run('proj1', 'Read', 1, 1, 0);
    });
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true });
  }
});

// ── toSinceDate helper ────────────────────────────────────────────────────────

function toSinceDate(since) {
  return since ? new Date(since).toISOString().slice(0, 10) : '2026-05-22';
}

test('toSinceDate returns baseline date for undefined', () => {
  assert.equal(toSinceDate(undefined), '2026-05-22');
});

test('toSinceDate returns baseline date for 0', () => {
  assert.equal(toSinceDate(0), '2026-05-22');
});

test('toSinceDate returns ISO date string for timestamp', () => {
  const ts = new Date('2026-05-23T00:00:00Z').getTime();
  assert.equal(toSinceDate(ts), '2026-05-23');
});
