import { ContentCard } from '@/components/ui/content-card';
import { formatCost, formatTokens, formatActiveTime, buildDailyChartData } from '../../lib/analyticsFormatters';
import { StatCard } from './StatCard';
import { TokenRatioBar } from './TokenRatioBar';
import { InsightsDailyCharts, InsightsEmptyState } from './InsightsDailyCharts';
import { UsageHeatmap } from './UsageHeatmap';
import { ProjectDonutChart } from './ProjectDonutChart';
import { InsightsLayout } from './InsightsLayout';
import { useGlobalInsights } from '../../hooks/useGlobalInsights';
import { ToolReliabilityDonut } from './ToolReliabilityDonut';
import { ToolCategoryBar } from './ToolCategoryBar';
import { ProviderRateLimitsSection } from './ProviderRateLimitsSection';
import { useProviderRateLimits } from '../../hooks/useProviderRateLimits';

interface Props {
  onSelectProject?: (path: string, name: string) => void;
}

export function GlobalInsightsPanel({ onSelectProject }: Props) {
  const {
    globalInsights,
    globalInsightsThisWeek,
    projectsThisWeekCount,
    heatmapData,
    perProjectEntries,
    modelEntries,
    costDelta,
    inputTokensDelta,
    outputTokensDelta,
    cacheTokensDelta,
    projectsDelta,
    memoryGetThisWeek,
    memoryGetDelta,
    expansionThisWeek,
    expansionDelta,
    globalToolBreakdown,
    toolTotals,
    activeTimeSecsThisWeek,
    activeTimeDelta,
    projects,
  } = useGlobalInsights();
  const providerRateLimits = useProviderRateLimits();

  if (!globalInsights) {
    return (
      <ContentCard>
        <InsightsEmptyState title="Usage Overview" />
      </ContentCard>
    );
  }

  const data = globalInsights;
  const { chartData, tokenChartData } = buildDailyChartData(data.dailyStats);

  return (
    <ContentCard>
      <div className="flex-1 min-h-0 flex flex-col">
        <InsightsLayout header={<span className="text-sm text-muted-foreground">Usage Overview</span>}>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground/70">Last 7 days</p>
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Cost"
                value={globalInsightsThisWeek ? formatCost(globalInsightsThisWeek.totalCostUsdMicro) : '—'}
                delta={costDelta}
              />
              <StatCard
                label="Projects"
                value={projectsThisWeekCount != null ? String(projectsThisWeekCount) : '—'}
                delta={projectsDelta}
              />
              <StatCard
                label="Unique in"
                value={
                  globalInsightsThisWeek
                    ? formatTokens(
                        globalInsightsThisWeek.totalInputTokens + globalInsightsThisWeek.totalCacheCreationTokens
                      )
                    : '—'
                }
                delta={inputTokensDelta}
              />
              <StatCard
                label="Out tokens"
                value={globalInsightsThisWeek ? formatTokens(globalInsightsThisWeek.totalOutputTokens) : '—'}
                delta={outputTokensDelta}
              />
              <StatCard
                label="Cache hits"
                value={globalInsightsThisWeek ? formatTokens(globalInsightsThisWeek.totalCacheReadTokens) : '—'}
                delta={cacheTokensDelta}
              />
              <StatCard label="Total cost (all time)" value={formatCost(data.totalCostUsdMicro)} />
              {activeTimeSecsThisWeek > 0 && (
                <StatCard
                  label="Active time"
                  value={formatActiveTime(activeTimeSecsThisWeek)}
                  delta={activeTimeDelta}
                />
              )}
              {memoryGetThisWeek > 0 && (
                <StatCard label="Memory reads" value={String(memoryGetThisWeek)} delta={memoryGetDelta} />
              )}
              {expansionThisWeek > 0 && (
                <StatCard label="Chunk expansions" value={String(expansionThisWeek)} delta={expansionDelta} />
              )}
            </div>
          </div>

          <TokenRatioBar
            uniqueIn={data.totalInputTokens + data.totalCacheCreationTokens}
            cacheRead={data.totalCacheReadTokens}
            output={data.totalOutputTokens}
          />

          <UsageHeatmap data={heatmapData} />

          {/* Daily charts */}
          <InsightsDailyCharts chartData={chartData} tokenChartData={tokenChartData} />

          {/* Per-project and per-model breakdown */}
          {(data.perProject.length > 0 || modelEntries.length > 0) && (
            <section className="grid items-start gap-4 md:grid-cols-2 md:gap-6">
              {data.perProject.length > 0 && (
                <div className="min-w-0 md:w-full">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By project</p>
                  <ProjectDonutChart
                    projects={perProjectEntries}
                    onSelect={
                      onSelectProject
                        ? (entry) => {
                            const proj = entry.id ? projects[entry.id] : undefined;
                            if (proj) onSelectProject(proj.path, proj.name);
                          }
                        : undefined
                    }
                  />
                </div>
              )}
              {modelEntries.length > 0 && (
                <div className="min-w-0 md:w-full">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By model</p>
                  <ProjectDonutChart projects={modelEntries} />
                </div>
              )}
            </section>
          )}

          {toolTotals && globalToolBreakdown && (
            <section className="flex flex-col gap-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools</p>
              <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6">
                <div className="min-w-0 md:w-full">
                  <ToolReliabilityDonut success={toolTotals.success} error={toolTotals.error} />
                </div>
                <div className="min-w-0 md:w-full">
                  <ToolCategoryBar breakdown={globalToolBreakdown} />
                </div>
              </div>
            </section>
          )}

          {Object.keys(providerRateLimits).length > 0 && <ProviderRateLimitsSection rateLimits={providerRateLimits} />}
        </InsightsLayout>
      </div>
    </ContentCard>
  );
}
