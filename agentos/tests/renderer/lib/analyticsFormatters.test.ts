import { test, expect } from 'vitest';
import {
  formatCost,
  formatTokens,
  formatDuration,
  buildDailyChartData,
  buildHeatmapData,
  summarizeDailyStatsWindow,
  activeProjectIdsInWindow,
  classifyTool,
  calcDelta,
  formatTimestamp,
} from '../../../src/renderer/lib/analyticsFormatters';

// ── formatCost ────────────────────────────────────────────────────────────────

test('formatCost: zero → $0.00', () => {
  expect(formatCost(0)).toBe('$0.00');
});

test('formatCost: sub-0.0001 USD → <$0.0001', () => {
  expect(formatCost(10)).toBe('<$0.0001'); // 10 microdollars = 0.00001 USD
});

test('formatCost: 0.0001–0.01 USD → 4 decimal places', () => {
  expect(formatCost(5000).startsWith('$0.005')).toBeTruthy(); // 5000 micro = $0.005
});

test('formatCost: ≥$0.01 → 2 decimal places', () => {
  expect(formatCost(1_000_000)).toBe('$1.00');
  expect(formatCost(2_500_000)).toBe('$2.50');
});

// ── formatTokens ──────────────────────────────────────────────────────────────

test('formatTokens: 0 → "0"', () => {
  expect(formatTokens(0)).toBe('0');
});

test('formatTokens: small number → locale string', () => {
  expect(formatTokens(999)).toBe('999');
});

test('formatTokens: 1k → 1.0k', () => {
  expect(formatTokens(1000)).toBe('1.0k');
});

test('formatTokens: ≥10k → rounded k', () => {
  expect(formatTokens(15000)).toBe('15k');
});

test('formatTokens: ≥1M → M suffix', () => {
  expect(formatTokens(1_500_000)).toBe('1.5M');
});

// ── formatDuration ────────────────────────────────────────────────────────────

test('formatDuration: 0 or negative → —', () => {
  expect(formatDuration(0)).toBe('—');
  expect(formatDuration(-1)).toBe('—');
});

test('formatDuration: under a minute → seconds only', () => {
  expect(formatDuration(30_000)).toBe('30s');
});

test('formatDuration: ≥60s → minutes and seconds', () => {
  expect(formatDuration(90_000)).toBe('1m 30s');
  expect(formatDuration(3661_000)).toBe('61m 1s');
});

// ── buildDailyChartData ───────────────────────────────────────────────────────

test('buildDailyChartData: always returns 30 entries', () => {
  const { chartData, tokenChartData } = buildDailyChartData([]);
  expect(chartData.length).toBe(30);
  expect(tokenChartData.length).toBe(30);
});

test('buildDailyChartData: missing dates default to 0', () => {
  const { chartData } = buildDailyChartData([]);
  expect(chartData.every((d) => d.value === 0)).toBeTruthy();
});

test('buildDailyChartData: includes provided stat in output', () => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { chartData } = buildDailyChartData([
    { date: dateStr, costUsdMicro: 9999, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  ]);
  expect(chartData.some((d) => d.value === 9999)).toBeTruthy();
});

// ── buildHeatmapData ──────────────────────────────────────────────────────────

test('buildHeatmapData: returns ~365 entries', () => {
  const result = buildHeatmapData([]);
  expect(result.length >= 364 && result.length <= 367).toBeTruthy();
});

test('buildHeatmapData: level 0 for days with no data', () => {
  const result = buildHeatmapData([]);
  expect(result.every((d) => d.level === 0)).toBeTruthy();
});

test('buildHeatmapData: assigns level 4 to highest-cost day', () => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const result = buildHeatmapData([
    { date: dateStr, costUsdMicro: 1_000_000, inputTokens: 0, outputTokens: 0, sessionCount: 1 },
  ]);
  const entry = result.find((d) => d.date === dateStr);
  expect(entry?.level).toBe(4);
});

// ── summarizeDailyStatsWindow ─────────────────────────────────────────────────

test('summarizeDailyStatsWindow: sums all stats', () => {
  const rows = [
    {
      date: '2026-05-23',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsdMicro: 1000,
      sessionCount: 1,
    },
    {
      date: '2026-05-24',
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      costUsdMicro: 2000,
      sessionCount: 2,
    },
  ];
  const result = summarizeDailyStatsWindow(rows);
  expect(result.totalInputTokens).toBe(300);
  expect(result.totalOutputTokens).toBe(150);
  expect(result.totalCostUsdMicro).toBe(3000);
  expect(result.sessionCount).toBe(3);
});

test('summarizeDailyStatsWindow: filters by since/until', () => {
  const rows = [
    { date: '2026-05-23', inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsdMicro: 500, sessionCount: 1 },
    { date: '2026-06-01', inputTokens: 200, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsdMicro: 1000, sessionCount: 1 },
  ];
  const since = new Date('2026-05-30').getTime();
  const result = summarizeDailyStatsWindow(rows, since);
  expect(result.totalCostUsdMicro).toBe(1000);
  expect(result.dailyStats.length).toBe(1);
});

// ── activeProjectIdsInWindow ──────────────────────────────────────────────────

test('activeProjectIdsInWindow: returns unique project ids in window', () => {
  const now = Date.now();
  const threads = [
    { projectId: 'p1', lastActiveAt: now - 1000 },
    { projectId: 'p2', lastActiveAt: now - 2000 },
    { projectId: 'p1', lastActiveAt: now - 500 },
  ];
  const result = activeProjectIdsInWindow(threads, now - 5000, now);
  expect(result.length).toBe(2);
  expect(result.includes('p1')).toBeTruthy();
  expect(result.includes('p2')).toBeTruthy();
});

test('activeProjectIdsInWindow: excludes threads outside window', () => {
  const now = Date.now();
  const threads = [{ projectId: 'old', lastActiveAt: now - 1_000_000 }];
  const result = activeProjectIdsInWindow(threads, now - 1000, now);
  expect(result.length).toBe(0);
});

// ── classifyTool ──────────────────────────────────────────────────────────────

test('classifyTool: memory tools', () => {
  expect(classifyTool('mcp__agentos-memory__memory_search')).toBe('memory');
  expect(classifyTool('mcp__agentos-memory__memory_save')).toBe('memory');
});

test('classifyTool: file-io tools', () => {
  expect(classifyTool('Read')).toBe('file-io');
  expect(classifyTool('Write')).toBe('file-io');
  expect(classifyTool('Edit')).toBe('file-io');
  expect(classifyTool('Glob')).toBe('file-io');
});

test('classifyTool: search tools', () => {
  expect(classifyTool('Grep')).toBe('search');
  expect(classifyTool('WebSearch')).toBe('search');
});

test('classifyTool: shell tool', () => {
  expect(classifyTool('Bash')).toBe('shell');
});

test('classifyTool: other tools', () => {
  expect(classifyTool('Agent')).toBe('other');
  expect(classifyTool('SomeMCP')).toBe('other');
});

// ── calcDelta ─────────────────────────────────────────────────────────────────

test('calcDelta: both zero → undefined', () => {
  expect(calcDelta(0, 0)).toBe(undefined);
});

test('calcDelta: previous zero, current non-zero → new', () => {
  expect(calcDelta(100, 0)).toEqual({ label: 'new', positive: null });
});

test('calcDelta: positive change', () => {
  const result = calcDelta(150, 100);
  expect(result?.label).toBe('+50%');
  expect(result?.positive).toBe(true);
});

test('calcDelta: negative change', () => {
  const result = calcDelta(50, 100);
  expect(result?.label).toBe('-50%');
  expect(result?.positive).toBe(false);
});

// ── formatTimestamp ───────────────────────────────────────────────────────────

test('formatTimestamp: 0 → —', () => {
  expect(formatTimestamp(0)).toBe('—');
});

test('formatTimestamp: NaN → —', () => {
  expect(formatTimestamp(NaN)).toBe('—');
});

test('formatTimestamp: valid timestamp → non-empty string', () => {
  const result = formatTimestamp(Date.now());
  expect(result.length > 0 && result !== '—').toBeTruthy();
});
