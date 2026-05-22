import React from 'react';
import type { SessionMetrics } from '../../../shared/types';
import { formatCost } from '../../lib/analyticsFormatters';
import { InsightSection } from './InsightSection';
import { useDomainStore } from '../../store/domainStore';
import type { DetailView } from '../threads/ThreadDetail';
import { cn } from '@/lib/utils';

interface Props {
  threads: SessionMetrics[];
  onSelectThread?: (threadId: string, view?: DetailView) => void;
}

export function TopThreadsSection({ threads, onSelectThread }: Props) {
  const domainThreads = useDomainStore((s) => s.threads);
  if (threads.length === 0) return null;
  return (
    <InsightSection title="Top threads" count={threads.length}>
      <div className="flex flex-col gap-1.5">
        {threads.map((t, i) => {
          const thread = domainThreads[t.threadId];
          const label = thread?.name || t.threadId.slice(0, 8);
          return (
            <button
              key={t.threadId}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 rounded-md bg-muted/20 text-left',
                onSelectThread ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default'
              )}
              onClick={onSelectThread ? () => onSelectThread(t.threadId, 'insights') : undefined}
            >
              <span className="text-xs text-muted-foreground/50 tabular-nums w-3 shrink-0">{i + 1}</span>
              <span className="text-xs text-foreground/70 flex-1 truncate">{label}</span>
              <span className="text-xs text-muted-foreground/60 shrink-0">{t.turnCount} turns</span>
              <span className="text-xs tabular-nums text-foreground shrink-0">{formatCost(t.costUsdMicro)}</span>
            </button>
          );
        })}
      </div>
    </InsightSection>
  );
}
