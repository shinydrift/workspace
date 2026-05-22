import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { List, ListItem } from '@/components/ui/list';
import { formatTimestamp } from '../../../lib/analyticsFormatters';
import type { ContainerSummary, Thread } from '../../../../shared/types';

interface Props {
  containers: ContainerSummary[];
  threads: Record<string, Thread>;
  loading: boolean;
  onRemove: (containerName: string) => void;
}

export function ManagedContainerList({ containers, threads, loading, onRemove }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Managed Containers</p>
      <div className="overflow-y-auto max-h-56">
        <List empty={containers.length === 0} emptyText={loading ? 'Loading…' : 'No containers for this project.'}>
          {containers.map((c) => {
            const state = !c.exists ? 'not found' : c.running ? 'running' : 'stopped';
            const stateColor = c.running ? 'text-status-success' : 'text-muted-foreground';
            return (
              <ListItem key={c.containerName}>
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    c.running ? 'bg-status-success' : 'bg-muted-foreground/40'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-foreground">{c.containerName}</p>
                  <p className="truncate text-muted-foreground">{threads[c.threadId]?.name ?? c.threadId}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={stateColor}>
                    {state}
                    {c.orphaned ? ' · orphan' : ''}
                  </span>
                  {c.drift && <span className="text-status-warning">drift</span>}
                  <span className="text-muted-foreground">{formatTimestamp(c.lastUsedAtMs)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => onRemove(c.containerName)}
                  >
                    Remove
                  </Button>
                </div>
              </ListItem>
            );
          })}
        </List>
      </div>
    </div>
  );
}
