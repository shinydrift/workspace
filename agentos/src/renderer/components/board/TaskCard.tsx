import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { PriorityCircle } from './card/PriorityCircle';
import { AgentAvatar } from './card/AgentAvatar';
import { ProgressDisplay } from './card/ProgressDisplay';
import { AgingDot } from './card/AgingDot';
import { BlockerBadge } from './card/BlockerBadge';
import { DueDateBadge, DUE_SOON_MS } from './card/DueDateBadge';
import { SkillTag } from './card/SkillTag';
import { CardActionBar } from './card/CardActionBar';
import { useCardPrefs } from './CardPrefsContext';
import { SelectionCheckbox } from './SelectionCheckbox';
import { useTaskSelectionClick } from './useTaskSelectionClick';

const WARN_MS = 2 * 24 * 60 * 60 * 1000;
const CRIT_MS = 5 * 24 * 60 * 60 * 1000;

interface TaskCardProps {
  task: KanbanTask;
  threads?: Record<string, Thread>;
  projectId: string;
  subtaskCount?: { total: number; done: number };
  onClick: (task: KanbanTask) => void;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, task: KanbanTask) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onShiftClick?: () => void;
  selectionActive?: boolean;
  onSetLastClicked?: () => void;
}

export function TaskCard({
  task,
  threads = {},
  projectId,
  subtaskCount,
  onClick,
  updateTaskLocally,
  draggable = true,
  onDragStart,
  isSelected,
  onToggleSelect,
  onShiftClick,
  selectionActive,
  onSetLastClicked,
}: TaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { prefs } = useCardPrefs();
  const handleClick = useTaskSelectionClick({
    task,
    selectionActive,
    onToggleSelect,
    onShiftClick,
    onSetLastClicked,
    onActivate: onClick,
  });

  const agentThread = task.assignedThreadId ? (threads[task.assignedThreadId] ?? null) : null;
  const showAgentAvatar = prefs.showAgentBadge && !!agentThread?.agentRole;

  const now = Date.now();
  const dwellMs = now - task.updatedAt;
  const agingLevel = prefs.showAgingIndicator ? (dwellMs > CRIT_MS ? 'crit' : dwellMs > WARN_MS ? 'warn' : null) : null;

  const overdue = task.dueAt !== null && task.dueAt < now;
  const dueSoon = !overdue && task.dueAt !== null && task.dueAt - now < DUE_SOON_MS;
  const showDueBadge = prefs.showDueDateBadge && (overdue || dueSoon);

  const hasRow3 =
    (prefs.showBlockerCount && task.blockedBy.length > 0) ||
    showDueBadge ||
    (prefs.showSubtaskBadge && !!subtaskCount && subtaskCount.total > 0);

  return (
    <div
      draggable={draggable}
      onDragStart={
        onDragStart
          ? (e) => {
              setIsDragging(true);
              onDragStart(e, task);
            }
          : undefined
      }
      onDragEnd={() => setIsDragging(false)}
      onClick={handleClick}
      className={cn(
        'group relative rounded-lg border border-border/40 bg-card p-3 cursor-pointer select-none',
        'hover:border-border/80 hover:bg-accent/20 transition-colors duration-100',
        'active:scale-95',
        isDragging && 'opacity-50',
        task.classOfService === 'expedite' && 'border-l-4 border-amber-500',
        task.classOfService === 'intangible' && 'opacity-60',
        isSelected && 'ring-2 ring-primary border-primary bg-primary/5',
        selectionActive && !isSelected && 'opacity-70'
      )}
    >
      {onToggleSelect && (
        <SelectionCheckbox selected={!!isSelected} onToggle={onToggleSelect} onSetLastClicked={onSetLastClicked} />
      )}

      {agingLevel && <AgingDot level={agingLevel} />}

      {/* Hover action bar — hidden when selection mode is active */}
      {!selectionActive && (
        <CardActionBar
          task={task}
          projectId={projectId}
          threads={threads}
          updateTaskLocally={updateTaskLocally}
          onOpen={() => onClick(task)}
        />
      )}

      {/* Title */}
      <p className="text-sm font-medium line-clamp-2 pr-4">{task.title}</p>

      {prefs.showDescriptionPreview && task.description && (
        <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{task.description}</p>
      )}

      {prefs.showTaskId && (
        <p
          className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 cursor-pointer hover:text-muted-foreground"
          title="Click to copy ID"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(task.id);
          }}
        >
          {task.id.slice(0, 8)}
        </p>
      )}

      {/* Row 1: priority + type + skill tags */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <PriorityCircle priority={task.priority} />
        {prefs.showSkillTags && task.skillTags.slice(0, 3).map((tag) => <SkillTag key={tag} tag={tag} />)}
        {prefs.showSkillTags && task.skillTags.length > 3 && (
          <span className="text-xs text-muted-foreground">+{task.skillTags.length - 3}</span>
        )}
      </div>

      {/* Row 2: agent + progress (conditional) */}
      {(showAgentAvatar || (prefs.showProgress && task.progress > 0)) && (
        <div className="flex items-center gap-2 mt-1.5">
          {showAgentAvatar && <AgentAvatar thread={agentThread!} />}
          {prefs.showProgress && task.progress > 0 && <ProgressDisplay progress={task.progress} />}
        </div>
      )}

      {/* Row 3: blockers + due date + subtask badge (conditional) */}
      {hasRow3 && (
        <div className="flex items-center gap-2 mt-1.5">
          {prefs.showBlockerCount && task.blockedBy.length > 0 && <BlockerBadge count={task.blockedBy.length} />}
          {showDueBadge && task.dueAt !== null && <DueDateBadge dueAt={task.dueAt} />}
          {prefs.showSubtaskBadge && subtaskCount && subtaskCount.total > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {subtaskCount.done}/{subtaskCount.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
