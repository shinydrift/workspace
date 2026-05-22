import { localDateString } from '../../shared/utils/date';

const MICRODOLLARS_PER_DOLLAR = 1_000_000;
const DAILY_CHART_DAYS = 30;

/** Format micro-dollar cost as a USD string. */
export function formatCost(usdMicro: number): string {
  const usd = usdMicro / MICRODOLLARS_PER_DOLLAR;
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a token count as a compact string. */
export function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** Format an active time in seconds as a compact human-readable string. */
export function formatActiveTime(secs: number): string {
  if (secs <= 0) return '—';
  const minutes = Math.floor(secs / 60);
  if (minutes === 0) return '<1m';
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m`;
  const days = Math.floor(hours / 24);
  if (days === 0) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

/** Format a duration in milliseconds as a human-readable string. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** Build chart-ready arrays from a dailyStats array, always spanning the last 30 days. */
export function buildDailyChartData(
  stats: {
    date: string;
    costUsdMicro: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }[]
) {
  const byDate = new Map(stats.map((d) => [d.date, d]));

  const today = new Date();
  const chartData = [];
  const tokenChartData = [];
  for (let i = DAILY_CHART_DAYS - 1; i >= 0; i--) {
    const cursor = new Date(today);
    cursor.setDate(today.getDate() - i);
    const date = localDateString(cursor);
    const d = byDate.get(date);
    chartData.push({ label: date, value: d?.costUsdMicro ?? 0 });
    tokenChartData.push({
      label: date,
      input: d?.inputTokens ?? 0,
      cacheRead: d?.cacheReadTokens ?? 0,
      cacheCreation: d?.cacheCreationTokens ?? 0,
      output: d?.outputTokens ?? 0,
    });
  }

  return { chartData, tokenChartData };
}

export interface HeatmapActivity {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  inputTokens: number;
  outputTokens: number;
  sessionCount: number;
}

/** Build react-activity-calendar data from dailyStats for the past year. */
export function buildHeatmapData(
  stats: { date: string; costUsdMicro: number; inputTokens: number; outputTokens: number; sessionCount: number }[]
): HeatmapActivity[] {
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(today.getFullYear() - 1);
  yearAgo.setDate(yearAgo.getDate() + 1);

  const byDate = new Map<string, { cost: number; inputTokens: number; outputTokens: number; sessionCount: number }>();
  let maxCost = 1;
  for (const d of stats) {
    byDate.set(d.date, {
      cost: d.costUsdMicro,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      sessionCount: d.sessionCount,
    });
    if (d.costUsdMicro > maxCost) maxCost = d.costUsdMicro;
  }

  const result: HeatmapActivity[] = [];
  const cursor = new Date(yearAgo);
  while (cursor <= today) {
    const date = localDateString(cursor);
    const entry = byDate.get(date);
    const cost = entry?.cost ?? 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (cost > 0) {
      const ratio = cost / maxCost;
      if (ratio < 0.25) level = 1;
      else if (ratio < 0.5) level = 2;
      else if (ratio < 0.75) level = 3;
      else level = 4;
    }
    result.push({
      date,
      count: cost,
      level,
      inputTokens: entry?.inputTokens ?? 0,
      outputTokens: entry?.outputTokens ?? 0,
      sessionCount: entry?.sessionCount ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export interface DailyStatWindowSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsdMicro: number;
  sessionCount: number;
  dailyStats: {
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsdMicro: number;
    sessionCount: number;
  }[];
}

export function summarizeDailyStatsWindow(
  stats: {
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsdMicro: number;
    sessionCount: number;
  }[],
  since?: number,
  until?: number
): DailyStatWindowSummary {
  const sinceDate = since ? localDateString(new Date(since)) : '2026-05-22';
  const untilDate = until ? localDateString(new Date(until)) : '9999-12-31';

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsdMicro = 0;
  let sessionCount = 0;
  const dailyStats = [] as DailyStatWindowSummary['dailyStats'];

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

export function activeProjectIdsInWindow(
  threads: { projectId: string; lastActiveAt: number }[],
  since?: number,
  until?: number
): string[] {
  const lower = since ?? 0;
  const upper = until ?? Number.POSITIVE_INFINITY;
  const projectIds = new Set<string>();

  for (const thread of threads) {
    if (!thread.lastActiveAt || thread.lastActiveAt < lower || thread.lastActiveAt > upper) continue;
    projectIds.add(thread.projectId);
  }

  return [...projectIds];
}

// ── Tool category classification ───────────────────────────────────────────────

export type ToolCategory = 'file-io' | 'search' | 'memory' | 'shell' | 'other';

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  'file-io': 'File I/O',
  search: 'Search',
  memory: 'Memory',
  shell: 'Shell',
  other: 'Other',
};

export function classifyTool(name: string): ToolCategory {
  if (name.startsWith('mcp__agentos-memory__')) return 'memory';
  const lower = name.toLowerCase();
  if (['read', 'write', 'edit', 'glob', 'notebookedit'].includes(lower)) return 'file-io';
  if (['grep', 'websearch', 'webfetch'].includes(lower)) return 'search';
  if (lower === 'bash') return 'shell';
  return 'other';
}

/** Compute week boundary timestamps anchored to local midnight. */
export function weekBoundaries() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const sevenDaysAgo = new Date(y, mo, d - 7).getTime();
  const fourteenDaysAgo = new Date(y, mo, d - 14).getTime();
  return { sevenDaysAgo, fourteenDaysAgo };
}

/** Compute a week-over-week delta label for a numeric metric. */
export function calcDelta(current: number, previous: number): { label: string; positive: boolean | null } | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return { label: 'new', positive: null };
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? '+' : '';
  return { label: `${sign}${pct.toFixed(0)}%`, positive: pct >= 0 };
}

/** Format a unix millisecond timestamp as a short date+time string. */
export function formatTimestamp(ms: number): string {
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
