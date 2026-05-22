import React, { useCallback, useEffect, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { KanbanTask, KanbanTaskPriority } from '../../../../shared/types/kanban';

const PRIORITIES: { value: KanbanTaskPriority; label: string; key: string; className: string }[] = [
  { value: 'critical', label: 'Critical', key: '1', className: 'bg-red-500 text-white' },
  { value: 'high', label: 'High', key: '2', className: 'bg-orange-500 text-white' },
  { value: 'medium', label: 'Medium', key: '3', className: 'bg-yellow-500 text-black' },
  { value: 'low', label: 'Low', key: '4', className: 'border border-muted-foreground text-muted-foreground' },
];

const PRIORITY_DOT: Record<KanbanTaskPriority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'border border-muted-foreground',
};

interface PriorityPickerProps {
  task: KanbanTask;
  projectId: string;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
}

export function PriorityPicker({ task, projectId, updateTaskLocally }: PriorityPickerProps) {
  const [open, setOpen] = useState(false);

  const applyPriority = useCallback(
    (priority: KanbanTaskPriority) => {
      if (priority === task.priority) {
        setOpen(false);
        return;
      }
      const prev = task.priority;
      updateTaskLocally(task.id, { priority });
      setOpen(false);
      void window.electronAPI.kanban.updatePriority(projectId, task.id, priority).catch(() => {
        updateTaskLocally(task.id, { priority: prev });
      });
    },
    [task.priority, task.id, projectId, updateTaskLocally]
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const match = PRIORITIES.find((p) => p.key === e.key);
      if (match) applyPriority(match.value);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, applyPriority]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0" title={`Priority: ${task.priority}`}>
          <span className={cn('w-3 h-3 rounded-full inline-block', PRIORITY_DOT[task.priority])} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start" sideOffset={4}>
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            className="flex items-center w-full gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent cursor-pointer"
            onClick={() => applyPriority(p.value)}
          >
            <span className={cn('w-3 h-3 rounded-full shrink-0', p.className)} />
            <span className="flex-1 text-left">{p.label}</span>
            <span className="text-xs text-muted-foreground">{p.key}</span>
            {task.priority === p.value && <Check size={12} className="text-primary shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
