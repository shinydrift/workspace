import React, { useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '../../../../shared/types/kanban';
import { DUE_SOON_MS } from './DueDateBadge';

interface DueDatePickerProps {
  task: KanbanTask;
  projectId: string;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
}

export function DueDatePicker({ task, projectId, updateTaskLocally }: DueDatePickerProps) {
  const [open, setOpen] = useState(false);

  const now = Date.now();
  const overdue = task.dueAt !== null && task.dueAt < now;
  const dueSoon = !overdue && task.dueAt !== null && task.dueAt - now < DUE_SOON_MS;

  // Use local date string for the input value so it matches what the user sees
  const currentValue = task.dueAt
    ? new Date(task.dueAt - new Date().getTimezoneOffset() * 60_000).toISOString().split('T')[0]
    : '';

  async function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // Parse as local midnight to avoid UTC-offset shifting the date by a day
    const dueAt = val ? new Date(val + 'T00:00:00').getTime() : null;
    const prev = task.dueAt;
    updateTaskLocally(task.id, { dueAt });
    setOpen(false);
    try {
      await window.electronAPI.kanban.setDueDate(projectId, task.id, dueAt);
    } catch {
      updateTaskLocally(task.id, { dueAt: prev });
    }
  }

  async function handleClear() {
    const prev = task.dueAt;
    updateTaskLocally(task.id, { dueAt: null });
    setOpen(false);
    try {
      await window.electronAPI.kanban.setDueDate(projectId, task.id, null);
    } catch {
      updateTaskLocally(task.id, { dueAt: prev });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6 p-0',
            overdue && 'text-destructive',
            dueSoon && 'text-amber-500',
            !overdue && !dueSoon && 'text-muted-foreground hover:text-foreground'
          )}
          title={task.dueAt ? `Due: ${new Date(task.dueAt).toLocaleDateString()}` : 'Set due date'}
        >
          <CalendarBlank size={13} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start" sideOffset={4}>
        <input
          type="date"
          className="block w-full text-sm bg-transparent border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          value={currentValue}
          onChange={handleDateChange}
        />
        {task.dueAt && (
          <button
            className="mt-2 w-full text-xs text-muted-foreground hover:text-destructive text-left px-1 py-0.5 rounded hover:bg-destructive/10 transition-colors"
            onClick={() => void handleClear()}
          >
            Clear due date
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
