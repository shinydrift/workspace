/**
 * Regression tests for the cache_read handling in analyticsTracker.onTokenUsage().
 *
 * Regression context: a previous rollup change dropped the `isCumulative` gate on the
 * `deltaInput - deltaCacheRead` subtraction in the daily rollup write. Claude reports
 * `input_tokens` as the unique (uncached) input — non-overlapping with `cache_read`.
 * The unconditional subtraction wrote `project_daily_stats.input_tokens` as
 * `(small_unique_input - large_cache_read)`, producing massive negative rollup rows.
 *
 * Logic mirrored (NOT imported) from analyticsTracker.onTokenUsage. better-sqlite3
 * requires Electron's native ABI, so we use node:sqlite with the same SQL. Keep this
 * snippet aligned with the production code if rollup semantics change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_metrics (
  thread_id             TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  provider              TEXT NOT NULL,
  model                 TEXT,
  started_at            INTEGER NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro        INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0
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

// Mirrors analyticsTracker.onTokenUsage's input-token bookkeeping.
function recordTokenUsage(db, event) {
  const {
    threadId,
    projectId,
    provider,
    model = '',
    inputTokens,
    outputTokens,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
    date,
  } = event;
  const isCumulative = provider === 'codex';

  const existing = db
    .prepare(
      'SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM session_metrics WHERE thread_id = ?'
    )
    .get(threadId);

  const newInput = isCumulative ? inputTokens : (existing?.input_tokens ?? 0) + inputTokens;
  const newCacheRead = isCumulative ? cacheReadTokens : (existing?.cache_read_tokens ?? 0) + cacheReadTokens;

  const rawDeltaInput = newInput - (existing?.input_tokens ?? 0);
  const rawDeltaCacheRead = newCacheRead - (existing?.cache_read_tokens ?? 0);
  const deltaInput = isCumulative ? Math.max(0, rawDeltaInput) : inputTokens;
  const deltaCacheRead = isCumulative ? Math.max(0, rawDeltaCacheRead) : cacheReadTokens;

  // The fix: only subtract cache_read from input for cumulative providers.
  const uniqueDeltaInput = isCumulative ? Math.max(0, deltaInput - deltaCacheRead) : deltaInput;

  const sessionCount = existing ? 0 : 1;

  db.exec('BEGIN');
  try {
    if (!existing) {
      db.prepare(
        `INSERT INTO session_metrics
           (thread_id, project_id, provider, started_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
         VALUES (?, ?, ?, 1000, ?, ?, ?, ?)`
      ).run(threadId, projectId, provider, newInput, outputTokens, newCacheRead, cacheCreationTokens);
    } else {
      db.prepare('UPDATE session_metrics SET input_tokens = ?, cache_read_tokens = ? WHERE thread_id = ?').run(
        newInput,
        newCacheRead,
        threadId
      );
    }
    db.prepare(
      `INSERT INTO project_daily_stats
         (date, project_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, session_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, project_id, model) DO UPDATE SET
         input_tokens          = input_tokens          + excluded.input_tokens,
         cache_read_tokens     = cache_read_tokens     + excluded.cache_read_tokens,
         cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
         session_count         = session_count         + excluded.session_count`
    ).run(date, projectId, model, uniqueDeltaInput, outputTokens, deltaCacheRead, cacheCreationTokens, sessionCount);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

test('Claude (non-cumulative): rollup input_tokens equals event inputTokens, NOT subtracted by cache_read', () => {
  const db = openDb();
  // Realistic Claude turn with prompt caching: small unique input, huge cache_read.
  recordTokenUsage(db, {
    threadId: 'claude-1',
    projectId: 'p1',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    inputTokens: 1280,
    outputTokens: 7687,
    cacheReadTokens: 778057,
    cacheCreationTokens: 33686,
    date: '2026-05-23',
  });

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 1280, 'rollup input must NOT be (input - cache_read)');
  assert.equal(daily.cache_read_tokens, 778057);
  assert.ok(daily.input_tokens > 0, 'rollup input must never go negative for non-cumulative providers');
  db.close();
});

test('Codex (cumulative): rollup input_tokens is unique (input minus cache_read)', () => {
  const db = openDb();
  // Codex reports cumulative gross totals; input includes cache_read.
  recordTokenUsage(db, {
    threadId: 'codex-1',
    projectId: 'p1',
    provider: 'codex',
    model: 'gpt-5',
    inputTokens: 100000,
    outputTokens: 500,
    cacheReadTokens: 90000,
    cacheCreationTokens: 0,
    date: '2026-05-23',
  });

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 10000, 'cumulative rollup input must be (input - cache_read)');
  assert.equal(daily.cache_read_tokens, 90000);
  db.close();
});

test('Codex (cumulative): negative cache_read deltas (out-of-order events) are clamped to 0', () => {
  const db = openDb();
  recordTokenUsage(db, {
    threadId: 'codex-2',
    projectId: 'p1',
    provider: 'codex',
    model: 'gpt-5',
    inputTokens: 50000,
    outputTokens: 100,
    cacheReadTokens: 40000,
    cacheCreationTokens: 0,
    date: '2026-05-23',
  });
  // Counter resets / arrives lower — should not produce a negative rollup row.
  recordTokenUsage(db, {
    threadId: 'codex-2',
    projectId: 'p1',
    provider: 'codex',
    model: 'gpt-5',
    inputTokens: 30000,
    outputTokens: 50,
    cacheReadTokens: 20000,
    cacheCreationTokens: 0,
    date: '2026-05-23',
  });

  const daily = db
    .prepare('SELECT input_tokens, cache_read_tokens FROM project_daily_stats WHERE project_id = ?')
    .get('p1');
  assert.ok(daily.input_tokens >= 0, 'rollup input_tokens must never be negative');
  assert.ok(daily.cache_read_tokens >= 0, 'rollup cache_read_tokens must never be negative');
  db.close();
});

test('Claude: multiple emits accumulate cache_read positively in rollup', () => {
  const db = openDb();
  const base = {
    threadId: 'claude-2',
    projectId: 'p1',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    date: '2026-05-23',
  };
  recordTokenUsage(db, {
    ...base,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 50000,
    cacheCreationTokens: 1000,
  });
  recordTokenUsage(db, {
    ...base,
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 80000,
    cacheCreationTokens: 2000,
  });

  const daily = db.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1');
  assert.equal(daily.input_tokens, 300);
  assert.equal(daily.cache_read_tokens, 130000);
  assert.equal(daily.cache_creation_tokens, 3000);
  db.close();
});

// ── recordAutomationRun: provider-aware uniqueInput for cost calc ─────────────
//
// Mirrors the cost-calc logic in analyticsTracker.recordAutomationRun. session_metrics
// stores Claude/Gemini input as already-net (cache_read separate) and Codex input as
// gross (cache_read included), so cost should subtract cache_read only for Codex.

function automationRunUniqueInput(provider, inputTokens, cacheReadTokens) {
  return provider === 'codex' ? Math.max(0, inputTokens - cacheReadTokens) : inputTokens;
}

test('recordAutomationRun: Claude session metrics → uniqueInput is the stored input as-is', () => {
  // Claude session_metrics row: small unique input, large separate cache_read.
  const unique = automationRunUniqueInput('claude', 1280, 778057);
  assert.equal(unique, 1280, 'Claude input must NOT be subtracted by cache_read');
});

test('recordAutomationRun: Codex session metrics → uniqueInput subtracts cache_read', () => {
  // Codex stores gross input that includes cache_read.
  const unique = automationRunUniqueInput('codex', 100000, 90000);
  assert.equal(unique, 10000, 'Codex input must be (input - cache_read)');
});

test('recordAutomationRun: Codex with cache_read > input → uniqueInput clamped to 0, never negative', () => {
  // Defensive: if upstream data is inconsistent, cost calc must not see a negative input charge.
  const unique = automationRunUniqueInput('codex', 500, 90000);
  assert.equal(unique, 0);
});

test('recordAutomationRun: empty/null provider → treated as non-cumulative (no subtraction)', () => {
  // Stub session_metrics rows have provider='' before the first token event. Should not crash.
  assert.equal(automationRunUniqueInput('', 1280, 778057), 1280);
  assert.equal(automationRunUniqueInput(null, 1280, 778057), 1280);
});
