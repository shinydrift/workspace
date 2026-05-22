import React, { useMemo, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { renderMarkdown } from '../../lib/markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import type { KanbanClassOfService, KanbanTask, KanbanTaskPriority } from '../../../shared/types/kanban';
import { TaskActivityTimeline } from './TaskActivityTimeline';
import { TaskComposer } from './TaskComposer';
import { TaskExecutionSection } from './TaskExecutionSection';
import { TaskSheetHeader } from './TaskSheetHeader';
import { TaskSubtasksList } from './TaskSubtasksList';
import { getTaskBlockerSummary, getTaskReviewState } from './taskSheetUtils';
import { useTaskSheetDetails } from './useTaskSheetDetails';

interface TaskSlideOverProps {
  task: KanbanTask | null;
  projectId: string;
  columns: { id: string; label: string }[];
  allTasks: KanbanTask[];
  onClose: () => void;
  onMove: (taskId: string, status: string) => void;
}

export function TaskSlideOver({ task, projectId, columns, allTasks, onClose, onMove }: TaskSlideOverProps) {
  const [savingNote, setSavingNote] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [savingBlocker, setSavingBlocker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);

  const thread = useDomainStore((s) => (task?.assignedThreadId ? s.threads[task.assignedThreadId] : null));
  const mainThread = useDomainStore((s) => (task?.mainThreadId ? s.threads[task.mainThreadId] : null));
  const threads = useDomainStore((s) => s.threads);
  const setSelectedThread = useUIStore((s) => s.setSelectedThread);
  const { events, subtasks, gitSummary, reloadTaskDetails } = useTaskSheetDetails({ task, projectId });

  async function handleAddNote(noteText: string) {
    if (!task || !noteText) return;
    setSavingNote(true);
    try {
      await window.electronAPI.kanban.addNote(projectId, task.id, noteText);
      reloadTaskDetails(task.id);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleAddReview(verdict: 'approved' | 'changes_requested', reviewText: string) {
    if (!task) return;
    setSavingReview(true);
    try {
      await window.electronAPI.kanban.addReview(projectId, task.id, verdict, reviewText || undefined);
      reloadTaskDetails(task.id);
    } finally {
      setSavingReview(false);
    }
  }

  async function handleSetBlocker(blocked: boolean, blockerText: string) {
    if (!task) return;
    setSavingBlocker(true);
    try {
      await window.electronAPI.kanban.setBlocker(projectId, task.id, blocked, blockerText || undefined);
      reloadTaskDetails(task.id);
    } finally {
      setSavingBlocker(false);
    }
  }

  async function handleUpdateClassOfService(classOfService: KanbanClassOfService) {
    if (!task) return;
    await window.electronAPI.kanban.updateClassOfService(projectId, task.id, classOfService);
  }

  async function handleUpdatePriority(priority: KanbanTaskPriority) {
    if (!task) return;
    await window.electronAPI.kanban.updatePriority(projectId, task.id, priority);
  }

  async function handleSetDueDate(dateStr: string) {
    if (!task) return;
    setSavingDueDate(true);
    try {
      const dueAt = dateStr ? new Date(dateStr).getTime() : null;
      await window.electronAPI.kanban.setDueDate(projectId, task.id, dueAt);
    } finally {
      setSavingDueDate(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    try {
      await window.electronAPI.kanban.delete(projectId, task.id);
      setConfirmDelete(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const descriptionHtml = useMemo(
    () => (task?.description ? renderMarkdown(task.description) : ''),
    [task?.description]
  );

  const { pending: reviewPending, summary: reviewSummary } = getTaskReviewState(task, events);
  const blockerSummary = getTaskBlockerSummary(task, events);
  const isBlocked = !!blockerSummary;

  const taskIndex = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);
  const blockedByTasks = useMemo(
    () =>
      (task?.blockedBy ?? []).filter((id) => id !== '__manual__').map((id) => taskIndex.get(id) ?? { id, title: id }),
    [task, taskIndex]
  );
  const isManuallyBlocked = task?.blockedBy.includes('__manual__') ?? false;

  const deleteDescription = task
    ? [
        `"${task.title}" will be permanently deleted.`,
        subtasks.length > 0
          ? `${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'} will be detached (not deleted).`
          : null,
        task.worktreePath ? 'Its git worktree and branch will also be removed.' : null,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && onClose()}>
      <SheetContent hideClose className="w-[900px] max-w-[96vw] gap-0 p-0">
        {task && (
          <div className="flex h-full min-h-0 flex-col">
            <TaskSheetHeader
              task={task}
              columns={columns}
              thread={thread}
              mainThread={mainThread}
              gitSummary={gitSummary}
              reviewSummary={reviewSummary}
              reviewPending={reviewPending}
              blockerSummary={blockerSummary}
              savingDueDate={savingDueDate}
              onDelete={() => setConfirmDelete(true)}
              deleting={deleting}
              onMove={onMove}
              onUpdatePriority={handleUpdatePriority}
              onUpdateClassOfService={handleUpdateClassOfService}
              onSetDueDate={handleSetDueDate}
              onOpenThread={(threadId) => {
                setSelectedThread(threadId);
                onClose();
              }}
            />

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 px-6 py-5">
                {task.description && (
                  <section>
                    <div
                      className="chat-markdown prose prose-sm dark:prose-invert max-w-none text-foreground/85"
                      dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                    />
                  </section>
                )}

                {(blockedByTasks.length > 0 || isManuallyBlocked) && (
                  <section>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Blocked by</p>
                    <div className="space-y-1">
                      {isManuallyBlocked && (
                        <div className="flex items-center gap-2 rounded bg-red-500/10 px-2 py-1">
                          <span className="text-[11px] text-red-600 dark:text-red-400">Manually blocked</span>
                        </div>
                      )}
                      {blockedByTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1">
                          <span className="font-mono text-[10px] text-muted-foreground">{t.id.slice(0, 8)}</span>
                          <span className="truncate text-[11px] text-foreground/80">{t.title}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {subtasks.length > 0 && <TaskSubtasksList subtasks={subtasks} />}

                {(thread || mainThread) && <TaskExecutionSection thread={(thread ?? mainThread)!} />}

                <TaskActivityTimeline
                  events={events}
                  threads={threads}
                  projectId={projectId}
                  onEventsChanged={() => task && reloadTaskDetails(task.id)}
                />
              </div>
            </ScrollArea>

            <div className="border-t border-border bg-background px-6 py-4">
              <TaskComposer
                reviewPending={reviewPending}
                isBlocked={isBlocked}
                savingNote={savingNote}
                savingReview={savingReview}
                savingBlocker={savingBlocker}
                onAddNote={(text) => handleAddNote(text)}
                onApprove={(text) => handleAddReview('approved', text)}
                onRequestChanges={(text) => handleAddReview('changes_requested', text)}
                onSetBlocked={(text) => handleSetBlocker(true, text)}
                onClearBlocker={(text) => handleSetBlocker(false, text)}
              />
            </div>
          </div>
        )}
      </SheetContent>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete task"
        description={deleteDescription}
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Sheet>
  );
}
