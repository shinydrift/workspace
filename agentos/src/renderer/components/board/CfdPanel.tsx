import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { KanbanStage, CfdSnapshot } from '../../../shared/types/kanban';

const STAGE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface ChartDatum {
  date: number;
  [stageId: string]: number;
}

interface CfdPanelProps {
  projectId: string;
}

export function CfdPanel({ projectId }: CfdPanelProps) {
  const [stages, setStages] = useState<KanbanStage[]>([]);
  const [snapshots, setSnapshots] = useState<CfdSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([window.electronAPI.kanban.listStages(projectId), window.electronAPI.kanban.getCfdData(projectId, 14)])
      .then(([fetchedStages, fetchedSnapshots]) => {
        setStages(fetchedStages);
        setSnapshots(fetchedSnapshots);
      })
      .catch(() => {
        /* leave empty state; "no data yet" message will render */
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="h-32 flex items-center justify-center border-b border-border/50">
        <span className="text-xs text-muted-foreground">loading…</span>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center border-b border-border/50">
        <span className="text-xs text-muted-foreground">no data yet</span>
      </div>
    );
  }

  const data: ChartDatum[] = snapshots.map((snap) => {
    const datum: ChartDatum = { date: snap.date };
    for (const stage of stages) {
      datum[stage.id] = snap.counts[stage.id] ?? 0;
    }
    return datum;
  });

  return (
    <div className="px-4 py-3 border-b border-border/50">
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={24} allowDecimals={false} />
          <Tooltip
            formatter={(val, name) => [val, stages.find((s) => s.id === name)?.label ?? name]}
            labelFormatter={(ts) => formatDate(ts as number)}
            contentStyle={{ fontSize: 11 }}
          />
          {stages.map((stage, i) => (
            <Area
              key={stage.id}
              type="monotone"
              dataKey={stage.id}
              stackId="1"
              stroke={STAGE_COLORS[i % STAGE_COLORS.length]}
              fill={STAGE_COLORS[i % STAGE_COLORS.length]}
              fillOpacity={0.6}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
