import React, { useState } from 'react';
import { CaretDown, CaretRight, Lock, Archive } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { KanbanTask } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { ListRow } from './ListRow';

interface ColumnDef {
  id: string;
  label: string;
  isBlocked: boolean;
}

interface ListViewProps {
  columnDefs: ColumnDef[];
  tasksByStatus: Record<string, KanbanTask[]>;
  archivedTasks: KanbanTask[];
  threads: Record<string, Thread>;
  projectId: string;
  subtaskCounts: Record<string, { total: number; done: number }>;
  onTaskClick: (task: KanbanTask) => void;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  onRangeSelect?: (taskId: string, orderedIds: string[]) => void;
  onSetLastClicked?: (taskId: string) => void;
}

export function ListView({
  columnDefs,
  tasksByStatus,
  archivedTasks,
  threads,
  projectId,
  subtaskCounts,
  onTaskClick,
  updateTaskLocally,
  selectedTaskIds,
  onToggleSelect,
  onRangeSelect,
  onSetLastClicked,
}: ListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['__archived__']));

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleArchiveToggle(task: KanbanTask) {
    const newStatus = task.status === 'archived' ? 'done' : 'archived';
    try {
      const updated = await window.electronAPI.kanban.move(projectId, task.id, newStatus);
      updateTaskLocally(task.id, updated);
    } catch {
      // ignore
    }
  }

  const nonEmptyDefs = columnDefs.filter(({ id }) => (tasksByStatus[id] ?? []).length > 0);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        {nonEmptyDefs.map(({ id, label, isBlocked }) => {
          const tasks = tasksByStatus[id] ?? [];
          const isCollapsed = collapsed.has(id);

          return (
            <div key={id} className="mb-1">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-accent/20 select-none sticky top-0 bg-background/95 backdrop-blur-sm z-10"
                onClick={() => toggle(id)}
              >
                {isCollapsed ? (
                  <CaretRight size={11} className="text-muted-foreground shrink-0" />
                ) : (
                  <CaretDown size={11} className="text-muted-foreground shrink-0" />
                )}
                {isBlocked && <Lock size={11} className="text-amber-500 shrink-0" />}
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${isBlocked ? 'text-amber-500' : 'text-muted-foreground'}`}
                >
                  {label}
                </span>
                <span className="text-xs text-muted-foreground/50 ml-0.5">{tasks.length}</span>
              </div>
              {!isCollapsed &&
                (() => {
                  const orderedIds = tasks.map((t) => t.id);
                  return tasks.map((task) => (
                    <ListRow
                      key={task.id}
                      task={task}
                      threads={threads}
                      projectId={projectId}
                      subtaskCount={subtaskCounts[task.id]}
                      onClick={onTaskClick}
                      updateTaskLocally={updateTaskLocally}
                      onArchiveToggle={() => void handleArchiveToggle(task)}
                      isSelected={selectedTaskIds?.has(task.id)}
                      selectionActive={!!selectedTaskIds && selectedTaskIds.size > 0}
                      onToggleSelect={onToggleSelect ? () => onToggleSelect(task.id) : undefined}
                      onShiftClick={onRangeSelect ? () => onRangeSelect(task.id, orderedIds) : undefined}
                      onSetLastClicked={onSetLastClicked ? () => onSetLastClicked(task.id) : undefined}
                    />
                  ));
                })()}
            </div>
          );
        })}

        {/* Archived section — always at the bottom, collapsed by default */}
        {archivedTasks.length > 0 && (
          <div className="mb-1 mt-2 border-t border-border/30 pt-2">
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-accent/20 select-none sticky top-0 bg-background/95 backdrop-blur-sm z-10"
              onClick={() => toggle('__archived__')}
            >
              {collapsed.has('__archived__') ? (
                <CaretRight size={11} className="text-muted-foreground/50 shrink-0" />
              ) : (
                <CaretDown size={11} className="text-muted-foreground/50 shrink-0" />
              )}
              <Archive size={11} className="text-muted-foreground/50 shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/50">Archived</span>
              <span className="text-xs text-muted-foreground/30 ml-0.5">{archivedTasks.length}</span>
            </div>
            {!collapsed.has('__archived__') &&
              archivedTasks.map((task) => (
                <ListRow
                  key={task.id}
                  task={task}
                  threads={threads}
                  projectId={projectId}
                  subtaskCount={subtaskCounts[task.id]}
                  onClick={onTaskClick}
                  updateTaskLocally={updateTaskLocally}
                  onArchiveToggle={() => void handleArchiveToggle(task)}
                />
              ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
