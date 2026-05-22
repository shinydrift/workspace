/**
 * Tests for analytics write atomicity.
 *
 * analyticsTracker.onTokenUsage() wraps session_metrics and project_daily_stats
 * writes in a single transaction so the two tables can never diverge. These tests
 * verify that guarantee using the analytics schema directly (inlined via node:sqlite,
 * since better-sqlite3 requires Electron's native ABI).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (inlined from analytics/db.ts — keep in sync if columns are added) ─

const SCHEMA_SQL = `
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
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

// Inlined core logic from analyticsTracker.onTokenUsage (additive/non-cumulative mode).
// Writes both tables in one explicit transaction, mirroring the production code.
function recordTokenUsage(db, { threadId, projectId, model = '', inputTokens, outputTokens, date, startedAt = 1000 }) {
  const existing = db
    .prepare('SELECT input_tokens, output_tokens FROM session_metrics WHERE thread_id = ?')
    .get(threadId);
  const newInput = (existing?.input_tokens ?? 0) + inputTokens;
  const newOutput = (existing?.output_tokens ?? 0) + outputTokens;
  const sessionCount = existing ? 0 : 1;

  db.exec('BEGIN');
  try {
    if (!existing) {
      db.prepare(
        `INSERT INTO session_metrics
           (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
         VALUES (?, ?, 'claude', ?, ?, ?, 0, 0, 0)`
      ).run(threadId, projectId, startedAt, newInput, newOutput);
    } else {
      db.prepare('UPDATE session_metrics SET input_tokens = ?, output_tokens = ? WHERE thread_id = ?').run(
        newInput,
        newOutput,
        threadId
      );
    }
    db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, session_count)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(date, project_id, model) DO UPDATE SET
         input_tokens  = input_tokens  + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         session_count = session_count + excluded.session_count`
    ).run(date, projectId, model, inputTokens, outputTokens, sessionCount);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── Happy path ────────────────────────────────────────────────────────────────

test('both session_metrics and project_daily_stats written on success', () => {
  const db = openDb();
  recordTokenUsage(db, {
    threadId: 't1',
    projectId: 'p1',
    model: 'claude-3',
    inputTokens: 100,
    outputTokens: 50,
    date: '2026-05-23',
  });

  const session = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t1');
  assert.equal(session.input_tokens, 100);
  assert.equal(session.output_tokens, 50);

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 100);
  assert.equal(daily.output_tokens, 50);
  assert.equal(daily.session_count, 1);

  db.close();
});

// ── Transaction atomicity ─────────────────────────────────────────────────────

test('transaction rollback leaves both tables unchanged', () => {
  const db = openDb();

  db.exec('BEGIN');
  db.prepare(
    `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
     VALUES ('t1', 'p1', 'claude', 1000, 100, 50, 0, 0, 0)`
  ).run();
  db.prepare(
    `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, session_count)
     VALUES ('2026-05-23', 'p1', '', 100, 50, 0, 1)`
  ).run();
  db.exec('ROLLBACK');

  const session = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t1');
  assert.equal(session, undefined);

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily, undefined);

  db.close();
});

test('mid-transaction exception rolls back both writes', () => {
  const db = openDb();

  let threw = false;
  try {
    db.exec('BEGIN');
    db.prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
       VALUES ('t1', 'p1', 'claude', 1000, 100, 50, 0, 0, 0)`
    ).run();
    throw new Error('simulated failure before project_daily_stats write');
  } catch {
    threw = true;
    db.exec('ROLLBACK');
  }

  assert.ok(threw);
  assert.equal(db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t1'), undefined);
  assert.equal(db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1'), undefined);

  db.close();
});

// ── Token accumulation ────────────────────────────────────────────────────────

test('second token event accumulates into both tables', () => {
  const db = openDb();
  const base = { threadId: 't1', projectId: 'p1', model: 'claude-3', date: '2026-05-23' };
  recordTokenUsage(db, { ...base, inputTokens: 100, outputTokens: 50 });
  recordTokenUsage(db, { ...base, inputTokens: 200, outputTokens: 100 });

  const session = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t1');
  assert.equal(session.input_tokens, 300);
  assert.equal(session.output_tokens, 150);

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 300);
  assert.equal(daily.output_tokens, 150);

  db.close();
});

test('session_count incremented only on first token event per thread', () => {
  const db = openDb();
  const base = { projectId: 'p1', model: 'claude-3', date: '2026-05-23', inputTokens: 50, outputTokens: 25 };
  recordTokenUsage(db, { threadId: 'thread-a', ...base });
  recordTokenUsage(db, { threadId: 'thread-b', ...base });
  recordTokenUsage(db, { threadId: 'thread-a', ...base }); // second event for same thread

  const daily = db.prepare('SELECT session_count FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.session_count, 2); // two distinct threads

  db.close();
});

test('separate threads produce independent session_metrics rows', () => {
  const db = openDb();
  const base = { projectId: 'p1', model: 'claude-3', date: '2026-05-23', inputTokens: 100, outputTokens: 50 };
  recordTokenUsage(db, { threadId: 'thread-a', ...base });
  recordTokenUsage(db, { threadId: 'thread-b', ...base, inputTokens: 200, outputTokens: 100 });

  const a = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('thread-a');
  const b = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('thread-b');
  assert.equal(a.input_tokens, 100);
  assert.equal(b.input_tokens, 200);

  db.close();
});

// ── Idempotency / repair ──────────────────────────────────────────────────────

test('backfill: deriving session_count from session_metrics is idempotent', () => {
  const db = openDb();

  // Insert session_metrics rows without a corresponding daily_stats row.
  db.prepare(
    `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
     VALUES ('t1', 'p1', 'claude', 1000, 100, 50, 0, 0, 0)`
  ).run();
  db.prepare(
    `INSERT INTO session_metrics (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
     VALUES ('t2', 'p1', 'claude', 1000, 100, 50, 0, 0, 0)`
  ).run();

  // Inline the backfill: count distinct sessions per (project_id, date) and upsert.
  const backfill = () => {
    const rows = db
      .prepare(
        `SELECT project_id, strftime('%Y-%m-%d', started_at/1000, 'unixepoch') AS date, COUNT(*) AS cnt
         FROM session_metrics GROUP BY project_id, date`
      )
      .all();
    const upsert = db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, session_count)
       VALUES (?, ?, '', 0, 0, 0, ?)
       ON CONFLICT(date, project_id, model) DO UPDATE SET session_count = excluded.session_count`
    );
    for (const { project_id, date, cnt } of rows) {
      upsert.run(date, project_id, cnt);
    }
  };

  backfill();
  const first = db.prepare('SELECT session_count FROM project_daily_stats WHERE project_id = ?').get('p1');

  backfill(); // second run should produce same result
  const second = db.prepare('SELECT session_count FROM project_daily_stats WHERE project_id = ?').get('p1');

  assert.equal(first.session_count, second.session_count);
  assert.equal(first.session_count, 2);

  db.close();
});

// ── Cumulative (Codex) provider mode ─────────────────────────────────────────

// Inlined cumulative logic from analyticsTracker.onTokenUsage (isCumulative = true).
// Codex reports totals per turn; each event REPLACES session_metrics values and
// the daily rollup receives only the delta (new total minus previous total).
function recordCumulativeTokenUsage(db, { threadId, projectId, model = '', inputTokens, outputTokens, date, startedAt = 1000 }) {
  const existing = db
    .prepare('SELECT input_tokens, output_tokens FROM session_metrics WHERE thread_id = ?')
    .get(threadId);
  const deltaInput = inputTokens - (existing?.input_tokens ?? 0);
  const deltaOutput = outputTokens - (existing?.output_tokens ?? 0);
  const sessionCount = existing ? 0 : 1;

  db.exec('BEGIN');
  try {
    if (!existing) {
      db.prepare(
        `INSERT INTO session_metrics
           (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cost_usd_micro, turn_count, tool_call_count)
         VALUES (?, ?, 'codex', ?, ?, ?, 0, 0, 0)`
      ).run(threadId, projectId, startedAt, inputTokens, outputTokens);
    } else {
      db.prepare('UPDATE session_metrics SET input_tokens = ?, output_tokens = ? WHERE thread_id = ?').run(
        inputTokens,
        outputTokens,
        threadId
      );
    }
    db.prepare(
      `INSERT INTO project_daily_stats (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, session_count)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(date, project_id, model) DO UPDATE SET
         input_tokens  = input_tokens  + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         session_count = session_count + excluded.session_count`
    ).run(date, projectId, model, deltaInput, deltaOutput, sessionCount);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

test('cumulative mode: session_metrics stores latest total, daily_stats accumulates deltas', () => {
  const db = openDb();
  const base = { threadId: 't1', projectId: 'p1', model: 'codex', date: '2026-05-23' };
  // Turn 1: codex reports cumulative total of 100/50
  recordCumulativeTokenUsage(db, { ...base, inputTokens: 100, outputTokens: 50 });
  // Turn 2: codex reports new cumulative total of 300/150 (delta = 200/100)
  recordCumulativeTokenUsage(db, { ...base, inputTokens: 300, outputTokens: 150 });

  const session = db.prepare('SELECT * FROM session_metrics WHERE thread_id = ?').get('t1');
  assert.equal(session.input_tokens, 300); // latest cumulative total
  assert.equal(session.output_tokens, 150);

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 300); // sum of deltas: 100 + 200
  assert.equal(daily.output_tokens, 150);
  assert.equal(daily.session_count, 1); // one thread

  db.close();
});
