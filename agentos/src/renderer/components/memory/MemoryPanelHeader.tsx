import React from 'react';
import { Heart } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  busy: string | null;
  onOpenHealth: () => void;
  healthDot: boolean;
}

export function MemoryPanelHeader({ query, onQueryChange, onSearch, busy, onOpenHealth, healthDot }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search memory…"
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
      <Button
        type="button"
        variant="ghost"
        className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
        onClick={onOpenHealth}
      >
        <Heart className="h-[1em] w-[1em] shrink-0" />
        {healthDot && (
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusColors.warning.dot)} aria-hidden />
        )}
      </Button>
    </div>
  );
}
