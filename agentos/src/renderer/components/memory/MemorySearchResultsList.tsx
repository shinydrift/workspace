import React from 'react';
import { Button } from '../ui/button';
import type { MemorySearchHit } from '../../../shared/types';

interface Props {
  results: MemorySearchHit[];
  busy: string | null;
  onSelect: (hit: MemorySearchHit) => void;
}

export function MemorySearchResultsList({ results, busy, onSelect }: Props) {
  if (results.length === 0) {
    return (
      <div className="m-3 rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
        {busy === 'search' ? 'Searching…' : 'No results.'}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40">
      {results.map((hit) => (
        <Button
          key={hit.id}
          type="button"
          variant="ghost"
          onClick={() => onSelect(hit)}
          className="w-full h-auto px-3 py-2.5 flex-col items-start rounded-none hover:bg-accent/40"
        >
          <div className="flex w-full items-start gap-2">
            <div className="flex-1 truncate text-xs font-medium">{hit.title}</div>
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {Math.round(hit.score * 100)}%
            </span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">{hit.source}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</div>
        </Button>
      ))}
    </div>
  );
}
