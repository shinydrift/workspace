import React from 'react';
import { cn } from '@/lib/utils';
import type { KanbanTaskPriority } from '../../../../shared/types/kanban';

const PRIORITY_CONFIG: Record<KanbanTaskPriority, { label: string; className: string }> = {
  critical: { label: 'C', className: 'bg-red-500 text-white' },
  high: { label: 'H', className: 'bg-orange-500 text-white' },
  medium: { label: 'M', className: 'bg-yellow-500 text-black' },
  low: { label: 'L', className: 'border border-muted-foreground text-muted-foreground' },
};

interface PriorityCircleProps {
  priority: KanbanTaskPriority;
}

export function PriorityCircle({ priority }: PriorityCircleProps) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold leading-none shrink-0',
        config.className
      )}
      title={priority}
    >
      {config.label}
    </span>
  );
}
