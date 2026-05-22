import { formatCost, formatTokens, formatActiveTime, buildDailyChartData } from '../../lib/analyticsFormatters';
import { StatCard } from './StatCard';
import { TokenRatioBar } from './TokenRatioBar';
import { InsightsDailyCharts, InsightsEmptyState } from './InsightsDailyCharts';
import { UsageHeatmap } from './UsageHeatmap';
import { ProjectDonutChart } from './ProjectDonutChart';
import { InsightsLayout } from './InsightsLayout';
import { useProjectInsights } from '../../hooks/useProjectInsights';
import { MemoryProjectSection } from './MemoryProjectSection';
import { ToolReliabilityDonut } from './ToolReliabilityDonut';
import { ToolCategoryBar } from './ToolCategoryBar';

interface Props {
  projectId: string;
  onNavigateToView?: (view: 'memory' | 'sessions') => void;
  onOpenChunk?: (chunkId: string) => void;
}

export function ProjectInsightsPanel({ projectId, onNavigateToView, onOpenChunk }: Props) {
  const {
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
  } = useProjectInsights(projectId);
  if (!data) {
    return <InsightsEmptyState title="Project Usage" />;
  }

  const { chartData, tokenChartData } = buildDailyChartData(data.dailyStats);

  return (
    <InsightsLayout>
      {/* Last 7 days */}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground/70">Last 7 days</p>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Cost" value={thisWeek ? formatCost(thisWeek.totalCostUsdMicro) : '—'} delta={costDelta} />
          <StatCard label="Threads" value={thisWeek ? String(thisWeek.sessionCount) : '—'} delta={threadsDelta} />
          <StatCard
            label="Unique in"
            value={thisWeek ? formatTokens(thisWeek.totalInputTokens + thisWeek.totalCacheCreationTokens) : '—'}
            delta={inputTokensDelta}
          />
          <StatCard
            label="Out tokens"
            value={thisWeek ? formatTokens(thisWeek.totalOutputTokens) : '—'}
            delta={outputTokensDelta}
          />
          <StatCard
            label="Cache hits"
            value={thisWeek ? formatTokens(thisWeek.totalCacheReadTokens) : '—'}
            delta={cacheTokensDelta}
          />
          <StatCard label="Total cost (all time)" value={formatCost(data.totalCostUsdMicro)} />
          {activeTimeSecsThisWeek > 0 && (
            <StatCard label="Active time" value={formatActiveTime(activeTimeSecsThisWeek)} delta={activeTimeDelta} />
          )}
          {memoryGetThisWeek > 0 && (
            <StatCard label="Memory reads" value={String(memoryGetThisWeek)} delta={memoryGetDelta} />
          )}
          {expansionThisWeek > 0 && (
            <StatCard label="Chunk expansions" value={String(expansionThisWeek)} delta={expansionDelta} />
          )}
        </div>
      </div>

      {/* Token ratio bar */}
      <TokenRatioBar
        uniqueIn={data.totalInputTokens + data.totalCacheCreationTokens}
        cacheRead={data.totalCacheReadTokens}
        output={data.totalOutputTokens}
      />

      {/* Activity heatmap */}
      <UsageHeatmap data={heatmapData} />

      {/* Daily charts */}
      <InsightsDailyCharts chartData={chartData} tokenChartData={tokenChartData} />

      {/* By model donut */}
      {modelEntries.length > 0 && (
        <section>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By model</p>
          <ProjectDonutChart projects={modelEntries} />
        </section>
      )}

      {toolTotals && toolBreakdown && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools</p>
          <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6">
            <div className="min-w-0 md:w-full">
              <ToolReliabilityDonut success={toolTotals.success} error={toolTotals.error} />
            </div>
            <div className="min-w-0 md:w-full">
              <ToolCategoryBar breakdown={toolBreakdown} />
            </div>
          </div>
        </section>
      )}

      <MemoryProjectSection projectId={projectId} onNavigateToView={onNavigateToView} onOpenChunk={onOpenChunk} />
    </InsightsLayout>
  );
}
