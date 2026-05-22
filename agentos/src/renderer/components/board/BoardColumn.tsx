import React, { useEffect, useRef, useState } from 'react';
import { Lock, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TaskCard } from './TaskCard';
import type { KanbanTask } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { useCardPrefs } from './CardPrefsContext';

interface BoardColumnProps {
  status: string;
  label: string;
  tasks: KanbanTask[];
  threads: Record<string, Thread>;
  projectId: string;
  wipLimit: number | null;
  isBlocked?: boolean;
  subtaskCounts?: Record<string, { total: number; done: number }>;
  onTaskClick: (task: KanbanTask) => void;
  onDrop: (taskId: string, newStatus: string) => void;
  onAddTask: (status: string) => void;
  onWipLimitChange?: (newLimit: number) => void;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  onRangeSelect?: (taskId: string, orderedIds: string[]) => void;
  onSetLastClicked?: (taskId: string) => void;
}

export function BoardColumn({
  status,
  label,
  tasks,
  threads,
  projectId,
  wipLimit,
  isBlocked,
  subtaskCounts,
  onTaskClick,
  onDrop,
  onAddTask,
  onWipLimitChange,
  updateTaskLocally,
  selectedTaskIds,
  onToggleSelect,
  onRangeSelect,
  onSetLastClicked,
}: BoardColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  const [editingWip, setEditingWip] = useState(false);
  const wipInputRef = useRef<HTMLInputElement>(null);
  const wipCancelRef = useRef(false);
  const { prefs } = useCardPrefs();
  const atLimit = wipLimit !== null && tasks.length >= wipLimit;

  useEffect(() => {
    if (!prefs.showWipLimit) setEditingWip(false);
  }, [prefs.showWipLimit]);

  function commitWipEdit() {
    if (wipCancelRef.current) {
      wipCancelRef.current = false;
      return;
    }
    const parsed = parseInt(wipInputRef.current?.value ?? '', 10);
    setEditingWip(false);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      onWipLimitChange?.(parsed);
    }
  }

  function handleDragStart(e: React.DragEvent, task: KanbanTask) {
    e.dataTransfer.setData('taskId', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) onDrop(taskId, status);
  }

  return (
    <div className="flex flex-col min-w-[220px] max-w-[260px] flex-shrink-0">
      {/* Column header */}
      <div
        className={cn(
          'flex items-center justify-between px-1 mb-2 pb-1.5',
          isBlocked && 'border-b-2 border-red-500/60 bg-red-500/10 dark:bg-red-500/5 rounded-t px-2 -mx-1'
        )}
      >
        <div className="flex items-center gap-2">
          {isBlocked && <Lock size={12} weight="bold" className="text-red-600 dark:text-red-400" />}
          <span
            className={cn(
              'text-xs font-medium uppercase tracking-wide',
              isBlocked ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'
            )}
          >
            {label}
          </span>
          {(prefs.showTaskCount || atLimit) && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-mono',
                atLimit ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'
              )}
            >
              {tasks.length}
              {wipLimit !== null &&
                prefs.showWipLimit &&
                (editingWip ? (
                  <>
                    /
                    <input
                      ref={wipInputRef}
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={wipLimit}
                      autoFocus
                      className="w-7 bg-transparent outline-none border-b border-current font-mono text-xs"
                      onBlur={commitWipEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          wipCancelRef.current = true;
                          setEditingWip(false);
                        }
                      }}
                    />
                  </>
                ) : (
                  <span
                    className={cn(onWipLimitChange && 'cursor-pointer hover:opacity-70')}
                    title={onWipLimitChange ? 'Click to edit WIP limit' : undefined}
                    onClick={() => onWipLimitChange && setEditingWip(true)}
                  >
                    /{wipLimit}
                  </span>
                ))}
              {wipLimit !== null && !prefs.showWipLimit && atLimit && (
                <span className="text-destructive">/{wipLimit}</span>
              )}
            </span>
          )}
        </div>
        {!isBlocked && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onAddTask(status)}
            aria-label={`Add task to ${status}`}
          >
            <Plus size={12} weight="bold" />
          </Button>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col gap-2 flex-1 rounded-lg p-1.5 min-h-[80px] transition-colors',
          dragOver ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-transparent'
        )}
      >
        {(() => {
          const orderedIds = tasks.map((t) => t.id);
          return tasks.map((task) => (
            <div key={task.id} className={cn(isBlocked && 'border-l-4 border-red-500 bg-red-500/5 rounded-r')}>
              <TaskCard
                task={task}
                threads={threads}
                projectId={projectId}
                subtaskCount={subtaskCounts?.[task.id]}
                onClick={onTaskClick}
                onDragStart={handleDragStart}
                updateTaskLocally={updateTaskLocally}
                isSelected={selectedTaskIds?.has(task.id)}
                selectionActive={!!selectedTaskIds && selectedTaskIds.size > 0}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(task.id) : undefined}
                onShiftClick={onRangeSelect ? () => onRangeSelect(task.id, orderedIds) : undefined}
                onSetLastClicked={onSetLastClicked ? () => onSetLastClicked(task.id) : undefined}
              />
            </div>
          ));
        })()}
        {tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs text-muted-foreground/40 italic">empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
