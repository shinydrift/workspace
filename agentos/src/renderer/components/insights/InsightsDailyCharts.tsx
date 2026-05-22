import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LineChart, Line, CartesianGrid, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { formatCost, formatTokens } from '../../lib/analyticsFormatters';

interface StackedDatum {
  label: string;
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

interface CostChartDatum {
  label: string;
  value: number;
}

interface CombinedDatum {
  label: string;
  cost: number;
  uniqueIn: number;
  cacheRead: number;
  output: number;
}

interface Props {
  chartData: CostChartDatum[];
  tokenChartData: StackedDatum[];
}

const AXIS_TICK_STYLE = { fontSize: 9, fill: 'hsl(var(--muted-foreground))', fillOpacity: 0.55 };

// Tight per-line domain so each metric's day-to-day variance fills the available band.
// Falls back to [0, 1] when a series is empty so Recharts' tick math doesn't trip on log10(0).
const PER_LINE_DOMAIN: [(dataMin: number) => number, (dataMax: number) => number] = [
  (dataMin) => (dataMin > 0 ? dataMin * 0.9 : 0),
  (dataMax) => (dataMax > 0 ? dataMax : 1),
];

function CombinedLegend({ hasCacheData }: { hasCacheData: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="inline-block w-3 h-0.5 bg-primary/90" />
        Cost
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="inline-block w-3 h-0.5" style={{ background: 'rgba(129,140,248,0.85)' }} />
        Unique in
      </span>
      {hasCacheData && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-block w-3 h-0.5 bg-amber-500/85" />
          Cache hits
        </span>
      )}
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="inline-block w-3 h-0.5 bg-emerald-500/85" />
        Out
      </span>
    </div>
  );
}

export function InsightsDailyCharts({ chartData, tokenChartData }: Props) {
  const combined: CombinedDatum[] = useMemo(
    () =>
      chartData.map((d, i) => ({
        label: d.label,
        cost: d.value,
        uniqueIn: (tokenChartData[i]?.input ?? 0) + (tokenChartData[i]?.cacheCreation ?? 0),
        cacheRead: tokenChartData[i]?.cacheRead ?? 0,
        output: tokenChartData[i]?.output ?? 0,
      })),
    [chartData, tokenChartData]
  );

  const hasCacheData = useMemo(() => combined.some((d) => d.cacheRead > 0), [combined]);

  if (combined.length === 0) return null;

  return (
    <section className="border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Daily cost</p>
      <CombinedLegend hasCacheData={hasCacheData} />
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={combined} margin={{ top: 4, right: 8, left: 32, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
          <YAxis
            yAxisId="cost"
            tickFormatter={(v) => formatCost(v)}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
            width={32}
            tickCount={2}
            domain={PER_LINE_DOMAIN}
          />
          {/* Each token line gets its own hidden axis so it scales to its own range —
              cacheRead is ~100x larger than uniqueIn/output and would otherwise flatten them. */}
          <YAxis yAxisId="uniqueIn" hide domain={PER_LINE_DOMAIN} />
          <YAxis yAxisId="cacheRead" hide domain={PER_LINE_DOMAIN} />
          <YAxis yAxisId="output" hide domain={PER_LINE_DOMAIN} />
          <Line
            yAxisId="cost"
            dataKey="cost"
            isAnimationActive={false}
            stroke="var(--primary)"
            strokeOpacity={0.9}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            yAxisId="uniqueIn"
            dataKey="uniqueIn"
            isAnimationActive={false}
            stroke="#818cf8"
            strokeOpacity={0.85}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
          {hasCacheData && (
            <Line
              yAxisId="cacheRead"
              dataKey="cacheRead"
              isAnimationActive={false}
              stroke="#f59e0b"
              strokeOpacity={0.85}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          )}
          <Line
            yAxisId="output"
            dataKey="output"
            isAnimationActive={false}
            stroke="#10b981"
            strokeOpacity={0.85}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CombinedDatum;
              return (
                <div className="rounded border border-border bg-popover px-2 py-1.5 shadow-md flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground mb-0.5">{d.label}</span>
                  <span className="text-xs">
                    <span className="text-muted-foreground">Cost </span>
                    <span className="font-medium text-foreground tabular-nums">{formatCost(d.cost)}</span>
                  </span>
                  <span className="text-xs">
                    <span className="text-muted-foreground">Unique in </span>
                    <span className="font-medium text-foreground tabular-nums">{formatTokens(d.uniqueIn)}</span>
                  </span>
                  {d.cacheRead > 0 && (
                    <span className="text-xs">
                      <span className="text-muted-foreground">Cache hits </span>
                      <span className="font-medium text-foreground tabular-nums">{formatTokens(d.cacheRead)}</span>
                    </span>
                  )}
                  <span className="text-xs">
                    <span className="text-muted-foreground">Out </span>
                    <span className="font-medium text-foreground tabular-nums">{formatTokens(d.output)}</span>
                  </span>
                </div>
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-between mt-1.5">
        <span className="text-xs text-muted-foreground/50">{combined[0]?.label}</span>
        <span className="text-xs text-muted-foreground/50">{combined[combined.length - 1]?.label}</span>
      </div>
    </section>
  );
}

export function InsightsEmptyState({ title }: { title: string }) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 px-4 py-4">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <div className="py-12 flex flex-col items-center text-center gap-2">
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
          <p className="text-xs text-muted-foreground">Run a thread to start collecting data.</p>
        </div>
      </div>
    </ScrollArea>
  );
}
