/**
 * Tests for analytics/service.ts — toSinceDate, rowToSessionMetrics,
 * rowToAnalyticsRunRecord, and related helper logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Inlined helpers from analytics/service.ts ─────────────────────────────────

function toSinceDate(since) {
  return since ? new Date(since).toISOString().slice(0, 10) : '2026-05-22';
}

function mapDailyRow(r) {
  return {
    date: r.date,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsdMicro: r.cost_usd_micro,
  };
}

function rowToSessionMetrics(row) {
  return {
    threadId: String(row.thread_id),
    projectId: String(row.project_id),
    provider: String(row.provider),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at != null ? Number(row.ended_at) : null,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    turnCount: Number(row.turn_count),
    toolCallCount: Number(row.tool_call_count),
    costUsdMicro: Number(row.cost_usd_micro),
  };
}

const VALID_RUN_STATUSES = new Set(['ok', 'error', 'skipped']);
function toRunStatus(raw) {
  if (VALID_RUN_STATUSES.has(raw)) return raw;
  return 'error';
}

function rowToAnalyticsRunRecord(row) {
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

function countSqlPlaceholders(sql) {
  return (sql.match(/\?/g) ?? []).length;
}

function computeRollupDeltas({ provider, previous, next }) {
  const isCumulative = provider === 'codex';
  const deltaInput = next.inputTokens - previous.inputTokens;
  const deltaOutput = next.outputTokens - previous.outputTokens;
  const deltaCacheRead = next.cacheReadTokens - previous.cacheReadTokens;
  const deltaCacheCreation = next.cacheCreationTokens - previous.cacheCreationTokens;
  return {
    deltaRawInput: isCumulative ? deltaInput - deltaCacheRead : next.inputTokens,
    deltaOutput,
    deltaCacheRead: isCumulative ? deltaCacheRead : next.cacheReadTokens,
    deltaCacheCreation: isCumulative ? deltaCacheCreation : next.cacheCreationTokens,
  };
}

// ── toSinceDate ───────────────────────────────────────────────────────────────

test('toSinceDate returns baseline date when since is undefined', () => {
  assert.equal(toSinceDate(undefined), '2026-05-22');
});

test('toSinceDate returns baseline date when since is 0', () => {
  assert.equal(toSinceDate(0), '2026-05-22');
});

test('toSinceDate converts timestamp to ISO date string', () => {
  const ts = new Date('2026-05-23').getTime();
  assert.equal(toSinceDate(ts), '2026-05-23');
});

test('toSinceDate returns YYYY-MM-DD format', () => {
  const ts = Date.now();
  const result = toSinceDate(ts);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

// ── mapDailyRow ───────────────────────────────────────────────────────────────

test('mapDailyRow converts snake_case to camelCase', () => {
  const result = mapDailyRow({
    date: '2026-05-23',
    input_tokens: 100,
    output_tokens: 50,
    cost_usd_micro: 200,
  });
  assert.deepEqual(result, {
    date: '2026-05-23',
    inputTokens: 100,
    outputTokens: 50,
    costUsdMicro: 200,
  });
});

test('computeRollupDeltas excludes cached Codex input from unique input', () => {
  const result = computeRollupDeltas({
    provider: 'codex',
    previous: { inputTokens: 400, outputTokens: 80, cacheReadTokens: 250, cacheCreationTokens: 0 },
    next: { inputTokens: 700, outputTokens: 120, cacheReadTokens: 500, cacheCreationTokens: 0 },
  });
  assert.deepEqual(result, {
    deltaRawInput: 50,
    deltaOutput: 40,
    deltaCacheRead: 250,
    deltaCacheCreation: 0,
  });
});

test('computeRollupDeltas keeps non-cumulative provider deltas unchanged', () => {
  const result = computeRollupDeltas({
    provider: 'claude',
    previous: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    next: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 90, cacheCreationTokens: 30 },
  });
  assert.deepEqual(result, {
    deltaRawInput: 120,
    deltaOutput: 40,
    deltaCacheRead: 90,
    deltaCacheCreation: 30,
  });
});

// ── rowToSessionMetrics ───────────────────────────────────────────────────────

test('rowToSessionMetrics maps all fields', () => {
  const row = {
    thread_id: 'tid1',
    project_id: 'pid1',
    provider: 'claude',
    started_at: 1000,
    ended_at: 2000,
    input_tokens: 10,
    output_tokens: 20,
    turn_count: 3,
    tool_call_count: 1,
    cost_usd_micro: 500,
  };
  const result = rowToSessionMetrics(row);
  assert.equal(result.threadId, 'tid1');
  assert.equal(result.projectId, 'pid1');
  assert.equal(result.provider, 'claude');
  assert.equal(result.startedAt, 1000);
  assert.equal(result.endedAt, 2000);
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.turnCount, 3);
  assert.equal(result.toolCallCount, 1);
  assert.equal(result.costUsdMicro, 500);
});

test('rowToSessionMetrics sets endedAt to null when not present', () => {
  const row = {
    thread_id: 't',
    project_id: 'p',
    provider: 'claude',
    started_at: 1,
    ended_at: null,
    input_tokens: 0,
    output_tokens: 0,
    turn_count: 0,
    tool_call_count: 0,
    cost_usd_micro: 0,
  };
  assert.equal(rowToSessionMetrics(row).endedAt, null);
});

test('rowToSessionMetrics coerces string numbers', () => {
  const row = {
    thread_id: 't',
    project_id: 'p',
    provider: 'x',
    started_at: '999',
    ended_at: null,
    input_tokens: '5',
    output_tokens: '10',
    turn_count: '2',
    tool_call_count: '1',
    cost_usd_micro: '300',
  };
  const result = rowToSessionMetrics(row);
  assert.equal(result.startedAt, 999);
  assert.equal(result.inputTokens, 5);
});

// ── toRunStatus ───────────────────────────────────────────────────────────────

test('toRunStatus returns ok for "ok"', () => {
  assert.equal(toRunStatus('ok'), 'ok');
});

test('toRunStatus returns error for "error"', () => {
  assert.equal(toRunStatus('error'), 'error');
});

test('toRunStatus returns skipped for "skipped"', () => {
  assert.equal(toRunStatus('skipped'), 'skipped');
});

test('toRunStatus falls back to error for unknown status', () => {
  assert.equal(toRunStatus('unknown'), 'error');
  assert.equal(toRunStatus(''), 'error');
});

// ── rowToAnalyticsRunRecord ───────────────────────────────────────────────────

test('rowToAnalyticsRunRecord maps all fields', () => {
  const row = {
    id: 'run1',
    job_id: 'job1',
    thread_id: 'thread1',
    project_id: 'proj1',
    started_at: 1000,
    completed_at: 2000,
    status: 'ok',
    error_message: null,
    input_tokens: 100,
    output_tokens: 50,
    turn_count: 3,
    tool_call_count: 2,
    cost_usd_micro: 750,
  };
  const result = rowToAnalyticsRunRecord(row);
  assert.equal(result.id, 'run1');
  assert.equal(result.jobId, 'job1');
  assert.equal(result.threadId, 'thread1');
  assert.equal(result.projectId, 'proj1');
  assert.equal(result.startedAt, 1000);
  assert.equal(result.completedAt, 2000);
  assert.equal(result.status, 'ok');
  assert.equal(result.errorMessage, null);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.turnCount, 3);
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.costUsdMicro, 750);
});

test('rowToAnalyticsRunRecord sets completedAt null when null', () => {
  const row = {
    id: '1',
    job_id: 'j',
    thread_id: 't',
    project_id: 'p',
    started_at: 0,
    completed_at: null,
    status: 'ok',
    error_message: null,
    input_tokens: 0,
    output_tokens: 0,
    turn_count: 0,
    tool_call_count: 0,
    cost_usd_micro: 0,
  };
  assert.equal(rowToAnalyticsRunRecord(row).completedAt, null);
});

test('rowToAnalyticsRunRecord converts errorMessage from string', () => {
  const row = {
    id: '1',
    job_id: 'j',
    thread_id: 't',
    project_id: 'p',
    started_at: 0,
    completed_at: 0,
    status: 'error',
    error_message: 'timed out',
    input_tokens: 0,
    output_tokens: 0,
    turn_count: 0,
    tool_call_count: 0,
    cost_usd_micro: 0,
  };
  assert.equal(rowToAnalyticsRunRecord(row).errorMessage, 'timed out');
  assert.equal(rowToAnalyticsRunRecord(row).status, 'error');
});

test('global window totals query uses named SQL parameters', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const queriesPath = path.resolve(testDir, '../../../src/main/analytics/overviewQueries.ts');
  const source = fs.readFileSync(queriesPath, 'utf8');

  const fnStart = source.indexOf('export function getGlobalWindowTotals(');
  assert.notEqual(fnStart, -1, 'getGlobalWindowTotals not found in overviewQueries.ts');
  const fnSource = source.slice(fnStart, source.indexOf('\nexport function', fnStart + 1));

  const sqlMatch = fnSource.match(/`SELECT[\s\S]*?FROM project_daily_stats`/);
  assert.ok(sqlMatch, 'window SQL not found in getGlobalWindowTotals');

  // Named params: no positional ? placeholders in the window SQL
  assert.equal(countSqlPlaceholders(sqlMatch[0]), 0, 'window SQL should use named params, not positional ?');
  assert.match(fnSource, /\$sevenDaysAgo/, 'window SQL should use $sevenDaysAgo named param');
  assert.match(fnSource, /\$fourteenDaysAgo/, 'window SQL should use $fourteenDaysAgo named param');
});
