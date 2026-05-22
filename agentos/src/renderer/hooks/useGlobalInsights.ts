import { useMemo, useState } from 'react';
import { useInsightsStore } from '../store/insightsStore';
import { useDomainStore } from '../store/domainStore';
import { buildHeatmapData, calcDelta } from '../lib/analyticsFormatters';
import { usePollData } from './usePollData';
import type { GlobalInsightsWindow } from '../../shared/types';

export function useGlobalInsights() {
  const { globalInsights, setGlobalInsights, globalToolBreakdown, setGlobalToolBreakdown } = useInsightsStore();
  const projects = useDomainStore((s) => s.projects);

  const [globalInsightsThisWeek, setGlobalInsightsThisWeek] = useState<GlobalInsightsWindow | null>(null);
  const [globalInsightsLastWeek, setGlobalInsightsLastWeek] = useState<GlobalInsightsWindow | null>(null);
  const [globalMemoryGetCallCount, setGlobalMemoryGetCallCount] = useState(0);
  const [memoryGetThisWeek, setMemoryGetThisWeek] = useState(0);
  const [memoryGetLastWeek, setMemoryGetLastWeek] = useState(0);
  const [perProjectMemoryGet, setPerProjectMemoryGet] = useState<Array<{ projectId: string; count: number }>>([]);
  const [expansionThisWeek, setExpansionThisWeek] = useState(0);
  const [expansionLastWeek, setExpansionLastWeek] = useState(0);
  const [activeTimeSecsThisWeek, setActiveTimeSecsThisWeek] = useState(0);
  const [activeTimeSecsLastWeek, setActiveTimeSecsLastWeek] = useState(0);

  usePollData(
    () => window.electronAPI.analytics.getGlobalOverview(),
    (overview) => {
      setGlobalInsights(overview.allTime);
      setGlobalInsightsThisWeek(overview.thisWeek);
      setGlobalInsightsLastWeek(overview.lastWeek);
      setGlobalMemoryGetCallCount(overview.globalMemoryGetCallCount);
      setMemoryGetThisWeek(overview.memoryGetThisWeek);
      setMemoryGetLastWeek(overview.memoryGetLastWeek);
      setPerProjectMemoryGet(overview.perProjectMemoryGet);
      setActiveTimeSecsThisWeek(overview.activeTimeSecsThisWeek);
      setActiveTimeSecsLastWeek(overview.activeTimeSecsLastWeek);
    },
    60_000,
    [setGlobalInsights],
    'global overview'
  );

  usePollData(
    () => window.electronAPI.analytics.getGlobalToolBreakdown(),
    (d) => setGlobalToolBreakdown(d),
    60_000,
    [setGlobalToolBreakdown],
    'global tool breakdown'
  );

  usePollData(
    () => window.electronAPI.memory.getGlobalExpansionCounts(),
    ({ thisWeek, lastWeek }) => {
      setExpansionThisWeek(thisWeek);
      setExpansionLastWeek(lastWeek);
    },
    60_000,
    [],
    'global expansion counts'
  );

  const heatmapData = useMemo(() => buildHeatmapData(globalInsights?.dailyStats ?? []), [globalInsights]);

  const perProjectEntries = useMemo(
    () =>
      globalInsights?.perProject.map((p) => ({
        id: p.projectId,
        name: projects[p.projectId]?.name ?? p.projectId,
        costUsdMicro: p.costUsdMicro,
      })) ?? [],
    [globalInsights, projects]
  );

  const modelEntries = useMemo(
    () =>
      globalInsights?.modelBreakdown?.map((m) => ({
        name: m.model,
        costUsdMicro: m.costUsdMicro,
      })) ?? [],
    [globalInsights]
  );

  const { costDelta, inputTokensDelta, outputTokensDelta, cacheTokensDelta, projectsDelta } = useMemo(() => {
    if (!globalInsightsThisWeek || !globalInsightsLastWeek) {
      return {
        costDelta: undefined,
        inputTokensDelta: undefined,
        outputTokensDelta: undefined,
        cacheTokensDelta: undefined,
        projectsDelta: undefined,
      };
    }
    return {
      costDelta: calcDelta(globalInsightsThisWeek.totalCostUsdMicro, globalInsightsLastWeek.totalCostUsdMicro),
      inputTokensDelta: calcDelta(
        globalInsightsThisWeek.totalInputTokens + globalInsightsThisWeek.totalCacheCreationTokens,
        globalInsightsLastWeek.totalInputTokens + globalInsightsLastWeek.totalCacheCreationTokens
      ),
      outputTokensDelta: calcDelta(globalInsightsThisWeek.totalOutputTokens, globalInsightsLastWeek.totalOutputTokens),
      cacheTokensDelta: calcDelta(
        globalInsightsThisWeek.totalCacheReadTokens,
        globalInsightsLastWeek.totalCacheReadTokens
      ),
      projectsDelta: calcDelta(globalInsightsThisWeek.projectCount, globalInsightsLastWeek.projectCount),
    };
  }, [globalInsightsThisWeek, globalInsightsLastWeek]);

  const memoryGetDelta = useMemo(
    () =>
      memoryGetThisWeek > 0 || memoryGetLastWeek > 0 ? calcDelta(memoryGetThisWeek, memoryGetLastWeek) : undefined,
    [memoryGetThisWeek, memoryGetLastWeek]
  );

  const activeTimeDelta = useMemo(
    () =>
      activeTimeSecsThisWeek > 0 || activeTimeSecsLastWeek > 0
        ? calcDelta(activeTimeSecsThisWeek, activeTimeSecsLastWeek)
        : undefined,
    [activeTimeSecsThisWeek, activeTimeSecsLastWeek]
  );

  const expansionDelta = useMemo(
    () =>
      expansionThisWeek > 0 || expansionLastWeek > 0 ? calcDelta(expansionThisWeek, expansionLastWeek) : undefined,
    [expansionThisWeek, expansionLastWeek]
  );

  const toolTotals = useMemo(() => {
    if (!globalToolBreakdown || globalToolBreakdown.length === 0) return null;
    let success = 0;
    let error = 0;
    for (const t of globalToolBreakdown) {
      success += t.successCount;
      error += t.errorCount;
    }
    return { success, error };
  }, [globalToolBreakdown]);

  return {
    globalInsights,
    globalInsightsThisWeek,
    projectsThisWeekCount: globalInsightsThisWeek?.projectCount,
    heatmapData,
    perProjectEntries,
    modelEntries,
    costDelta,
    inputTokensDelta,
    outputTokensDelta,
    cacheTokensDelta,
    projectsDelta,
    globalMemoryGetCallCount,
    memoryGetThisWeek,
    memoryGetDelta,
    expansionThisWeek,
    expansionDelta,
    perProjectMemoryGet,
    projects,
    globalToolBreakdown,
    toolTotals,
    activeTimeSecsThisWeek,
    activeTimeDelta,
  };
}
