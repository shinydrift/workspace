import React, { useMemo, useState } from 'react';
import type { ToolCallInvocation } from '../../../shared/types';
import { MemoryRecallHeader } from './MemoryRecallHeader';
import { MemoryRecallReadsList } from './MemoryRecallReadsList';
import { SearchStatsBar, SearchGroupRow } from './MemoryRecallComponents';
import { EMPTY_MEMORY_RECALL, countMemoryRecall, parseMemoryRecall } from './memoryRecallParser';
import { ExpandCaret } from './ExpandCaret';

export function MemoryRecallSection({ invocations }: { invocations: ToolCallInvocation[] }) {
  const [expanded, setExpanded] = useState(false);

  const { searchCount, getCount } = useMemo(() => countMemoryRecall(invocations), [invocations]);

  const parsed = useMemo(() => (expanded ? parseMemoryRecall(invocations) : null), [expanded, invocations]);

  const hasActivity = searchCount > 0 || getCount > 0;
  const { groups, searchesWithResults, searchesWithoutResults, avgMaxScore, getCalls } = parsed ?? EMPTY_MEMORY_RECALL;
  const missCount = getCalls.filter((c) => !c.hit).length;

  if (!hasActivity) return null;

  return (
    <section className="flex flex-col gap-1 border-t border-border/60 pt-3">
      <button
        className="flex items-center gap-1.5 text-left w-full"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <ExpandCaret expanded={expanded} />
        <MemoryRecallHeader
          avgMaxScore={avgMaxScore}
          getCount={getCount}
          hasActivity={hasActivity}
          missCount={missCount}
          open={expanded}
          searchCount={searchCount}
          searchesWithResults={searchesWithResults}
          searchesWithoutResults={searchesWithoutResults}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-2">
          {groups.length > 0 && (
            <div className="rounded-md bg-muted/20 overflow-hidden flex flex-col divide-y divide-border/30">
              <SearchStatsBar withResults={searchesWithResults} empty={searchesWithoutResults} avgScore={avgMaxScore} />
              {groups.map((group, i) => (
                <SearchGroupRow key={i} group={group} n={i + 1} />
              ))}
            </div>
          )}
          <MemoryRecallReadsList calls={getCalls} />
        </div>
      )}
    </section>
  );
}
