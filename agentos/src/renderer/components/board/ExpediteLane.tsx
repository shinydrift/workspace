import React from 'react';
import { Lightning } from '@phosphor-icons/react';
import type { KanbanTask } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { TaskCard } from './TaskCard';

interface ExpediteLaneProps {
  tasks: KanbanTask[];
  projectId: string;
  threads: Record<string, Thread>;
  subtaskCounts?: Record<string, { total: number; done: number }>;
  onTaskClick: (task: KanbanTask) => void;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  onRangeSelect?: (taskId: string, orderedIds: string[]) => void;
  onSetLastClicked?: (taskId: string) => void;
}

export function ExpediteLane({
  tasks,
  projectId,
  threads,
  subtaskCounts,
  onTaskClick,
  updateTaskLocally,
  selectedTaskIds,
  onToggleSelect,
  onRangeSelect,
  onSetLastClicked,
}: ExpediteLaneProps) {
  if (tasks.length === 0) return null;

  const orderedIds = tasks.map((t) => t.id);

  return (
    <div className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Lightning size={13} weight="fill" className="text-destructive" />
        <span className="text-xs font-semibold text-destructive">Expedite</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>
      {tasks.length > 1 && (
        <p className="mb-2 text-xs text-destructive/70">⚠ Multiple expedite tasks active — resolve ASAP</p>
      )}
      <div className="flex flex-wrap gap-2">
        {tasks.map((task) => (
          <div key={task.id} className="w-[240px]">
            <TaskCard
              task={task}
              projectId={projectId}
              threads={threads}
              subtaskCount={subtaskCounts?.[task.id]}
              onClick={onTaskClick}
              updateTaskLocally={updateTaskLocally}
              isSelected={selectedTaskIds?.has(task.id)}
              selectionActive={!!selectedTaskIds && selectedTaskIds.size > 0}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(task.id) : undefined}
              onShiftClick={onRangeSelect ? () => onRangeSelect(task.id, orderedIds) : undefined}
              onSetLastClicked={onSetLastClicked ? () => onSetLastClicked(task.id) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
