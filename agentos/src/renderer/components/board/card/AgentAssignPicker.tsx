import React, { useMemo, useState } from 'react';
import { Robot } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '../../../../shared/types/kanban';
import type { Thread } from '../../../../shared/types/thread';
import { agentRoleBgColor, agentRoleSegment } from './agentAvatarUtils';
import { ThreadStatusDot } from '../../threads/ThreadStatusDot';
import { listAssignableAgentThreads, matchesAgentQuery } from '../taskSheetUtils';

interface AgentAssignPickerProps {
  task: KanbanTask;
  projectId: string;
  threads: Record<string, Thread>;
  updateTaskLocally: (taskId: string, patch: Partial<KanbanTask>) => void;
}

export function AgentAssignPicker({ task, projectId, threads, updateTaskLocally }: AgentAssignPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const candidates = useMemo(
    () => listAssignableAgentThreads(threads, projectId).filter((t) => matchesAgentQuery(t, query)),
    [threads, projectId, query]
  );

  const assigned = task.assignedThreadId ? threads[task.assignedThreadId] : null;
  const isAssigned = !!assigned?.agentRole;

  async function handleSelect(threadId: string | null) {
    const prev = task.assignedThreadId;
    updateTaskLocally(task.id, { assignedThreadId: threadId });
    setOpen(false);
    setQuery('');
    try {
      await window.electronAPI.kanban.assignThread(projectId, task.id, threadId);
    } catch {
      updateTaskLocally(task.id, { assignedThreadId: prev });
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 p-0', isAssigned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          title={isAssigned ? `Assigned: ${assigned?.name}` : 'Assign agent'}
        >
          <Robot size={13} weight={isAssigned ? 'fill' : 'regular'} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" sideOffset={4}>
        <div className="p-2 border-b border-border">
          <input
            autoFocus
            placeholder="Search threads…"
            className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="py-1 max-h-48 overflow-y-auto">
          {candidates.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No agent threads found</p>}
          {candidates.map((t) => {
            const segment = agentRoleSegment(t.agentRole);
            const letter = segment.charAt(0).toUpperCase();
            const isCurrent = t.id === task.assignedThreadId;
            const bgColor = agentRoleBgColor(segment);
            return (
              <button
                key={t.id}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left',
                  isCurrent && 'bg-accent/50'
                )}
                onClick={() => void handleSelect(isCurrent ? null : t.id)}
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
                {isCurrent && <span className="text-xs text-muted-foreground shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
        {task.assignedThreadId && (
          <div className="border-t border-border py-1">
            <button
              className="flex items-center w-full px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => void handleSelect(null)}
            >
              Unassign
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
