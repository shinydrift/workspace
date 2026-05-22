import { useMemo } from 'react';
import type { Thread, ToolCallInvocation, ToolCallStats } from '../../../shared/types';
import { useInsightsStore } from '../../store/insightsStore';
import { usePollData } from '../../hooks/usePollData';

export function partitionTools(breakdown: ToolCallStats[]): { regular: ToolCallStats[]; memory: ToolCallStats[] } {
  const memory: ToolCallStats[] = [];
  const regular: ToolCallStats[] = [];
  for (const t of breakdown) {
    if (t.name.startsWith('mcp__agentos-memory__')) {
      memory.push(t);
    } else {
      regular.push(t);
    }
  }
  return { regular, memory };
}

export function useThreadInsightsData(thread: Thread) {
  const {
    sessionMetrics,
    setSessionMetrics,
    toolBreakdown,
    setToolBreakdown,
    toolInvocations,
    setToolInvocations,
    turnMetrics,
    setTurnMetrics,
  } = useInsightsStore();

  const metrics = sessionMetrics[thread.id] ?? null;
  const breakdown = toolBreakdown[thread.id] ?? null;
  const invocations = toolInvocations[thread.id] ?? null;
  const turns = turnMetrics[thread.id] ?? null;

  const intervalMs = thread.status === 'running' ? 3000 : 15000;

  usePollData(
    () => window.electronAPI.analytics.getSessionMetrics(thread.id),
    (m) => setSessionMetrics(thread.id, m),
    intervalMs,
    [thread.id],
    'session metrics'
  );
  usePollData(
    () => window.electronAPI.analytics.getToolBreakdown(thread.id),
    (b) => setToolBreakdown(thread.id, b),
    intervalMs,
    [thread.id],
    'tool breakdown'
  );
  usePollData(
    () => window.electronAPI.analytics.getToolInvocations(thread.id),
    (inv) => setToolInvocations(thread.id, inv),
    intervalMs,
    [thread.id],
    'tool invocations'
  );
  usePollData(
    () => window.electronAPI.analytics.getTurnMetrics(thread.id),
    (t) => setTurnMetrics(thread.id, t),
    intervalMs,
    [thread.id],
    'turn metrics'
  );

  const invocationsByTool = useMemo(() => {
    if (!invocations) return new Map<string, ToolCallInvocation[]>();
    const map = new Map<string, ToolCallInvocation[]>();
    for (const inv of invocations) {
      const list = map.get(inv.name) ?? [];
      list.push(inv);
      map.set(inv.name, list);
    }
    return map;
  }, [invocations]);

  const { totalSuccess, totalError, totalAll } = useMemo(() => {
    if (!invocations) return { totalSuccess: 0, totalError: 0, totalAll: 0 };
    return invocations.reduce(
      (acc, i) => ({
        totalSuccess: acc.totalSuccess + (i.isError ? 0 : 1),
        totalError: acc.totalError + (i.isError ? 1 : 0),
        totalAll: acc.totalAll + 1,
      }),
      { totalSuccess: 0, totalError: 0, totalAll: 0 }
    );
  }, [invocations]);

  return {
    metrics,
    breakdown,
    invocations,
    turns,
    invocationsByTool,
    totalSuccess,
    totalError,
    totalAll,
    hasData: !!metrics,
    isLoading: !metrics && thread.status === 'running',
  };
}
