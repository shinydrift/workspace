import React from 'react';
import { ChartLine, SquaresFour, Rows } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DisplayOptionsPopover } from './DisplayOptionsPopover';

interface CoordinatorBarProps {
  showCfd: boolean;
  onToggleCfd: () => void;
  viewMode: 'board' | 'list';
  onSetViewMode: (mode: 'board' | 'list') => void;
}

export function CoordinatorBar({ showCfd, onToggleCfd, viewMode, onSetViewMode }: CoordinatorBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50">
      <ToggleGroup
        type="single"
        value={viewMode}
        onValueChange={(v) => (v === 'board' || v === 'list') && onSetViewMode(v)}
        className="rounded-md border border-border/50 p-0.5 gap-0.5"
      >
        <ToggleGroupItem value="board" title="Board view" className="h-5 w-5 p-0">
          <SquaresFour size={12} />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" title="List view" className="h-5 w-5 p-0">
          <Rows size={12} />
        </ToggleGroupItem>
      </ToggleGroup>

      <Button
        variant="ghost"
        size="sm"
        className={cn('h-6 gap-1.5 text-xs', showCfd && 'text-primary bg-primary/10')}
        onClick={onToggleCfd}
      >
        <ChartLine size={13} />
        Flow
      </Button>
      <DisplayOptionsPopover />
    </div>
  );
}
