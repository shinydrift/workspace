import React, { useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useCouncilRuns } from '../../hooks/useCouncilRuns';
import { CouncilRunSheet } from './CouncilRunSheet';
import type { CouncilRunEntry } from '../../hooks/useCouncilRuns';

interface Props {
  threadId: string;
}

export function CouncilRunPanel({ threadId }: Props) {
  const entries = useCouncilRuns(threadId);
  const [activeEntry, setActiveEntry] = useState<CouncilRunEntry | null>(null);

  if (entries.length === 0) return null;

  return (
    <div className="max-w-[1200px] w-full mx-auto">
      <div className="mx-6 mb-3 rounded-lg border border-border bg-muted/30 divide-y divide-border/50">
        {entries.map((entry) => {
          const { run, outcomes, memberCount } = entry;
          const isRunning = run.status === 'running' || run.status === 'pending';
          const received = outcomes.length;
          const total = memberCount || run.childThreadIds.length || null;
          const countLabel = total !== null ? `${received}/${total}` : `${received}`;

          return (
            <button
              key={run.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted/60 transition-colors first:rounded-t-lg last:rounded-b-lg"
              onClick={() => setActiveEntry(entry)}
            >
              {isRunning ? (
                <Spinner size="sm" className="shrink-0" />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500/70" />
              )}
              <span className="font-medium text-foreground">Council</span>
              <span className="text-muted-foreground">
                {isRunning ? `${countLabel} replied` : `${countLabel} · done`}
              </span>
              <span className="ml-auto text-muted-foreground">›</span>
            </button>
          );
        })}
      </div>

      {activeEntry && (
        <CouncilRunSheet
          open={activeEntry !== null}
          onOpenChange={(open) => !open && setActiveEntry(null)}
          prompt={activeEntry.run.prompt}
          outcomes={activeEntry.outcomes}
        />
      )}
    </div>
  );
}
