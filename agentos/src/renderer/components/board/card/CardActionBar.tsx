import React from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { KanbanTask } from '../../../../shared/types/kanban';
import type { Thread } from '../../../../shared/types/thread';
import { PriorityPicker } from './PriorityPicker';
import { DueDatePicker } from './DueDatePicker';
import { AgentAssignPicker } from './AgentAssignPicker';

interface CardActionBarProps {
  task: KanbanTask;
  projectId: string;
  threads: Record<string, Thread>;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  onOpen: () => void;
}

export function CardActionBar({ task, projectId, threads, updateTaskLocally, onOpen }: CardActionBarProps) {
  // Absolute positioning makes the HoverActions wrapper impractical here; group-hover responds to
  // TaskCard's outer group and focus-within covers keyboard navigation.
  return (
    <div
      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-100 flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-md px-1 py-0.5 z-10"
      onClick={(e) => e.stopPropagation()}
    >
      <PriorityPicker task={task} projectId={projectId} updateTaskLocally={updateTaskLocally} />
      <DueDatePicker task={task} projectId={projectId} updateTaskLocally={updateTaskLocally} />
      <AgentAssignPicker task={task} projectId={projectId} threads={threads} updateTaskLocally={updateTaskLocally} />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        title="Open details"
        onClick={onOpen}
      >
        <ArrowSquareOut size={13} />
      </Button>
    </div>
  );
}
