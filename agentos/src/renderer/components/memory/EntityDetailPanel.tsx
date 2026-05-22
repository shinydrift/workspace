import React from 'react';
import type { EntityNode, EntityType } from '../../../main/memory/graph';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  entity: EntityNode;
  chunks: string[];
  typeColors: Record<EntityType, string>;
}

export function EntityDetailPanel({ entity, chunks, typeColors }: Props) {
  return (
    <ScrollArea className="min-h-0 border-l border-border/60">
      <div className="p-4">
        <div className="mb-2">
          <div
            className="mb-1 inline-block rounded px-2 py-0.5 text-xs"
            style={{ background: typeColors[entity.type], color: 'oklch(1 0 0)' }}
          >
            {entity.type}
          </div>
          <div className="break-all text-sm font-medium">{entity.name}</div>
        </div>
        <div className="mb-3 text-xs text-muted-foreground">{chunks.length} indexed chunks</div>
        {chunks.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chunk IDs</div>
            {chunks.slice(0, 10).map((id) => (
              <div key={id} className="truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                {id}
              </div>
            ))}
            {chunks.length > 10 && <div className="text-xs text-muted-foreground">+{chunks.length - 10} more</div>}
          </div>
        )}
        {entity.aliases.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Aliases</div>
            {entity.aliases.map((a) => (
              <div key={a} className="text-xs text-muted-foreground">
                {a}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
