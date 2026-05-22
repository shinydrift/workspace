import React from 'react';
import type { ThreadFilter } from '../../store/uiStore';
import { useUIStore } from '../../store/uiStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

function isFilterActive(filter: ThreadFilter): boolean {
  return filter.query.trim().length > 0 || filter.status !== 'all' || filter.sortBy !== 'newest';
}

interface FilterBarProps {
  totalCount: number;
  filteredCount: number;
  setSearchInputRef: (el: HTMLInputElement | null) => void;
}

const STATUS_OPTIONS = ['all', 'running', 'idle', 'stopped', 'error'] as const;
const SORT_OPTIONS: { value: ThreadFilter['sortBy']; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'last-active', label: 'Active' },
  { value: 'name', label: 'A–Z' },
];

export function FilterBar({ totalCount, filteredCount, setSearchInputRef }: FilterBarProps) {
  const { threadFilter, setThreadFilter } = useUIStore();

  return (
    <div className="mt-1 mb-2 space-y-1.5">
      <Input
        ref={setSearchInputRef}
        type="text"
        placeholder="Search threads..."
        value={threadFilter.query}
        onChange={(e) => setThreadFilter({ query: e.target.value })}
        className="bg-muted border-none rounded-lg px-2 py-1.5 h-auto text-xs leading-none ring-1 ring-transparent focus-visible:ring-border focus-visible:ring-offset-0"
      />

      <ToggleGroup
        type="single"
        value={threadFilter.status}
        onValueChange={(v) => {
          if (v) setThreadFilter({ status: v as ThreadFilter['status'] });
        }}
        className="rounded-lg bg-muted p-0.5 w-fit"
      >
        {STATUS_OPTIONS.map((status) => (
          <ToggleGroupItem
            key={status}
            value={status}
            className="h-auto text-xs px-2 py-0.5 shrink-0 rounded-md capitalize data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=off]:text-muted-foreground hover:bg-transparent hover:text-muted-foreground data-[state=on]:hover:bg-background data-[state=on]:hover:text-foreground"
          >
            {status}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={threadFilter.sortBy}
          onValueChange={(v) => {
            if (v) setThreadFilter({ sortBy: v as ThreadFilter['sortBy'] });
          }}
          className="rounded-lg bg-muted p-0.5 w-fit"
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-auto text-xs px-2 py-0.5 shrink-0 rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=off]:text-muted-foreground hover:bg-transparent hover:text-muted-foreground data-[state=on]:hover:bg-background data-[state=on]:hover:text-foreground"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {isFilterActive(threadFilter) && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-xs shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors"
            onClick={() => setThreadFilter({ query: '', status: 'all', sortBy: 'newest' })}
          >
            Clear
          </Button>
        )}
      </div>

      {isFilterActive(threadFilter) && (
        <div className="px-0.5 text-xs text-muted-foreground">
          {filteredCount} of {totalCount} threads
        </div>
      )}
    </div>
  );
}
