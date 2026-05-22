export const ANALYTICS_IPC_CHANNELS = {
  ANALYTICS_GET_SESSION: 'analytics:getSessionMetrics',
  ANALYTICS_GET_RUNS: 'analytics:getAutomationRuns',
  ANALYTICS_GET_TOP_THREADS: 'analytics:getTopCostThreads',
  ANALYTICS_GET_TOOL_BREAKDOWN: 'analytics:getToolBreakdown',
  ANALYTICS_GET_TOOL_INVOCATIONS: 'analytics:getToolInvocations',
  ANALYTICS_GET_TURN_METRICS: 'analytics:getTurnMetrics',
  ANALYTICS_GET_PROJECT_OVERVIEW: 'analytics:getProjectOverview',
  ANALYTICS_GET_GLOBAL_OVERVIEW: 'analytics:getGlobalOverview',
  ANALYTICS_GET_PROJECT_TOOL_BREAKDOWN: 'analytics:getProjectToolBreakdown',
  ANALYTICS_GET_GLOBAL_TOOL_BREAKDOWN: 'analytics:getGlobalToolBreakdown',
  ANALYTICS_GET_GLOBAL_MEMORY_GET_COUNT: 'analytics:getGlobalMemoryGetCount',
  ANALYTICS_GET_PROVIDER_RATE_LIMITS: 'analytics:getProviderRateLimits',
} as const;

export interface AnalyticsGetSessionRequest {
  threadId: string;
}

export interface AnalyticsGetRunsRequest {
  jobId: string;
  limit?: number;
  since?: number;
}

export interface AnalyticsGetSummaryRequest {
  projectId: string;
  since?: number;
}

export interface AnalyticsGetTopThreadsRequest {
  projectId: string;
  limit?: number;
}

export interface AnalyticsGetToolBreakdownRequest {
  threadId: string;
}

export interface AnalyticsGetTurnMetricsRequest {
  threadId: string;
}

export interface AnalyticsGetProjectInsightsRequest {
  projectId: string;
  since?: number;
  until?: number;
}

export interface AnalyticsGetGlobalInsightsRequest {
  since?: number;
}
