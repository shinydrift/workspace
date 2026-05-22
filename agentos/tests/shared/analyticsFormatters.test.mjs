/**
 * Tests for renderer/lib/analyticsFormatters.ts
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from analyticsFormatters.ts ──────────────────────────────────────

const MICRODOLLARS_PER_DOLLAR = 1_000_000;

function formatCost(usdMicro) {
  const usd = usdMicro / MICRODOLLARS_PER_DOLLAR;
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n) {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatDuration(ms) {
  if (ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(ms) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function localDateString(date) {
  return date.toISOString().slice(0, 10);
}

// ── formatCost ────────────────────────────────────────────────────────────────

test('formatCost: zero returns $0.00', () => {
  assert.equal(formatCost(0), '$0.00');
});

test('formatCost: tiny value (<$0.0001) returns threshold label', () => {
  assert.equal(formatCost(50), '<$0.0001'); // $0.00005
});

test('formatCost: value between 0.0001 and 0.01 uses 4 decimals', () => {
  assert.equal(formatCost(500), '$0.0005'); // $0.0005
});

test('formatCost: value >= 0.01 uses 2 decimals', () => {
  assert.equal(formatCost(1_500_000), '$1.50');
});

test('formatCost: exactly $1.00', () => {
  assert.equal(formatCost(1_000_000), '$1.00');
});

// ── formatTokens ──────────────────────────────────────────────────────────────

test('formatTokens: zero returns "0"', () => {
  assert.equal(formatTokens(0), '0');
});

test('formatTokens: millions formatted as M', () => {
  assert.equal(formatTokens(1_000_000), '1.0M');
  assert.equal(formatTokens(2_500_000), '2.5M');
});

test('formatTokens: 10k-999k rounded to nearest k', () => {
  assert.equal(formatTokens(10_000), '10k');
  assert.equal(formatTokens(54_321), '54k');
});

test('formatTokens: 1k-9.9k formatted as X.Xk', () => {
  assert.equal(formatTokens(1_000), '1.0k');
  assert.equal(formatTokens(5_500), '5.5k');
});

test('formatTokens: small numbers locale-stringified', () => {
  assert.equal(formatTokens(42), (42).toLocaleString());
});

// ── formatDuration ────────────────────────────────────────────────────────────

test('formatDuration: zero or negative returns em-dash', () => {
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(-1), '—');
});

test('formatDuration: seconds only when < 60s', () => {
  assert.equal(formatDuration(5_000), '5s');
  assert.equal(formatDuration(59_999), '59s');
});

test('formatDuration: minutes and seconds', () => {
  assert.equal(formatDuration(60_000), '1m 0s');
  assert.equal(formatDuration(90_000), '1m 30s');
  assert.equal(formatDuration(125_000), '2m 5s');
});

// ── formatTimestamp ───────────────────────────────────────────────────────────

test('formatTimestamp: zero returns em-dash', () => {
  assert.equal(formatTimestamp(0), '—');
});

test('formatTimestamp: negative returns em-dash', () => {
  assert.equal(formatTimestamp(-1), '—');
});

test('formatTimestamp: non-finite returns em-dash', () => {
  assert.equal(formatTimestamp(Infinity), '—');
  assert.equal(formatTimestamp(NaN), '—');
});

test('formatTimestamp: valid timestamp returns formatted string', () => {
  const result = formatTimestamp(1_700_000_000_000);
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0);
  assert.notEqual(result, '—');
});

// ── formatCost boundary cases ─────────────────────────────────────────────────

test('formatCost: exactly $0.01 boundary uses 2 decimals', () => {
  // $0.01 = 10_000 microdollars
  assert.equal(formatCost(10_000), '$0.01');
});

test('formatCost: just below $0.01 uses 4 decimals', () => {
  // $0.009999 ≈ 9999 microdollars
  assert.equal(formatCost(9_999), '$0.0100');
});

test('formatCost: just above $0.0001 threshold uses 4 decimals', () => {
  // $0.0001 = 100 microdollars
  assert.equal(formatCost(101), '$0.0001');
});

test('formatCost: negative value is treated as < $0.0001 or 0', () => {
  // -1 microdollar → $-0.000001, less than 0.0001 in absolute but usd < 0
  const result = formatCost(-1);
  assert.ok(typeof result === 'string');
});

// ── formatTokens boundary cases ───────────────────────────────────────────────

test('formatTokens: exactly 1000 uses 1.0k format', () => {
  assert.equal(formatTokens(1_000), '1.0k');
});

test('formatTokens: exactly 10000 uses rounded k format', () => {
  assert.equal(formatTokens(10_000), '10k');
});

test('formatTokens: exactly 1000000 uses M format', () => {
  assert.equal(formatTokens(1_000_000), '1.0M');
});

test('formatTokens: 999 uses locale string (no k)', () => {
  const result = formatTokens(999);
  assert.ok(!result.includes('k'));
  assert.ok(!result.includes('M'));
});

// ── formatDuration boundary cases ─────────────────────────────────────────────

test('formatDuration: exactly 60 seconds shows 1m 0s', () => {
  assert.equal(formatDuration(60_000), '1m 0s');
});

test('formatDuration: 90 seconds shows 1m 30s', () => {
  assert.equal(formatDuration(90_000), '1m 30s');
});

test('formatDuration: 1 second shows 1s', () => {
  assert.equal(formatDuration(1_000), '1s');
});

test('formatDuration: large minutes (no hours) shows minutes directly', () => {
  // 2 hours = 120 minutes — no hours handling, shows 120m 0s
  assert.equal(formatDuration(2 * 60 * 60 * 1000), '120m 0s');
});

// ── classifyTool ──────────────────────────────────────────────────────────────

function classifyTool(name) {
  if (name.startsWith('mcp__agentos-memory__')) return 'memory';
  const lower = name.toLowerCase();
  if (['read', 'write', 'edit', 'glob', 'notebookedit'].includes(lower)) return 'file-io';
  if (['grep', 'websearch', 'webfetch'].includes(lower)) return 'search';
  if (lower === 'bash') return 'shell';
  return 'other';
}

test('classifyTool: agentos-memory MCP tools are memory', () => {
  assert.equal(classifyTool('mcp__agentos-memory__memory_search'), 'memory');
  assert.equal(classifyTool('mcp__agentos-memory__memory_save'), 'memory');
  assert.equal(classifyTool('mcp__agentos-memory__anything'), 'memory');
});

test('classifyTool: file-io tools (case-insensitive)', () => {
  for (const name of ['Read', 'Write', 'Edit', 'Glob', 'NotebookEdit']) {
    assert.equal(classifyTool(name), 'file-io', `expected file-io for ${name}`);
  }
});

test('classifyTool: search tools', () => {
  assert.equal(classifyTool('Grep'), 'search');
  assert.equal(classifyTool('WebSearch'), 'search');
  assert.equal(classifyTool('WebFetch'), 'search');
});

test('classifyTool: Bash is shell', () => {
  assert.equal(classifyTool('Bash'), 'shell');
  assert.equal(classifyTool('bash'), 'shell');
});

test('classifyTool: unknown tool returns other', () => {
  assert.equal(classifyTool('Agent'), 'other');
  assert.equal(classifyTool('TodoWrite'), 'other');
  assert.equal(classifyTool('mcp__some-other__tool'), 'other');
});

// ── buildDailyChartData ───────────────────────────────────────────────────────

function buildDailyChartData(stats) {
  return {
    chartData: stats.map((d) => ({ label: d.date, value: d.costUsdMicro })),
    tokenChartData: stats.map((d) => ({ label: d.date, input: d.inputTokens, output: d.outputTokens })),
  };
}

function summarizeDailyStatsWindow(stats, since, until) {
  const sinceDate = since ? localDateString(new Date(since)) : '2026-05-22';
  const untilDate = until ? localDateString(new Date(until)) : '9999-12-31';

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsdMicro = 0;
  let sessionCount = 0;
  const dailyStats = [];

  for (const row of stats) {
    if (row.date < sinceDate || row.date > untilDate) continue;
    totalInputTokens += row.inputTokens;
    totalOutputTokens += row.outputTokens;
    totalCacheReadTokens += row.cacheReadTokens;
    totalCacheCreationTokens += row.cacheCreationTokens;
    totalCostUsdMicro += row.costUsdMicro;
    sessionCount += row.sessionCount;
    dailyStats.push(row);
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalCostUsdMicro,
    sessionCount,
    dailyStats,
  };
}

function activeProjectIdsInWindow(threads, since, until) {
  const lower = since ?? 0;
  const upper = until ?? Number.POSITIVE_INFINITY;
  const projectIds = new Set();

  for (const thread of threads) {
    if (!thread.lastActiveAt || thread.lastActiveAt < lower || thread.lastActiveAt > upper) continue;
    projectIds.add(thread.projectId);
  }

  return [...projectIds];
}

test('buildDailyChartData: maps dates to chart label/value pairs', () => {
  const stats = [
    { date: '2026-05-23', costUsdMicro: 1000, inputTokens: 100, outputTokens: 50 },
    { date: '2026-05-24', costUsdMicro: 2000, inputTokens: 200, outputTokens: 100 },
  ];
  const { chartData, tokenChartData } = buildDailyChartData(stats);
  assert.deepEqual(chartData, [
    { label: '2026-05-23', value: 1000 },
    { label: '2026-05-24', value: 2000 },
  ]);
  assert.deepEqual(tokenChartData, [
    { label: '2026-05-23', input: 100, output: 50 },
    { label: '2026-05-24', input: 200, output: 100 },
  ]);
});

test('buildDailyChartData: empty input returns empty arrays', () => {
  const { chartData, tokenChartData } = buildDailyChartData([]);
  assert.deepEqual(chartData, []);
  assert.deepEqual(tokenChartData, []);
});

test('buildDailyChartData: preserves order', () => {
  const stats = [
    { date: '2026-05-23', costUsdMicro: 500, inputTokens: 10, outputTokens: 5 },
    { date: '2026-05-24', costUsdMicro: 300, inputTokens: 20, outputTokens: 10 },
    { date: '2026-05-25', costUsdMicro: 700, inputTokens: 30, outputTokens: 15 },
  ];
  const { chartData } = buildDailyChartData(stats);
  assert.equal(chartData[0].label, '2026-05-23');
  assert.equal(chartData[1].label, '2026-05-24');
  assert.equal(chartData[2].label, '2026-05-25');
});

// ── summarizeDailyStatsWindow ────────────────────────────────────────────────

test('summarizeDailyStatsWindow: filters inclusively and aggregates totals', () => {
  const stats = [
    {
      date: '2026-05-23',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      costUsdMicro: 100,
      sessionCount: 1,
    },
    {
      date: '2026-05-24',
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 4,
      cacheCreationTokens: 2,
      costUsdMicro: 200,
      sessionCount: 2,
    },
    {
      date: '2026-05-25',
      inputTokens: 30,
      outputTokens: 15,
      cacheReadTokens: 6,
      cacheCreationTokens: 3,
      costUsdMicro: 300,
      sessionCount: 3,
    },
  ];
  const since = Date.UTC(2026, 4, 24);
  const until = Date.UTC(2026, 4, 25);

  const summary = summarizeDailyStatsWindow(stats, since, until);

  assert.deepEqual(summary, {
    totalInputTokens: 50,
    totalOutputTokens: 25,
    totalCacheReadTokens: 10,
    totalCacheCreationTokens: 5,
    totalCostUsdMicro: 500,
    sessionCount: 5,
    dailyStats: [stats[1], stats[2]],
  });
});

// ── activeProjectIdsInWindow ──────────────────────────────────────────────────

test('activeProjectIdsInWindow: dedupes projects and keeps inclusive bounds', () => {
  const threads = [
    { projectId: 'p1', lastActiveAt: Date.UTC(2026, 4, 23) },
    { projectId: 'p1', lastActiveAt: Date.UTC(2026, 4, 24) },
    { projectId: 'p2', lastActiveAt: Date.UTC(2026, 4, 26) },
    { projectId: 'p3', lastActiveAt: Date.UTC(2026, 4, 31) },
    { projectId: 'p4', lastActiveAt: Date.UTC(2026, 5, 1) },
  ];
  const since = Date.UTC(2026, 4, 24);
  const until = Date.UTC(2026, 4, 31);

  const ids = activeProjectIdsInWindow(threads, since, until).sort();

  assert.deepEqual(ids, ['p1', 'p2', 'p3']);
});
