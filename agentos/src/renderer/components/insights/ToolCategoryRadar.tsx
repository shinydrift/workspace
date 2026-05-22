import { useMemo } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { ToolCallStats } from '../../../shared/types';
import { CATEGORY_LABELS, classifyTool } from '../../lib/analyticsFormatters';
import type { ToolCategory } from '../../lib/analyticsFormatters';

export function ToolCategoryRadar({ breakdown }: { breakdown: ToolCallStats[] }) {
  const data = useMemo(() => {
    const counts = new Map<ToolCategory, number>();
    for (const t of breakdown) {
      const cat = classifyTool(t.name);
      counts.set(cat, (counts.get(cat) ?? 0) + t.count);
    }
    return (Object.keys(CATEGORY_LABELS) as ToolCategory[]).map((cat) => ({
      subject: CATEGORY_LABELS[cat],
      value: counts.get(cat) ?? 0,
    }));
  }, [breakdown]);

  const hasData = data.some((d) => d.value > 0);
  if (!hasData) return null;

  return (
    <section className="border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tool categories</p>
      <ResponsiveContainer width="100%" height={180}>
        <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Radar
            dataKey="value"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.2}
            strokeWidth={1.5}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'hsl(var(--popover-foreground))',
            }}
            formatter={(value: number) => [value.toLocaleString(), 'calls']}
          />
        </RadarChart>
      </ResponsiveContainer>
    </section>
  );
}
