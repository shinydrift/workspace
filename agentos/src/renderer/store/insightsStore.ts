import { create } from 'zustand';
import type {
  SessionMetrics,
  AnalyticsRunRecord,
  ToolCallStats,
  ToolCallInvocation,
  TurnMetric,
  ProjectInsights,
  GlobalInsights,
  ProviderRateLimitsEntry,
} from '../../shared/types';

interface InsightsStore {
  sessionMetrics: Record<string, SessionMetrics>; // keyed by threadId
  automationRuns: Record<string, AnalyticsRunRecord[]>; // keyed by jobId
  toolBreakdown: Record<string, ToolCallStats[]>; // keyed by threadId
  toolInvocations: Record<string, ToolCallInvocation[]>; // keyed by threadId
  turnMetrics: Record<string, TurnMetric[]>; // keyed by threadId
  projectInsights: Record<string, ProjectInsights>; // keyed by projectId
  globalInsights: GlobalInsights | null;
  topThreads: Record<string, SessionMetrics[]>; // keyed by projectId
  projectToolBreakdown: Record<string, ToolCallStats[]>; // keyed by projectId
  globalToolBreakdown: ToolCallStats[] | null;
  providerRateLimits: Record<string, ProviderRateLimitsEntry>;

  setSessionMetrics: (threadId: string, metrics: SessionMetrics | null) => void;
  setAutomationRuns: (jobId: string, runs: AnalyticsRunRecord[]) => void;
  setToolBreakdown: (threadId: string, breakdown: ToolCallStats[]) => void;
  setToolInvocations: (threadId: string, invocations: ToolCallInvocation[]) => void;
  setTurnMetrics: (threadId: string, metrics: TurnMetric[]) => void;
  setProjectInsights: (projectId: string, data: ProjectInsights) => void;
  setGlobalInsights: (data: GlobalInsights) => void;
  setTopThreads: (projectId: string, threads: SessionMetrics[]) => void;
  setProjectToolBreakdown: (projectId: string, data: ToolCallStats[]) => void;
  setGlobalToolBreakdown: (data: ToolCallStats[]) => void;
  setProviderRateLimits: (data: Record<string, ProviderRateLimitsEntry>) => void;
}

function eqByLastItem<T>(a: T[] | undefined, b: T[], same: (x: T, y: T) => boolean): boolean {
  if (!a || a.length !== b.length) return false;
  if (b.length === 0) return true;
  return same(a[a.length - 1]!, b[b.length - 1]!);
}

function eqToolInvocations(a: ToolCallInvocation[] | undefined, b: ToolCallInvocation[]): boolean {
  return eqByLastItem(a, b, (x, y) => x.id === y.id && x.isError === y.isError);
}

function eqTurnMetrics(a: TurnMetric[] | undefined, b: TurnMetric[]): boolean {
  return eqByLastItem(
    a,
    b,
    (x, y) => x.timestamp === y.timestamp && x.startedAt === y.startedAt && x.firstChunkAt === y.firstChunkAt
  );
}

function eqToolBreakdown(a: ToolCallStats[] | undefined, b: ToolCallStats[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (
      a[i]!.name !== b[i]!.name ||
      a[i]!.count !== b[i]!.count ||
      a[i]!.successCount !== b[i]!.successCount ||
      a[i]!.errorCount !== b[i]!.errorCount
    )
      return false;
  }
  return true;
}

export const useInsightsStore = create<InsightsStore>((set) => ({
  sessionMetrics: {},
  automationRuns: {},
  toolBreakdown: {},
  toolInvocations: {},
  turnMetrics: {},
  projectInsights: {},
  globalInsights: null,
  topThreads: {},
  projectToolBreakdown: {},
  globalToolBreakdown: null,
  providerRateLimits: {},

  setSessionMetrics: (threadId, metrics) =>
    set((state) => {
      if (metrics === null) {
        const next = { ...state.sessionMetrics };
        delete next[threadId];
        return { sessionMetrics: next };
      }
      const prev = state.sessionMetrics[threadId];
      if (
        prev &&
        prev.turnCount === metrics.turnCount &&
        prev.inputTokens === metrics.inputTokens &&
        prev.outputTokens === metrics.outputTokens &&
        prev.cacheReadTokens === metrics.cacheReadTokens &&
        prev.endedAt === metrics.endedAt &&
        prev.model === metrics.model
      ) {
        return state;
      }
      return { sessionMetrics: { ...state.sessionMetrics, [threadId]: metrics } };
    }),

  setAutomationRuns: (jobId, runs) => set((state) => ({ automationRuns: { ...state.automationRuns, [jobId]: runs } })),

  setToolBreakdown: (threadId, breakdown) =>
    set((state) => {
      if (eqToolBreakdown(state.toolBreakdown[threadId], breakdown)) return state;
      return { toolBreakdown: { ...state.toolBreakdown, [threadId]: breakdown } };
    }),

  setToolInvocations: (threadId, invocations) =>
    set((state) => {
      if (eqToolInvocations(state.toolInvocations[threadId], invocations)) return state;
      return { toolInvocations: { ...state.toolInvocations, [threadId]: invocations } };
    }),

  setTurnMetrics: (threadId, metrics) =>
    set((state) => {
      if (eqTurnMetrics(state.turnMetrics[threadId], metrics)) return state;
      return { turnMetrics: { ...state.turnMetrics, [threadId]: metrics } };
    }),

  setProjectInsights: (projectId, data) =>
    set((state) => {
      const prev = state.projectInsights[projectId];
      if (
        prev &&
        prev.totalCostUsdMicro === data.totalCostUsdMicro &&
        prev.dailyStats.length === data.dailyStats.length
      )
        return state;
      return { projectInsights: { ...state.projectInsights, [projectId]: data } };
    }),

  setGlobalInsights: (data) =>
    set((state) => {
      const prev = state.globalInsights;
      if (
        prev &&
        prev.totalCostUsdMicro === data.totalCostUsdMicro &&
        prev.dailyStats.length === data.dailyStats.length &&
        prev.perProject.length === data.perProject.length
      )
        return state;
      return { globalInsights: data };
    }),

  setTopThreads: (projectId, threads) =>
    set((state) => {
      const prev = state.topThreads[projectId];
      if (
        prev &&
        prev.length === threads.length &&
        (threads.length === 0 || prev[0]!.costUsdMicro === threads[0]!.costUsdMicro)
      )
        return state;
      return { topThreads: { ...state.topThreads, [projectId]: threads } };
    }),

  setProjectToolBreakdown: (projectId, data) =>
    set((state) => {
      if (eqToolBreakdown(state.projectToolBreakdown[projectId], data)) return state;
      return { projectToolBreakdown: { ...state.projectToolBreakdown, [projectId]: data } };
    }),

  setGlobalToolBreakdown: (data) =>
    set((state) => {
      if (eqToolBreakdown(state.globalToolBreakdown ?? undefined, data)) return state;
      return { globalToolBreakdown: data };
    }),

  setProviderRateLimits: (data) =>
    set((state) => {
      const prev = state.providerRateLimits;
      const keys = Object.keys(data);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k]?.capturedAt === data[k]?.capturedAt))
        return state;
      return { providerRateLimits: data };
    }),
}));
