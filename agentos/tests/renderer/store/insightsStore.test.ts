import { test, expect } from 'vitest';
import { useInsightsStore } from '../../../src/renderer/store/insightsStore';
import type { SessionMetrics, ToolCallStats, ToolCallInvocation, TurnMetric } from '../../../src/shared/types';

function reset() {
  useInsightsStore.setState({
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
  });
}

function makeSessionMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    turnCount: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsdMicro: 1000,
    model: 'claude-sonnet-4-6',
    endedAt: null,
    ...overrides,
  } as SessionMetrics;
}

function makeToolStats(name: string, count = 1): ToolCallStats {
  return { name, count, successCount: count, errorCount: 0 } as ToolCallStats;
}

// ── Initial state ─────────────────────────────────────────────────────────────

test('insightsStore: initial state is empty', () => {
  reset();
  const s = useInsightsStore.getState();
  expect(s.sessionMetrics).toEqual({});
  expect(s.globalInsights).toBe(null);
  expect(s.globalToolBreakdown).toBe(null);
});

// ── setSessionMetrics ─────────────────────────────────────────────────────────

test('insightsStore: setSessionMetrics stores metrics by threadId', () => {
  reset();
  useInsightsStore.getState().setSessionMetrics('t1', makeSessionMetrics({ turnCount: 5 }));
  expect(useInsightsStore.getState().sessionMetrics['t1']?.turnCount).toBe(5);
});

test('insightsStore: setSessionMetrics with null deletes the entry', () => {
  reset();
  useInsightsStore.getState().setSessionMetrics('t1', makeSessionMetrics());
  useInsightsStore.getState().setSessionMetrics('t1', null);
  expect(useInsightsStore.getState().sessionMetrics['t1']).toBe(undefined);
});

test('insightsStore: setSessionMetrics deduplicates unchanged metrics', () => {
  reset();
  const m = makeSessionMetrics({ turnCount: 3, inputTokens: 200 });
  useInsightsStore.getState().setSessionMetrics('t1', m);
  const before = useInsightsStore.getState().sessionMetrics;
  // Set identical values — should return same state reference
  useInsightsStore.getState().setSessionMetrics('t1', { ...m });
  expect(useInsightsStore.getState().sessionMetrics).toBe(before);
});

test('insightsStore: setSessionMetrics updates when metrics change', () => {
  reset();
  useInsightsStore.getState().setSessionMetrics('t1', makeSessionMetrics({ turnCount: 1 }));
  useInsightsStore.getState().setSessionMetrics('t1', makeSessionMetrics({ turnCount: 2 }));
  expect(useInsightsStore.getState().sessionMetrics['t1']?.turnCount).toBe(2);
});

// ── setAutomationRuns ─────────────────────────────────────────────────────────

test('insightsStore: setAutomationRuns stores runs by jobId', () => {
  reset();
  useInsightsStore.getState().setAutomationRuns('job1', [{ id: 'r1' } as never]);
  expect(useInsightsStore.getState().automationRuns['job1']?.length).toBe(1);
});

// ── setToolBreakdown ──────────────────────────────────────────────────────────

test('insightsStore: setToolBreakdown stores breakdown', () => {
  reset();
  useInsightsStore.getState().setToolBreakdown('t1', [makeToolStats('Read', 5)]);
  expect(useInsightsStore.getState().toolBreakdown['t1']?.length).toBe(1);
});

test('insightsStore: setToolBreakdown deduplicates equal data', () => {
  reset();
  const bd = [makeToolStats('Bash', 3)];
  useInsightsStore.getState().setToolBreakdown('t1', bd);
  const before = useInsightsStore.getState().toolBreakdown;
  useInsightsStore.getState().setToolBreakdown('t1', [...bd]);
  expect(useInsightsStore.getState().toolBreakdown).toBe(before);
});

// ── setToolInvocations ────────────────────────────────────────────────────────

test('insightsStore: setToolInvocations stores invocations', () => {
  reset();
  const inv: ToolCallInvocation[] = [{ id: 'i1', name: 'Read', isError: false, input: {}, response: '' }];
  useInsightsStore.getState().setToolInvocations('t1', inv);
  expect(useInsightsStore.getState().toolInvocations['t1']?.length).toBe(1);
});

test('insightsStore: setToolInvocations deduplicates by last item', () => {
  reset();
  const inv: ToolCallInvocation[] = [{ id: 'i1', name: 'Read', isError: false, input: {}, response: '' }];
  useInsightsStore.getState().setToolInvocations('t1', inv);
  const before = useInsightsStore.getState().toolInvocations;
  useInsightsStore.getState().setToolInvocations('t1', [...inv]);
  expect(useInsightsStore.getState().toolInvocations).toBe(before);
});

// ── setTurnMetrics ────────────────────────────────────────────────────────────

test('insightsStore: setTurnMetrics stores metrics', () => {
  reset();
  const tm: TurnMetric[] = [{ timestamp: 1000, startedAt: 900, firstChunkAt: 950 } as TurnMetric];
  useInsightsStore.getState().setTurnMetrics('t1', tm);
  expect(useInsightsStore.getState().turnMetrics['t1']?.length).toBe(1);
});

test('insightsStore: setTurnMetrics deduplicates by last item', () => {
  reset();
  const tm: TurnMetric[] = [{ timestamp: 1000, startedAt: 900, firstChunkAt: 950 } as TurnMetric];
  useInsightsStore.getState().setTurnMetrics('t1', tm);
  const before = useInsightsStore.getState().turnMetrics;
  useInsightsStore.getState().setTurnMetrics('t1', [...tm]);
  expect(useInsightsStore.getState().turnMetrics).toBe(before);
});

// ── setGlobalInsights ─────────────────────────────────────────────────────────

test('insightsStore: setGlobalInsights stores data', () => {
  reset();
  const gi = { totalCostUsdMicro: 5000, dailyStats: [], perProject: [] } as never;
  useInsightsStore.getState().setGlobalInsights(gi);
  expect(useInsightsStore.getState().globalInsights).toBeTruthy();
});

test('insightsStore: setGlobalInsights deduplicates unchanged data', () => {
  reset();
  const gi = { totalCostUsdMicro: 5000, dailyStats: [], perProject: [] } as never;
  useInsightsStore.getState().setGlobalInsights(gi);
  const before = useInsightsStore.getState().globalInsights;
  useInsightsStore.getState().setGlobalInsights({ ...gi });
  expect(useInsightsStore.getState().globalInsights).toBe(before);
});

// ── setGlobalToolBreakdown ────────────────────────────────────────────────────

test('insightsStore: setGlobalToolBreakdown stores data', () => {
  reset();
  useInsightsStore.getState().setGlobalToolBreakdown([makeToolStats('Grep', 10)]);
  expect(useInsightsStore.getState().globalToolBreakdown).toBeTruthy();
});
