import React from 'react';
import type { EntityType } from '../../../main/memory/graph';
import { ALL_ENTITY_TYPES } from './useMemoryGraphScene';

interface Props {
  activeTypes: Set<EntityType>;
  hideOrphans: boolean;
  totalCount: number | null;
  typeColors: Record<EntityType, string>;
  visibleCount: number;
  onToggleOrphans: () => void;
  onToggleType: (type: EntityType) => void;
}

export function GraphToolbar({
  activeTypes,
  hideOrphans,
  totalCount,
  typeColors,
  visibleCount,
  onToggleOrphans,
  onToggleType,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 shrink-0">
      {totalCount !== null && (
        <div className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {visibleCount === totalCount ? `${totalCount} entities` : `${visibleCount} / ${totalCount} entities`}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {ALL_ENTITY_TYPES.map((type) => {
          const color = typeColors[type] ?? '#6b7280';
          const active = activeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity"
              style={{ opacity: active ? 1 : 0.35 }}
              title={active ? `Hide ${type}` : `Show ${type}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {type}
            </button>
          );
        })}
      </div>

      <button
        onClick={onToggleOrphans}
        className="rounded px-2 py-1 text-xs transition-opacity"
        style={{ opacity: hideOrphans ? 1 : 0.5 }}
        title={hideOrphans ? 'Show isolated nodes' : 'Hide isolated nodes'}
      >
        {hideOrphans ? 'orphans hidden' : 'show orphans'}
      </button>
    </div>
  );
}
