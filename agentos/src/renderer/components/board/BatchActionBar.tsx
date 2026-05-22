import React, { useMemo, useState } from 'react';
import { Trash, X, CaretDown, Archive } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import type { KanbanStage, KanbanTaskPriority } from '../../../shared/types/kanban';
import type { Thread } from '../../../shared/types/thread';
import { agentRoleBgColor, agentRoleSegment } from './card/agentAvatarUtils';
import { ThreadStatusDot } from '../threads/ThreadStatusDot';
import { listAssignableAgentThreads, matchesAgentQuery } from './taskSheetUtils';

const PRIORITIES: { value: KanbanTaskPriority; label: string; dot: string }[] = [
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { value: 'high', label: 'High', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dot: 'border border-muted-foreground' },
];

interface BatchActionBarProps {
  count: number;
  columns: KanbanStage[];
  threads: Record<string, Thread>;
  projectId: string;
  onMove: (status: string) => Promise<void>;
  onPriority: (priority: KanbanTaskPriority) => Promise<void>;
  onAssign: (threadId: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onClear: () => void;
}

export function BatchActionBar({
  count,
  columns,
  threads,
  projectId,
  onMove,
  onPriority,
  onAssign,
  onDelete,
  onArchive,
  onClear,
}: BatchActionBarProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');

  const candidates = useMemo(
    () => listAssignableAgentThreads(threads, projectId).filter((t) => matchesAgentQuery(t, assignQuery)),
    [threads, projectId, assignQuery]
  );

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div
        className={cn(
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
          'flex items-center gap-2 px-4 py-2.5',
          'bg-background border border-border shadow-lg rounded-lg',
          'animate-in slide-in-from-bottom-2 duration-200'
        )}
      >
        {busy ? (
          <span className="text-sm text-muted-foreground mr-1">{busy}…</span>
        ) : (
          <span className="text-sm font-medium mr-1">
            {count} task{count !== 1 ? 's' : ''} selected
          </span>
        )}

        {/* Move to */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!busy}>
              Move to <CaretDown size={11} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="min-w-[140px]">
            {columns
              .filter((c) => !c.terminal)
              .map((col) => (
                <DropdownMenuItem key={col.id} onSelect={() => void run(`Moving ${count}`, () => onMove(col.id))}>
                  {col.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!busy}>
              Priority <CaretDown size={11} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="min-w-[120px]">
            {PRIORITIES.map((p) => (
              <DropdownMenuItem key={p.value} onSelect={() => void run(`Updating ${count}`, () => onPriority(p.value))}>
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0 mr-2', p.dot)} />
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign */}
        <Popover
          open={assignOpen}
          onOpenChange={(v) => {
            setAssignOpen(v);
            if (!v) setAssignQuery('');
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!busy}>
              Assign <CaretDown size={11} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="center" side="top" sideOffset={8}>
            <div className="p-2 border-b border-border">
              <input
                autoFocus
                placeholder="Search threads…"
                className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                value={assignQuery}
                onChange={(e) => setAssignQuery(e.target.value)}
              />
            </div>
            <div className="py-1 max-h-48 overflow-y-auto">
              {candidates.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No agent threads found</p>
              )}
              {candidates.map((t) => {
                const segment = agentRoleSegment(t.agentRole);
                const letter = segment.charAt(0).toUpperCase();
                const bgColor = agentRoleBgColor(segment);
                return (
                  <button
                    key={t.id}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
                    onClick={() => {
                      setAssignOpen(false);
                      setAssignQuery('');
                      void run(`Assigning ${count}`, () => onAssign(t.id));
                    }}
                  >
                    <span className="relative flex-shrink-0">
                      <span
                        className={cn(
                          'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
                          bgColor
                        )}
                      >
                        {letter}
                      </span>
                      <ThreadStatusDot status={t.status} className="absolute bottom-0 right-0 border border-popover" />
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-border py-1">
              <button
                className="flex items-center w-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={() => {
                  setAssignOpen(false);
                  void run(`Assigning ${count}`, () => onAssign(null));
                }}
              >
                Unassign
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Archive */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
          disabled={!!busy}
          onClick={() => void run(`Archiving ${count}`, onArchive)}
        >
          <Archive size={13} />
          Archive
        </Button>

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={!!busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash size={13} />
          Delete
        </Button>

        {/* Clear */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!!busy}
          onClick={onClear}
          title="Clear selection"
        >
          <X size={14} />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${count} task${count !== 1 ? 's' : ''}?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false);
          void run(`Deleting ${count}`, onDelete);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
