export interface SessionMetrics {
  threadId: string;
  projectId: string;
  provider: string;
  model: string;
  startedAt: number;
  endedAt: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turnCount: number;
  toolCallCount: number;
  costUsdMicro: number;
}

export interface AnalyticsRunRecord {
  id: string;
  jobId: string;
  threadId: string;
  projectId: string;
  startedAt: number;
  completedAt: number | null;
  status: 'ok' | 'error' | 'skipped';
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  toolCallCount: number;
  costUsdMicro: number;
}

export interface ToolCallStats {
  name: string;
  count: number;
  successCount: number;
  errorCount: number;
}

export interface ToolCallInvocation {
  id: string;
  name: string;
  input: unknown;
  response: string;
  isError: boolean;
  calledAt?: number; // unix ms timestamp of the assistant message containing this tool call
}

export interface TurnMetric {
  turn: number;
  toolCallCount: number;
  startedAt: number; // unix ms of the preceding user message (or session startedAt for turn 1)
  timestamp: number; // unix ms of the assistant message
  firstChunkAt?: number; // unix ms when first streaming byte arrived (undefined for historical turns)
}

export interface ProjectCostSummary {
  projectId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsdMicro: number;
  threadCount: number;
  since: number;
}

export interface DailyStat {
  date: string; // 'YYYY-MM-DD'
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsdMicro: number;
  sessionCount: number;
}

export interface ModelStat {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsdMicro: number;
}

export interface RateLimitWindow {
  label: string; // e.g. "5-hour", "7-day", "7-day (Opus)"
  usedPercentage: number; // 0–100
  resetsAt: number; // unix seconds (0 if unknown)
}

export interface ProviderRateLimitsEntry {
  windows: RateLimitWindow[];
  capturedAt: number; // unix ms
}

export interface ProjectInsights {
  projectId: string;
  since: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsdMicro: number;
  dailyStats: DailyStat[];
  modelBreakdown: ModelStat[];
}

export interface ProjectBreakdown {
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsdMicro: number;
}

export interface GlobalInsights {
  since: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsdMicro: number;
  perProject: ProjectBreakdown[];
  dailyStats: DailyStat[];
  modelBreakdown: ModelStat[];
}

export interface ProjectInsightsWindow {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsdMicro: number;
  sessionCount: number;
}

export interface ProjectInsightsOverview {
  projectId: string;
  allTime: ProjectInsights;
  thisWeek: ProjectInsightsWindow;
  lastWeek: ProjectInsightsWindow;
  activeTimeSecsThisWeek: number;
  activeTimeSecsLastWeek: number;
  memoryGetThisWeek: number;
  memoryGetLastWeek: number;
  expansionThisWeek: number;
  expansionLastWeek: number;
}

export interface GlobalInsightsWindow {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsdMicro: number;
  sessionCount: number;
  projectCount: number;
}

export interface GlobalInsightsOverview {
  allTime: GlobalInsights;
  thisWeek: GlobalInsightsWindow;
  lastWeek: GlobalInsightsWindow;
  globalMemoryGetCallCount: number;
  memoryGetThisWeek: number;
  memoryGetLastWeek: number;
  perProjectMemoryGet: Array<{ projectId: string; count: number }>;
  activeTimeSecsThisWeek: number;
  activeTimeSecsLastWeek: number;
}
