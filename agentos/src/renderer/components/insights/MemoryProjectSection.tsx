import React, { Fragment, useState } from 'react';
import type { MemoryProjectStats } from '../../../shared/types';
import { usePollData } from '../../hooks/usePollData';
import { timeAgo } from '../../lib/utils';
import { MiniBar } from './MiniBar';
import { ArrowUpRight } from '@phosphor-icons/react';

interface Props {
  projectId: string;
  onNavigateToView?: (view: 'memory' | 'sessions') => void;
  onOpenChunk?: (chunkId: string) => void;
}

function NavHeader({ title, count, onNavigate }: { title: string; count?: number; onNavigate?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
        {count !== undefined && <span className="normal-case font-normal"> ({count})</span>}
      </p>
      {onNavigate && (
        <button
          onClick={onNavigate}
          aria-label={`Open ${title.toLowerCase()}`}
          className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
        >
          <ArrowUpRight size={11} />
        </button>
      )}
    </div>
  );
}

export function MemoryProjectSection({ projectId, onNavigateToView, onOpenChunk }: Props) {
  const [stats, setStats] = useState<MemoryProjectStats | null>(null);

  usePollData(
    () => window.electronAPI.memory.getProjectStats(projectId),
    setStats,
    60_000,
    [projectId],
    'memory project stats'
  );

  if (!stats || stats.totalChunks === 0) return null;

  const funnelRows = [
    { label: 'Stored', count: stats.totalChunks, color: 'bg-muted-foreground/40' },
    { label: 'Expanded', count: stats.totalExpansions, color: 'bg-blue-400/70' },
    ...(stats.memoryGetCallCount > 0
      ? [{ label: 'Read', count: stats.memoryGetCallCount, color: 'bg-emerald-400/70' }]
      : []),
  ];

  return (
    <Fragment>
      <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <NavHeader title="Memory" onNavigate={onNavigateToView ? () => onNavigateToView('memory') : undefined} />
        <p className="text-[10px] text-muted-foreground/50 -mt-1">
          {stats.memoryChunks} memory · {stats.sessionChunks} session
        </p>

        <div className="flex flex-col gap-1.5">
          {funnelRows.map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-muted-foreground/60">{row.label}</span>
              <MiniBar
                segments={[{ value: (row.count / stats.totalChunks) * 100, className: `rounded-full ${row.color}` }]}
                trackClassName="flex-1"
              />
              <span className="w-8 text-right text-foreground/70 tabular-nums shrink-0">{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      {stats.topExpanded.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <NavHeader
            title="Top retrieved"
            count={stats.topExpanded.length}
            onNavigate={onNavigateToView ? () => onNavigateToView('memory') : undefined}
          />
          <div className="flex flex-col gap-1">
            {stats.topExpanded.map((entry) => (
              <div
                key={entry.chunkId}
                className={`rounded-md px-3 py-2 bg-muted/20 text-xs flex items-start gap-2${onOpenChunk ? ' cursor-pointer hover:bg-muted/40 transition-colors' : ''}`}
                onClick={onOpenChunk ? () => onOpenChunk(entry.chunkId) : undefined}
              >
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border font-medium mt-0.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 tabular-nums">
                  ×{entry.expansionCount}
                </span>
                <span className="text-foreground/80 break-words min-w-0 leading-relaxed">{entry.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.recentSessionChunks.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <NavHeader
            title="Recent session indexing"
            count={stats.recentSessionChunks.length}
            onNavigate={onNavigateToView ? () => onNavigateToView('sessions') : undefined}
          />
          <div className="flex flex-col gap-1">
            {stats.recentSessionChunks.map((chunk) => (
              <div
                key={chunk.chunkId}
                className={`rounded-md px-3 py-2 bg-muted/20 text-xs flex flex-col gap-0.5${onOpenChunk ? ' cursor-pointer hover:bg-muted/40 transition-colors' : ''}`}
                onClick={onOpenChunk ? () => onOpenChunk(chunk.chunkId) : undefined}
              >
                <p className="text-foreground/80 leading-relaxed break-words min-w-0">{chunk.label}</p>
                <p className="text-muted-foreground/50 text-[10px]">{timeAgo(chunk.updatedAt)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </Fragment>
  );
}
