import React from 'react';
import type { MemorySourceFilter } from '../../../shared/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface Props {
  source: MemorySourceFilter;
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  busy: string | null;
}

const PLACEHOLDER: Record<MemorySourceFilter, string> = {
  all: 'Search…',
  memory: 'Search memory…',
  sessions: 'Search sessions…',
  code: 'Search code…',
};

export function MemoryPanelHeader({ source, query, onQueryChange, onSearch, busy }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={PLACEHOLDER[source]}
        className="h-8 flex-1 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSearch();
          }
        }}
      />
      <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={onSearch} disabled={busy !== null}>
        Go
      </Button>
    </div>
  );
}
