import React from 'react';
import { PieChart, Pie, Cell } from 'recharts';

export function ToolReliabilityDonut({ success, error }: { success: number; error: number }) {
  const total = success + error;
  if (total === 0) return null;
  const pct = Math.round((success / total) * 100);
  const data = [{ value: success }, { value: Math.max(error, 0) }];
  return (
    <div className="flex flex-row items-center gap-3">
      <PieChart width={56} height={56}>
        <Pie
          data={data}
          cx={24}
          cy={24}
          innerRadius={16}
          outerRadius={26}
          startAngle={90}
          endAngle={-270}
          dataKey="value"
          strokeWidth={0}
          isAnimationActive={false}
        >
          <Cell fill="#10b981" fillOpacity={0.8} />
          <Cell fill="hsl(var(--destructive))" fillOpacity={error > 0 ? 0.7 : 0.15} />
        </Pie>
      </PieChart>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Success rate</p>
        <span className="text-lg font-semibold tabular-nums text-foreground leading-none">{pct}%</span>
        <div className="flex gap-2 text-xs">
          <span className="text-emerald-400 tabular-nums">{success} ok</span>
          {error > 0 && <span className="text-destructive tabular-nums">{error} err</span>}
        </div>
      </div>
    </div>
  );
}
