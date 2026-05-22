import React from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  enabling: boolean;
  onEnable: () => void;
}

export function BoardEmptyState({ enabling, onEnable }: Props) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-3 text-center px-6">
      <p className="text-sm font-medium">Board not enabled for this project</p>
      <p className="text-xs text-muted-foreground max-w-xs">
        Enable the Kanban board to track tasks and run autonomous agents per stage.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onEnable} disabled={enabling} className="text-xs">
        {enabling ? 'Enabling…' : 'Enable Board'}
      </Button>
    </div>
  );
}
