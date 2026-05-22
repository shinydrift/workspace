import React, { useMemo } from 'react';
import type { ToolCallStats } from '../../../shared/types';

interface OpStat {
  label: string;
  count: number;
  pct: number;
  color: string;
}

const MEM_PREFIX = 'mcp__agentos-memory__';

function classifyMemoryOp(name: string): 'search' | 'read' | 'write' {
  const op = name.startsWith(MEM_PREFIX) ? name.slice(MEM_PREFIX.length) : name;
  if (op === 'memory_search') return 'search';
  if (op === 'memory_get') return 'read';
  return 'write';
}

const OP_META: Record<'search' | 'read' | 'write', { label: string; color: string }> = {
  search: { label: 'Search', color: 'bg-violet-500' },
  read: { label: 'Read', color: 'bg-blue-500' },
  write: { label: 'Save', color: 'bg-emerald-500' },
};

export function MemoryActivityBar({ memory }: { memory: ToolCallStats[] }) {
  const stats: OpStat[] = useMemo(() => {
    const counts = new Map<'search' | 'read' | 'write', number>();
    for (const t of memory) {
      const op = classifyMemoryOp(t.name);
      counts.set(op, (counts.get(op) ?? 0) + t.count);
    }
    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    if (total === 0) return [];
    return (['search', 'read', 'write'] as const)
      .filter((op) => counts.has(op))
      .map((op) => ({
        ...OP_META[op],
        count: counts.get(op)!,
        pct: (counts.get(op)! / total) * 100,
      }));
  }, [memory]);

  if (stats.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Memory Activity</p>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full">
        {stats.map(({ label, pct, color }) => (
          <div key={label} className={color} style={{ width: `${pct}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {stats.map(({ label, count, pct, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
            <span className="text-xs text-foreground/80">{label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {count} ({Math.round(pct)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
