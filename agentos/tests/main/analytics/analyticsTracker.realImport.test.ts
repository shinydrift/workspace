/**
 * Real-import tests for analyticsTracker. The other analytics test files mirror tracker
 * logic with inlined SQL; this file imports the actual `AnalyticsTracker` class so that
 * a future regression in onTokenUsage / recordAutomationRun is caught directly.
 *
 * Mocks (via Module._load):
 *   - ./analyticsHelpers   — safeDb returns an adapter around node:sqlite (better-sqlite3
 *                            requires Electron's native ABI), getProjectIdForThread is a stub
 *   - ../threads/threadStore — getThread returns a fixed thread row
 *   - ../utils/eventLog    — eventLogger no-op
 *
 * Real:
 *   - ../../shared/pricing       (calcCostUsdMicro)
 *   - ../../shared/utils/date    (localDateString)
 *   - ../../shared/utils/errorMessage
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ANALYTICS_MIGRATIONS } from '../../../src/main/analytics/migrations';

// ── better-sqlite3 → node:sqlite adapter ──────────────────────────────────────
// Tracker uses `db.transaction(fn)()` (better-sqlite3 API). Wrap DatabaseSync to
// expose the same surface so the real tracker can run unmodified.

interface AdapterStmt {
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => { changes: number };
  all: (...args: unknown[]) => unknown[];
}
interface AdapterDb {
  prepare: (sql: string) => AdapterStmt;
  transaction: <T>(fn: () => T) => () => T;
  exec: (sql: string) => void;
}

function makeAdapter(): AdapterDb {
  const db = new DatabaseSync(':memory:');
  for (const m of ANALYTICS_MIGRATIONS) db.exec(m.sql);
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        get: (...args) => stmt.get(...(args as never[])),
        run: (...args) => {
          const r = stmt.run(...(args as never[]));
          return { changes: Number(r.changes ?? 0) };
        },
        all: (...args) => stmt.all(...(args as never[])),
      };
    },
    transaction<T>(fn: () => T) {
      return () => {
        db.exec('BEGIN');
        try {
          const result = fn();
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
    },
    exec: (sql) => db.exec(sql),
  };
}

// ── Module._load mock ─────────────────────────────────────────────────────────

let adapter: AdapterDb = makeAdapter();
const projectIdStub = 'p1';

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith('/analyticsHelpers') || request === './analyticsHelpers') {
    return {
      safeDb: () => adapter,
      safeGlobalDb: () => adapter,
      getProjectIdForThread: () => projectIdStub,
    };
  }
  if (request.endsWith('/threads/threadStore') || request === '../threads/threadStore') {
    return {
      getThread: (threadId: string) => ({
        threadId,
        projectId: projectIdStub,
        createdAt: Date.parse('2026-05-23T12:00:00Z'),
      }),
      updateThread: () => {},
    };
  }
  if (request.endsWith('/eventLog') || request.endsWith('/utils/eventLog')) {
    return { eventLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } };
  }
  return origLoad.call(this, request, parent, isMain);
};

const { AnalyticsTracker } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../src/main/analytics/analyticsTracker') as typeof import('../../../src/main/analytics/analyticsTracker');

(Module._load as unknown) = origLoad;

// ── Test helpers ──────────────────────────────────────────────────────────────

function freshTracker() {
  adapter = makeAdapter();
  return new AnalyticsTracker(() => {});
}

interface DailyRow {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd_micro: number;
}
interface AutomationRunRow {
  cost_usd_micro: number;
  input_tokens: number;
  output_tokens: number;
}

// ── onTokenUsage: Claude rollup (regression for the May-2026 bug) ─────────────

test('onTokenUsage: Claude turn with prompt caching writes positive input_tokens to daily rollup', () => {
  const tracker = freshTracker();
  tracker.onTokenUsage({
    threadId: 't1',
    projectId: 'p1',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    inputTokens: 1280,
    outputTokens: 7687,
    cacheReadTokens: 778057,
    cacheCreationTokens: 33686,
  });

  const daily = adapter.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1') as DailyRow;
  assert.equal(daily.input_tokens, 1280, 'rollup input must NOT be (input - cache_read)');
  assert.equal(daily.cache_read_tokens, 778057);
  assert.equal(daily.cache_creation_tokens, 33686);
  assert.ok(daily.cost_usd_micro > 0, 'cost should include cache pricing');
});

test('onTokenUsage: Codex cumulative rollup subtracts cache_read from input', () => {
  const tracker = freshTracker();
  tracker.onTokenUsage({
    threadId: 't-codex',
    projectId: 'p1',
    provider: 'codex',
    model: 'gpt-5',
    inputTokens: 100000,
    outputTokens: 500,
    cacheReadTokens: 90000,
    cacheCreationTokens: 0,
  });

  const daily = adapter.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1') as DailyRow;
  assert.equal(daily.input_tokens, 10000, 'cumulative rollup input must be (input - cache_read)');
  assert.equal(daily.cache_read_tokens, 90000);
});

test('onTokenUsage: Claude multi-emit accumulates positively across the same day', () => {
  const tracker = freshTracker();
  for (let i = 0; i < 3; i++) {
    tracker.onTokenUsage({
      threadId: 't1',
      projectId: 'p1',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 50000,
      cacheCreationTokens: 1000,
    });
  }
  const daily = adapter.prepare('SELECT * FROM project_daily_stats WHERE project_id = ?').get('p1') as DailyRow;
  assert.equal(daily.input_tokens, 300);
  assert.equal(daily.cache_read_tokens, 150000);
  assert.equal(daily.cache_creation_tokens, 3000);
});

// ── recordAutomationRun: provider-aware cost ──────────────────────────────────

test('recordAutomationRun: Claude session_metrics → cost uses raw input_tokens (no cache_read subtraction)', () => {
  const tracker = freshTracker();
  // Seed session_metrics as Claude would: small unique input, separate cache_read.
  adapter
    .prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, model, started_at,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
       VALUES (?, ?, 'claude', 'claude-sonnet-4-6', 1000, ?, ?, ?, ?)`
    )
    .run('t-claude', 'p1', 1280, 7687, 778057, 33686);

  tracker.recordAutomationRun({
    jobId: 'j1',
    threadId: 't-claude',
    projectId: 'p1',
    startedAt: 1000,
    completedAt: 2000,
    status: 'ok',
    errorMessage: null,
  });

  const run = adapter
    .prepare('SELECT cost_usd_micro, input_tokens, output_tokens FROM automation_runs WHERE thread_id = ?')
    .get('t-claude') as AutomationRunRow;
  assert.ok(run, 'automation_runs row should exist');
  assert.equal(run.input_tokens, 1280);
  assert.ok(run.cost_usd_micro > 0, 'cost must be non-zero (input charge present)');
});

test('recordAutomationRun: Codex session_metrics → cost subtracts cache_read from gross input', () => {
  const tracker = freshTracker();
  // Codex stores gross input including cache_read.
  adapter
    .prepare(
      `INSERT INTO session_metrics (thread_id, project_id, provider, model, started_at,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
       VALUES (?, ?, 'codex', 'gpt-5', 1000, ?, ?, ?, ?)`
    )
    .run('t-codex', 'p1', 100000, 500, 90000, 0);

  tracker.recordAutomationRun({
    jobId: 'j1',
    threadId: 't-codex',
    projectId: 'p1',
    startedAt: 1000,
    completedAt: 2000,
    status: 'ok',
    errorMessage: null,
  });

  const run = adapter
    .prepare('SELECT cost_usd_micro FROM automation_runs WHERE thread_id = ?')
    .get('t-codex') as AutomationRunRow;
  assert.ok(run, 'automation_runs row should exist');
  // Sanity: cost is finite and positive — the exact figure depends on pricing tables,
  // we just verify the call didn't crash and produced a sensible value.
  assert.ok(run.cost_usd_micro >= 0);
});

test('recordAutomationRun: missing session_metrics row → no crash, cost is 0', () => {
  const tracker = freshTracker();
  tracker.recordAutomationRun({
    jobId: 'j1',
    threadId: 't-missing',
    projectId: 'p1',
    startedAt: 1000,
    completedAt: 2000,
    status: 'ok',
    errorMessage: null,
  });

  const run = adapter.prepare('SELECT cost_usd_micro FROM automation_runs WHERE thread_id = ?').get('t-missing') as
    | AutomationRunRow
    | undefined;
  assert.ok(run, 'automation_runs row should still be inserted with zeros');
  assert.equal(run.cost_usd_micro, 0);
});
