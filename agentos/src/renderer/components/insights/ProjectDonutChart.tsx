import React from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import { formatCost } from '../../lib/analyticsFormatters';
import { cn } from '@/lib/utils';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];

interface ProjectEntry {
  name: string;
  costUsdMicro: number;
  id?: string;
}

export function ProjectDonutChart({
  projects,
  onSelect,
}: {
  projects: ProjectEntry[];
  onSelect?: (entry: ProjectEntry) => void;
}) {
  const total = projects.reduce((sum, p) => sum + p.costUsdMicro, 0);
  if (total === 0 || projects.length === 0) return null;

  const data = projects.map((p) => ({ name: p.name, value: p.costUsdMicro }));

  return (
    <div className="flex flex-row items-start gap-3">
      <div className="shrink-0">
        <PieChart width={120} height={120}>
          <Pie
            data={data}
            cx={56}
            cy={56}
            innerRadius={36}
            outerRadius={54}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            strokeWidth={0}
            isAnimationActive={false}
          >
            {data.map((item, i) => (
              <Cell key={item.name} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
            ))}
          </Pie>
        </PieChart>
      </div>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {projects.map((p, i) => {
          const clickable = !!onSelect && !!p.id;
          return (
            <button
              key={p.name}
              type="button"
              className={cn(
                'flex w-full items-center justify-between gap-2 text-left',
                clickable ? 'cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1' : 'cursor-default'
              )}
              onClick={clickable ? () => onSelect!(p) : undefined}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className={cn('text-xs truncate', clickable ? 'text-foreground/90' : 'text-foreground/80')}>
                  {p.name}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground/60">{Math.round((p.costUsdMicro / total) * 100)}%</span>
                <span className="text-xs tabular-nums text-foreground">{formatCost(p.costUsdMicro)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
