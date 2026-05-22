import React from 'react';
import { CheckSquare } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '../../../shared/types/kanban';

interface Props {
  subtasks: KanbanTask[];
}

export function TaskSubtasksList({ subtasks }: Props) {
  if (subtasks.length === 0) return null;

  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <CheckSquare size={14} />
        Subtasks ({subtasks.filter((s) => s.status === 'done').length}/{subtasks.length})
      </h3>
      <div className="space-y-1.5">
        {subtasks.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2">
            <div
              className={cn(
                'w-3.5 h-3.5 rounded-sm border flex-shrink-0',
                sub.status === 'done'
                  ? 'bg-primary border-primary'
                  : sub.status === 'blocked'
                    ? 'border-destructive/60'
                    : 'border-border'
              )}
            />
            <span
              className={cn(
                'text-xs',
                sub.status === 'done' ? 'line-through text-muted-foreground/50' : 'text-foreground/80'
              )}
            >
              {sub.title}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
