import React from 'react';
import { CheckCircle, GitBranch, Robot, ShieldWarning, Trash, Warning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { Thread } from '../../../shared/types';
import { ThreadStatusDot } from '../threads/ThreadStatusDot';
import type {
  KanbanClassOfService,
  KanbanTask,
  KanbanTaskEvent,
  KanbanTaskGitSummary,
  KanbanTaskPriority,
} from '../../../shared/types/kanban';

const PRIORITIES: { value: KanbanTaskPriority; label: string; dotClass: string }[] = [
  { value: 'critical', label: 'Critical', dotClass: 'bg-red-500' },
  { value: 'high', label: 'High', dotClass: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dotClass: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dotClass: 'border border-muted-foreground' },
];

interface Props {
  task: KanbanTask;
  columns: { id: string; label: string }[];
  thread: Thread | null;
  mainThread: Thread | null;
  gitSummary: KanbanTaskGitSummary | null;
  reviewSummary: KanbanTaskEvent | null;
  reviewPending: boolean;
  blockerSummary: KanbanTaskEvent | null;
  savingDueDate: boolean;
  onDelete: () => void;
  deleting: boolean;
  onMove: (taskId: string, status: string) => void;
  onUpdatePriority: (priority: KanbanTaskPriority) => void;
  onUpdateClassOfService: (classOfService: KanbanClassOfService) => void;
  onSetDueDate: (dateStr: string) => void;
  onOpenThread: (threadId: string) => void;
}

export function TaskSheetHeader({
  task,
  columns,
  thread,
  mainThread,
  gitSummary,
  reviewSummary,
  reviewPending,
  blockerSummary,
  savingDueDate,
  onDelete,
  deleting,
  onMove,
  onUpdatePriority,
  onUpdateClassOfService,
  onSetDueDate,
  onOpenThread,
}: Props) {
  const reviewReason =
    typeof reviewSummary?.data.summary === 'string'
      ? reviewSummary.data.summary
      : typeof reviewSummary?.data.reason === 'string'
        ? reviewSummary.data.reason
        : '';
  const blockerReason =
    typeof blockerSummary?.data.summary === 'string'
      ? blockerSummary.data.summary
      : typeof blockerSummary?.data.reason === 'string'
        ? blockerSummary.data.reason
        : '';

  return (
    <div className="border-b border-border px-6 pt-4 pb-3">
      <p className="mb-1.5 font-mono text-[11px] text-muted-foreground/50">
        {task.id.slice(0, 8)}… · created {new Date(task.createdAt).toLocaleDateString()}
      </p>

      <div className="flex items-start justify-between gap-3">
        <SheetTitle className="text-lg leading-snug font-semibold">{task.title}</SheetTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          aria-label="Delete task"
        >
          <Trash size={14} />
        </Button>
      </div>

      {/* Property chip row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <PopoverSelect
          value={task.status}
          options={columns.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(v) => onMove(task.id, v)}
          contentClassName="w-44"
        />

        <PopoverSelect
          value={task.priority}
          options={PRIORITIES.map((p) => ({
            value: p.value,
            label: p.label,
            leading: <span className={cn('h-2 w-2 shrink-0 rounded-full', p.dotClass)} />,
          }))}
          onChange={onUpdatePriority}
          contentClassName="w-36"
        />

        <Select value={task.classOfService} onValueChange={(v) => onUpdateClassOfService(v as KanbanClassOfService)}>
          <SelectTrigger className="h-6 w-auto gap-1 border-0 px-1.5 text-xs shadow-none focus:ring-0 hover:bg-muted/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="expedite">Expedite</SelectItem>
            <SelectItem value="intangible">Intangible</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex h-6 cursor-pointer items-center rounded px-1.5 hover:bg-muted/60">
          {!task.dueAt && <span className="pointer-events-none mr-1 text-xs text-muted-foreground">Due date</span>}
          <input
            type="date"
            disabled={savingDueDate}
            value={task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : ''}
            onChange={(e) => onSetDueDate(e.target.value)}
            className="h-full border-0 bg-transparent text-xs text-foreground focus:outline-none disabled:opacity-50"
          />
        </label>

        <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="font-mono text-xs tabular-nums text-foreground/70">{task.progress}%</span>
        </div>

        {task.branch && (
          <span className="flex items-center gap-1 rounded px-1.5 py-0.5">
            <GitBranch size={11} className="shrink-0 text-muted-foreground" />
            <span className="max-w-[160px] truncate font-mono text-[11px] text-foreground/75">{task.branch}</span>
          </span>
        )}

        {gitSummary && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted/60"
              >
                <span className="font-mono text-[11px] text-foreground/75">{gitSummary.shortSha}</span>
                <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">{gitSummary.subject}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-80 overflow-y-auto p-3">
              <p className="text-[11px] text-muted-foreground">
                {gitSummary.authorName} · {new Date(gitSummary.authoredAt).toLocaleString()}
                {gitSummary.isDirty === true && ' · dirty'}
                {gitSummary.isDirty === false && ' · clean'}
              </p>
              {gitSummary.changedFiles.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {gitSummary.changedFiles.map((file) => (
                    <div key={`${file.status}:${file.path}`} className="flex items-center gap-2 text-[11px]">
                      <span className="w-10 shrink-0 uppercase text-muted-foreground">{file.status}</span>
                      <code className="truncate text-foreground/75">{file.path}</code>
                    </div>
                  ))}
                  {gitSummary.totalChangedFiles > gitSummary.changedFiles.length && (
                    <p className="text-[11px] text-muted-foreground">
                      +{gitSummary.totalChangedFiles - gitSummary.changedFiles.length} more
                    </p>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {task.mainThreadId && (
          <ThreadChip
            thread={mainThread}
            threadId={task.mainThreadId}
            onOpen={() => onOpenThread(task.mainThreadId!)}
          />
        )}

        {task.assignedThreadId && (
          <ThreadChip
            thread={thread}
            threadId={task.assignedThreadId}
            onOpen={() => onOpenThread(task.assignedThreadId!)}
          />
        )}
      </div>

      {(reviewPending || reviewSummary || blockerSummary) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {reviewPending && (
            <AlertStrip
              tone="amber"
              icon={<Warning size={13} />}
              label="Awaiting review"
              detail={reviewReason || null}
            />
          )}
          {!reviewPending &&
            reviewSummary &&
            (() => {
              const approved =
                reviewSummary.kind === 'review'
                  ? reviewSummary.data.verdict === 'approved'
                  : reviewSummary.data.toStatus === 'done';
              return (
                <AlertStrip
                  tone={approved ? 'green' : 'amber'}
                  icon={approved ? <CheckCircle size={13} /> : <Warning size={13} />}
                  label={approved ? 'Approved' : 'Changes requested'}
                  detail={reviewReason || null}
                />
              );
            })()}
          {blockerSummary && (
            <AlertStrip tone="red" icon={<ShieldWarning size={13} />} label="Blocked" detail={blockerReason || null} />
          )}
        </div>
      )}
    </div>
  );
}

interface ThreadChipProps {
  thread: Thread | null;
  threadId: string;
  onOpen: () => void;
}

function ThreadChip({ thread, threadId, onOpen }: ThreadChipProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex max-w-[200px] items-center gap-1.5 overflow-hidden rounded px-1.5 py-0.5 text-left hover:bg-muted/60"
    >
      <Robot size={11} className="shrink-0 text-muted-foreground" />
      <ThreadStatusDot status={thread?.status ?? 'idle'} animated />
      <span className="truncate font-mono text-[11px] text-foreground/80">
        {thread?.agentRole ?? threadId.slice(0, 8)}
      </span>
      {thread?.name && <span className="truncate text-[11px] text-muted-foreground">· {thread.name}</span>}
    </button>
  );
}

interface AlertStripProps {
  tone: 'amber' | 'red' | 'green';
  icon: React.ReactNode;
  label: string;
  detail: string | null;
}

function AlertStrip({ tone, icon, label, detail }: AlertStripProps) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : tone === 'red'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs', toneClass)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        {detail && <span className="ml-1.5 text-foreground/70">— {detail}</span>}
      </div>
    </div>
  );
}
