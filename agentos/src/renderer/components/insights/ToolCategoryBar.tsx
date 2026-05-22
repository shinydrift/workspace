import React, { useMemo } from 'react';
import type { ToolCallStats } from '../../../shared/types';
import { classifyTool, CATEGORY_LABELS } from '../../lib/analyticsFormatters';
import type { ToolCategory } from '../../lib/analyticsFormatters';

const CATEGORY_COLORS: Record<ToolCategory, string> = {
  'file-io': 'bg-blue-500',
  search: 'bg-violet-500',
  memory: 'bg-amber-400',
  shell: 'bg-rose-500',
  other: 'bg-slate-500',
};

export function ToolCategoryBar({ breakdown }: { breakdown: ToolCallStats[] }) {
  const stats = useMemo(() => {
    const counts = new Map<ToolCategory, number>();
    for (const t of breakdown) {
      const cat = classifyTool(t.name);
      counts.set(cat, (counts.get(cat) ?? 0) + t.count);
    }
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count, pct: (count / total) * 100 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [breakdown]);

  if (stats.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Categories</p>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {stats.map(({ category, pct }) => (
          <div key={category} className={CATEGORY_COLORS[category]} style={{ width: `${pct}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {stats.map(({ category, count, pct }) => (
          <div key={category} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full shrink-0 ${CATEGORY_COLORS[category]}`} />
            <span className="text-xs text-foreground/80">{CATEGORY_LABELS[category]}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {count} ({Math.round(pct)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
