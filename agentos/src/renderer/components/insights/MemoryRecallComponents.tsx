import React from 'react';
import type { RecallEntry, SearchGroup } from './memoryRecallParser';
import { MiniBar } from './MiniBar';

export function SearchStatsBar({
  withResults,
  empty,
  avgScore,
}: {
  withResults: number;
  empty: number;
  avgScore: number | null;
}) {
  const total = withResults + empty;
  if (total === 0) return null;
  const hitPct = (withResults / total) * 100;
  const missPct = 100 - hitPct;
  const scoreTier = avgScore === null ? null : avgScore >= 0.8 ? 'high' : avgScore >= 0.7 ? 'mid' : 'low';
  const SCORE_COLORS = {
    high: { bg: 'bg-emerald-500', text: 'text-emerald-400' },
    mid: { bg: 'bg-yellow-400', text: 'text-yellow-400' },
    low: { bg: 'bg-slate-500', text: 'text-muted-foreground/60' },
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Hit rate</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {withResults}/{total} searches
          </span>
        </div>
        <MiniBar
          segments={[
            ...(withResults > 0 ? [{ value: hitPct, className: 'bg-emerald-500/70' }] : []),
            ...(empty > 0 ? [{ value: missPct, className: 'bg-amber-400/60' }] : []),
          ]}
        />
        <div className="flex gap-3 text-[10px]">
          {withResults > 0 && <span className="text-emerald-400">{withResults} with results</span>}
          {empty > 0 && <span className="text-amber-400">{empty} empty</span>}
        </div>
      </div>

      {avgScore !== null && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Avg relevance</span>
            <span className={`text-[10px] tabular-nums font-mono ${scoreTier ? SCORE_COLORS[scoreTier].text : ''}`}>
              {avgScore.toFixed(2)}
            </span>
          </div>
          <MiniBar
            segments={[
              { value: avgScore * 100, className: `${scoreTier ? SCORE_COLORS[scoreTier].bg : ''} opacity-70` },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export function RecallEntryRow({ entry }: { entry: RecallEntry }) {
  const shortPath = entry.path.replace(/^(?:memory|sessions)\/|\.jsonl$/, '');
  const scoreColor =
    entry.maxScore >= 0.8 ? 'text-emerald-400' : entry.maxScore >= 0.7 ? 'text-yellow-400' : 'text-muted-foreground/60';
  const sourceLabel = entry.source === 'sessions' ? 'session' : entry.source;
  const sourceBadgeClass = sourceLabel
    ? entry.source === 'sessions'
      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
    : null;
  const primaryText = entry.snippets[0] ?? shortPath;
  const showPath = entry.source === 'memory' && entry.snippets.length > 0;

  return (
    <div className="flex items-start gap-2.5 px-3 py-2 text-xs">
      <span className={`font-mono text-xs shrink-0 tabular-nums mt-0.5 ${scoreColor}`}>
        [{entry.maxScore.toFixed(2)}]
      </span>
      <span className="text-foreground/80 break-words min-w-0 flex-1 text-xs">{primaryText}</span>
      {showPath && (
        <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0 break-words max-w-[120px]">
          {shortPath}
        </span>
      )}
      {sourceLabel && sourceBadgeClass && (
        <span className={`shrink-0 text-[10px] px-1 py-0.5 rounded border font-medium ${sourceBadgeClass}`}>
          {sourceLabel}
        </span>
      )}
      <span className="text-muted-foreground text-xs tabular-nums shrink-0">
        {entry.chunkCount} {entry.chunkCount === 1 ? 'chunk' : 'chunks'}
      </span>
    </div>
  );
}

export function SearchGroupRow({ group, n }: { group: SearchGroup; n: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-1.5 px-3 py-2">
        <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0 font-mono mt-0.5">#{n}</span>
        <span className="text-xs text-foreground/60 break-words min-w-0 flex-1">{group.query}</span>
        <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
          {group.entries.length} {group.entries.length === 1 ? 'result' : 'results'}
        </span>
      </div>

      {group.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic px-4 pb-1">no results</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/30 border-t border-border/30">
          {group.entries.map((entry) => (
            <RecallEntryRow key={entry.path} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
