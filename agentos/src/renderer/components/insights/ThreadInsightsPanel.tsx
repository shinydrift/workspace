import React, { useState } from 'react';
import type { Thread } from '../../../shared/types';
import { MODEL_LABEL } from '../../../shared/types/provider';
import { formatCost, formatTokens } from '../../lib/analyticsFormatters';
import { StatCard } from './StatCard';
import { TokenRatioBar } from './TokenRatioBar';
import type { FilterMode } from './FilterPill';
import { ToolReliabilityDonut } from './ToolReliabilityDonut';
import { ToolCategoryBar } from './ToolCategoryBar';
import { FilesTouchedSection } from './FilesTouchedSection';
import { CommandsSection } from './CommandsSection';
import { WebActivitySection } from './WebActivitySection';
import { MemoryActivityBar } from './MemoryActivityBar';
import { MemoryRecallSection } from './MemoryRecallSection';
import { MemorySavedSection } from './MemorySavedSection';
import { MemorySessionChunksSection } from './MemorySessionChunksSection';
import { useThreadInsightsData, partitionTools } from './useThreadInsightsData';
import { InsightsToolsSection } from './InsightsToolsSection';
import { InsightsLayout } from './InsightsLayout';
import { useThreadMetrics } from '../../hooks/useThreadMetrics';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { MemoryPanel } from '../memory/MemoryPanel';
import { ChunkSourcePanel } from '../memory/ChunkSourcePanel';

interface Props {
  thread: Thread;
}

export function ThreadInsightsPanel({ thread }: Props) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sheetSource, setSheetSource] = useState<'memory' | 'sessions' | null>(null);
  const {
    metrics,
    breakdown,
    invocations,
    turns,
    invocationsByTool,
    totalSuccess,
    totalError,
    totalAll,
    hasData,
    isLoading,
  } = useThreadInsightsData(thread);

  const { duration, avgTtft, tokensPerSec } = useThreadMetrics(metrics, turns ?? null);

  const { regular, memory } = breakdown ? partitionTools(breakdown) : { regular: [], memory: [] };
  const uniqueInTokens = metrics ? metrics.inputTokens + metrics.cacheCreationTokens : 0;
  const cacheHitTokens = metrics ? metrics.cacheReadTokens : 0;

  return (
    <>
      <InsightsLayout>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 h-[62px]">
                <div className="h-2.5 w-10 rounded bg-muted mb-2" />
                <div className="h-4 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : !hasData ? (
          <div className="py-12 flex flex-col items-center text-center gap-2">
            <p className="text-sm text-muted-foreground">No metrics yet.</p>
            <p className="text-xs text-muted-foreground">Run the agent to start collecting data.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Cost" value={formatCost(metrics!.costUsdMicro)} />
              <StatCard label="Turns" value={String(metrics!.turnCount)} />
              <StatCard label="Unique in" value={formatTokens(uniqueInTokens)} />
              <StatCard label="Tokens out" value={formatTokens(metrics!.outputTokens)} />
              {cacheHitTokens > 0 && <StatCard label="Cache hits" value={formatTokens(cacheHitTokens)} />}
              <StatCard
                label="Cost / turn"
                value={metrics!.turnCount > 0 ? formatCost(metrics!.costUsdMicro / metrics!.turnCount) : '—'}
              />
              <StatCard
                label="Tools / turn"
                value={metrics!.turnCount > 0 ? (metrics!.toolCallCount / metrics!.turnCount).toFixed(1) : '—'}
              />
              {avgTtft !== null && <StatCard label="Avg TTFT" value={avgTtft} />}
              {tokensPerSec !== null && <StatCard label="Tokens/sec" value={tokensPerSec} />}
            </div>

            <TokenRatioBar
              uniqueIn={uniqueInTokens}
              cacheRead={metrics!.cacheReadTokens}
              output={metrics!.outputTokens}
            />

            <div className="flex gap-4 text-xs text-muted-foreground pt-1">
              <span>
                Active time: <span className="text-foreground">{duration ?? '—'}</span>
              </span>
              <span>
                Tool calls: <span className="text-foreground">{metrics!.toolCallCount}</span>
              </span>
              <span>
                Provider: <span className="text-foreground">{metrics!.provider}</span>
              </span>
              {metrics!.model && (
                <span>
                  Model: <span className="text-foreground">{MODEL_LABEL[metrics!.model] ?? metrics!.model}</span>
                </span>
              )}
            </div>

            {totalAll > 0 && (
              <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6">
                <div className="min-w-0 md:w-full">
                  <ToolReliabilityDonut success={totalSuccess} error={totalError} />
                </div>
                {breakdown && breakdown.length > 0 && (
                  <div className="min-w-0 md:w-full">
                    <ToolCategoryBar breakdown={breakdown} />
                  </div>
                )}
              </div>
            )}

            {memory.length > 0 && <MemoryActivityBar memory={memory} />}

            <InsightsToolsSection
              regular={regular}
              memory={memory}
              invocationsByTool={invocationsByTool}
              filter={filter}
              onFilterChange={setFilter}
              totalAll={totalAll}
              totalSuccess={totalSuccess}
              totalError={totalError}
            />

            <FilesTouchedSection invocations={invocations ?? []} />
            <CommandsSection invocations={invocations ?? []} />
            <WebActivitySection invocations={invocations ?? []} />
            <MemoryRecallSection invocations={invocations ?? []} />
            <MemorySavedSection invocations={invocations ?? []} onOpenInMemory={() => setSheetSource('memory')} />
            <MemorySessionChunksSection thread={thread} onOpenInSessions={() => setSheetSource('sessions')} />
          </>
        )}
      </InsightsLayout>

      <Sheet
        open={!!sheetSource}
        onOpenChange={(open) => {
          if (!open) setSheetSource(null);
        }}
      >
        <SheetContent>
          <SheetTitle className="sr-only">{sheetSource === 'memory' ? 'Memory' : 'Sessions'}</SheetTitle>
          {sheetSource === 'memory' && <MemoryPanel thread={thread} />}
          {sheetSource === 'sessions' && <ChunkSourcePanel thread={thread} source="sessions" />}
        </SheetContent>
      </Sheet>
    </>
  );
}
