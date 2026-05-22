import React from 'react';
import { Archive, ArrowCounterClockwise } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { PriorityCircle } from './card/PriorityCircle';
import { AgentAvatar } from './card/AgentAvatar';
import { DueDateBadge, DUE_SOON_MS } from './card/DueDateBadge';
import { BlockerBadge } from './card/BlockerBadge';
import { PriorityPicker } from './card/PriorityPicker';
import { DueDatePicker } from './card/DueDatePicker';
import { AgentAssignPicker } from './card/AgentAssignPicker';
import { useCardPrefs } from './CardPrefsContext';
import { SelectionCheckbox } from './SelectionCheckbox';
import { useTaskSelectionClick } from './useTaskSelectionClick';
import { HoverActions } from '@/components/ui/hover-actions';

interface ListRowProps {
  task: KanbanTask;
  threads?: Record<string, Thread>;
  projectId: string;
  subtaskCount?: { total: number; done: number };
  onClick: (task: KanbanTask) => void;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  onArchiveToggle?: () => void;
  isSelected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: () => void;
  onShiftClick?: () => void;
  onSetLastClicked?: () => void;
}

export function ListRow({
  task,
  threads = {},
  projectId,
  subtaskCount,
  onClick,
  updateTaskLocally,
  onArchiveToggle,
  isSelected,
  selectionActive,
  onToggleSelect,
  onShiftClick,
  onSetLastClicked,
}: ListRowProps) {
  const { prefs } = useCardPrefs();
  const handleClick = useTaskSelectionClick({
    task,
    selectionActive,
    onToggleSelect,
    onShiftClick,
    onSetLastClicked,
    onActivate: onClick,
  });
  const now = Date.now();
  const overdue = task.dueAt !== null && task.dueAt < now;
  const dueSoon = !overdue && task.dueAt !== null && task.dueAt - now < DUE_SOON_MS;
  const showDueBadge = prefs.showDueDateBadge && (overdue || dueSoon);
  const agentThread = task.assignedThreadId ? (threads[task.assignedThreadId] ?? null) : null;

  const isArchived = task.status === 'archived';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-3 h-9 cursor-pointer select-none',
        'hover:bg-accent/30 transition-colors duration-75 border-b border-border/20',
        task.classOfService === 'expedite' && 'border-l-2 border-amber-500',
        task.classOfService === 'intangible' && 'opacity-60',
        isArchived && 'opacity-50',
        isSelected && 'bg-primary/5 border-l-2 border-primary',
        selectionActive && !isSelected && 'opacity-70'
      )}
      onClick={handleClick}
    >
      {onToggleSelect && (
        <SelectionCheckbox
          selected={!!isSelected}
          onToggle={onToggleSelect}
          onSetLastClicked={onSetLastClicked}
          inline
        />
      )}

      <PriorityCircle priority={task.priority} />

      <span className={cn('flex-1 text-sm truncate min-w-0', isArchived && 'line-through text-muted-foreground')}>
        {task.title}
      </span>

      <HoverActions
        variant="overlay"
        actionsClassName="right-3"
        actions={
          !selectionActive ? (
            <>
              {!isArchived && (
                <>
                  <PriorityPicker task={task} projectId={projectId} updateTaskLocally={updateTaskLocally} />
                  <DueDatePicker task={task} projectId={projectId} updateTaskLocally={updateTaskLocally} />
                  <AgentAssignPicker
                    task={task}
                    projectId={projectId}
                    threads={threads}
                    updateTaskLocally={updateTaskLocally}
                  />
                </>
              )}
              {onArchiveToggle && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded"
                  title={isArchived ? 'Unarchive — move back to Done' : 'Archive'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveToggle();
                  }}
                >
                  {isArchived ? <ArrowCounterClockwise size={12} /> : <Archive size={12} />}
                  {isArchived ? 'Unarchive' : 'Archive'}
                </button>
              )}
            </>
          ) : null
        }
      >
        {/* group-hover:opacity-0 responds to both the outer row group and HoverActions' inner group */}
        <div
          className={cn(
            'flex items-center gap-2 shrink-0 transition-opacity duration-75',
            !selectionActive && 'group-hover:opacity-0'
          )}
        >
          {prefs.showAgentBadge && agentThread?.agentRole && <AgentAvatar thread={agentThread} />}
          {prefs.showSubtaskBadge && subtaskCount && subtaskCount.total > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {subtaskCount.done}/{subtaskCount.total}
            </span>
          )}
          {showDueBadge && task.dueAt !== null && <DueDateBadge dueAt={task.dueAt} />}
          {prefs.showBlockerCount && task.blockedBy.length > 0 && <BlockerBadge count={task.blockedBy.length} />}
        </div>
      </HoverActions>
    </div>
  );
}
