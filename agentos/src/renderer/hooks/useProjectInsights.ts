import { useMemo, useState } from 'react';
import { useInsightsStore } from '../store/insightsStore';
import { buildHeatmapData, calcDelta } from '../lib/analyticsFormatters';
import { usePollData } from './usePollData';
import type { ProjectInsightsWindow } from '../../shared/types';
import type { SessionMetrics } from '../../shared/types/analytics';

export function useProjectInsights(projectId: string) {
  const {
    projectInsights,
    setProjectInsights,
    projectToolBreakdown,
    setProjectToolBreakdown,
    topThreads,
    setTopThreads,
  } = useInsightsStore();
  const data = projectInsights[projectId] ?? null;
  const toolBreakdown = projectToolBreakdown[projectId] ?? null;
  const topThreadsForProject: SessionMetrics[] = topThreads[projectId] ?? [];

  const [thisWeek, setThisWeek] = useState<ProjectInsightsWindow | null>(null);
  const [lastWeek, setLastWeek] = useState<ProjectInsightsWindow | null>(null);
  const [activeTimeSecsThisWeek, setActiveTimeSecsThisWeek] = useState(0);
  const [activeTimeSecsLastWeek, setActiveTimeSecsLastWeek] = useState(0);
  const [memoryGetThisWeek, setMemoryGetThisWeek] = useState(0);
  const [memoryGetLastWeek, setMemoryGetLastWeek] = useState(0);
  const [expansionThisWeek, setExpansionThisWeek] = useState(0);
  const [expansionLastWeek, setExpansionLastWeek] = useState(0);

  usePollData(
    () => window.electronAPI.analytics.getProjectOverview(projectId),
    (overview) => {
      setProjectInsights(projectId, overview.allTime);
      setThisWeek(overview.thisWeek);
      setLastWeek(overview.lastWeek);
      setActiveTimeSecsThisWeek(overview.activeTimeSecsThisWeek);
      setActiveTimeSecsLastWeek(overview.activeTimeSecsLastWeek);
      setMemoryGetThisWeek(overview.memoryGetThisWeek);
      setMemoryGetLastWeek(overview.memoryGetLastWeek);
      setExpansionThisWeek(overview.expansionThisWeek);
      setExpansionLastWeek(overview.expansionLastWeek);
    },
    60_000,
    [projectId, setProjectInsights],
    'project insights'
  );

  usePollData(
    () => window.electronAPI.analytics.getProjectToolBreakdown(projectId),
    (d) => setProjectToolBreakdown(projectId, d),
    60_000,
    [projectId, setProjectToolBreakdown],
    'project tool breakdown'
  );

  usePollData(
    () => window.electronAPI.analytics.getTopCostThreads(projectId, 5),
    (threads) => setTopThreads(projectId, threads),
    60_000,
    [projectId, setTopThreads],
    'top threads'
  );

  const toolTotals = useMemo(() => {
    if (!toolBreakdown || toolBreakdown.length === 0) return null;
    let success = 0;
    let error = 0;
    for (const t of toolBreakdown) {
      success += t.successCount;
      error += t.errorCount;
    }
    return { success, error };
  }, [toolBreakdown]);

  const heatmapData = useMemo(() => buildHeatmapData(data?.dailyStats ?? []), [data]);

  const modelEntries = useMemo(
    () => (data?.modelBreakdown ?? []).map((m) => ({ name: m.model, costUsdMicro: m.costUsdMicro })),
    [data]
  );

  const { costDelta, inputTokensDelta, outputTokensDelta, cacheTokensDelta, threadsDelta } = useMemo(() => {
    if (!thisWeek || !lastWeek) {
      return {
        costDelta: undefined,
        inputTokensDelta: undefined,
        outputTokensDelta: undefined,
        cacheTokensDelta: undefined,
        threadsDelta: undefined,
      };
    }
    return {
      costDelta: calcDelta(thisWeek.totalCostUsdMicro, lastWeek.totalCostUsdMicro),
      inputTokensDelta: calcDelta(
        thisWeek.totalInputTokens + thisWeek.totalCacheCreationTokens,
        lastWeek.totalInputTokens + lastWeek.totalCacheCreationTokens
      ),
      outputTokensDelta: calcDelta(thisWeek.totalOutputTokens, lastWeek.totalOutputTokens),
      cacheTokensDelta: calcDelta(thisWeek.totalCacheReadTokens, lastWeek.totalCacheReadTokens),
      threadsDelta: calcDelta(thisWeek.sessionCount, lastWeek.sessionCount),
    };
  }, [thisWeek, lastWeek]);

  const activeTimeDelta = useMemo(
    () =>
      activeTimeSecsThisWeek > 0 || activeTimeSecsLastWeek > 0
        ? calcDelta(activeTimeSecsThisWeek, activeTimeSecsLastWeek)
        : undefined,
    [activeTimeSecsThisWeek, activeTimeSecsLastWeek]
  );

  const memoryGetDelta = useMemo(
    () =>
      memoryGetThisWeek > 0 || memoryGetLastWeek > 0 ? calcDelta(memoryGetThisWeek, memoryGetLastWeek) : undefined,
    [memoryGetThisWeek, memoryGetLastWeek]
  );

  const expansionDelta = useMemo(
    () =>
      expansionThisWeek > 0 || expansionLastWeek > 0 ? calcDelta(expansionThisWeek, expansionLastWeek) : undefined,
    [expansionThisWeek, expansionLastWeek]
  );

  return {
    data,
    thisWeek,
    heatmapData,
    modelEntries,
    toolBreakdown,
    toolTotals,
    costDelta,
    inputTokensDelta,
    outputTokensDelta,
    cacheTokensDelta,
    threadsDelta,
    activeTimeSecsThisWeek,
    activeTimeDelta,
    memoryGetThisWeek,
    memoryGetDelta,
    expansionThisWeek,
    expansionDelta,
    topThreads: topThreadsForProject,
  };
}
