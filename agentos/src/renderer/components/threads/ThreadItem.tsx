import React, { useMemo, useState } from 'react';
import type { ContainerSummary, Thread } from '../../../shared/types';
import { cn } from '@/lib/utils';
import { RelativeTime } from '@/components/ui/relative-time';
import { threadStatusDot } from '../../lib/status-colors';
import { Robot, CaretRight } from '@phosphor-icons/react';
import { StatusDot } from '@/components/ui/status-badge';
import { HoverActions } from '@/components/ui/hover-actions';
import { ThreadItemMenu } from './ThreadItemMenu';
import { useCouncilRuns } from '../../hooks/useCouncilRuns';
import { useThreadListContext } from './ThreadListContext';

function containerTooltip(c: ContainerSummary): string {
  const base = !c.exists
    ? 'Container not found'
    : c.orphaned
      ? 'Container orphaned'
      : c.running
        ? 'Container running'
        : 'Container stopped';
  return c.drift && c.exists ? `${base} · config drifted` : base;
}

interface ThreadItemProps {
  thread: Thread;
  /** Override the default select behaviour (e.g. dialog needs extra cleanup). */
  onSelect?: () => void;
}

export function ThreadItem({ thread: t, onSelect: onSelectOverride }: ThreadItemProps) {
  const {
    selectedId,
    menuId,
    renamingId,
    renameInput,
    containersByThread,
    childrenByParentId,
    setMenuId,
    setSelectedThread,
    setRenameInput,
    startRename,
    commitRename,
    cancelRename,
    stopThread,
    archiveThread,
  } = useThreadListContext();

  const container: ContainerSummary | undefined = containersByThread.get(t.id);
  const subThreads: Thread[] | undefined = childrenByParentId.get(t.id);

  function onSelect() {
    if (onSelectOverride) {
      onSelectOverride();
    } else {
      setSelectedThread(t.id);
    }
  }

  const hasSubThreads = subThreads && subThreads.length > 0;
  const [subThreadsExpanded, setSubThreadsExpanded] = useState(false);

  const councilEntries = useCouncilRuns(hasSubThreads ? t.id : null);
  const councilPromptById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of councilEntries) map.set(entry.run.id, entry.run.prompt);
    return map;
  }, [councilEntries]);

  const subThreadGroups = useMemo(() => {
    if (!subThreads) return [];
    const groups = new Map<string, Thread[]>();
    for (const child of subThreads) {
      const key = child.councilRunId ?? '';
      const arr = groups.get(key) ?? [];
      arr.push(child);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([runId, threads]) => ({ runId, threads }));
  }, [subThreads]);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        className={cn(
          'relative w-full rounded-xl px-2.5 py-2 text-left flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          selectedId === t.id ? 'bg-accent' : 'hover:bg-accent/70'
        )}
      >
        <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px]', threadStatusDot[t.status])} />

        {renamingId === t.id ? (
          <input
            className="flex-1 min-w-0 bg-muted rounded px-1.5 py-0.5 text-sm outline-none ring-1 ring-border"
            value={renameInput}
            autoFocus
            onChange={(e) => setRenameInput(e.target.value)}
            onBlur={() => commitRename(t)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(t);
              if (e.key === 'Escape') cancelRename();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 font-medium text-sm text-foreground truncate">{t.name}</span>
        )}

        {(t.queueDepth ?? 0) > 0 && (
          <span className="rounded bg-status-warning/15 px-1 py-0.5 text-xs font-semibold text-status-warning-foreground">
            +{t.queueDepth}
          </span>
        )}

        {(t.autopilotState === 'thinking' || t.autopilotState === 'sent') && (
          <Robot className="h-4 w-4 shrink-0 animate-pulse text-status-success" weight="fill" />
        )}

        {container?.exists && (
          <StatusDot
            status={container.orphaned || container.drift ? 'warning' : container.running ? 'success' : 'idle'}
            tooltip={containerTooltip(container)}
            className="shrink-0"
          />
        )}

        <HoverActions
          variant="inline"
          forceVisible={menuId === t.id}
          className="shrink-0 min-w-5"
          actions={
            <ThreadItemMenu
              thread={t}
              onOpenChange={(open) => setMenuId(open ? t.id : null)}
              onStop={() => stopThread(t.id)}
              onStartRename={() => startRename(t)}
              onArchive={() => archiveThread(t)}
            />
          }
        >
          <RelativeTime value={t.lastActiveAt} className="flex h-5 items-center" />
        </HoverActions>

        {hasSubThreads && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSubThreadsExpanded((v) => !v);
            }}
            className="shrink-0 flex items-center justify-center w-3 text-muted-foreground hover:text-foreground"
            aria-label={subThreadsExpanded ? 'Collapse sub-threads' : 'Expand sub-threads'}
            tabIndex={-1}
          >
            <CaretRight
              className={cn('h-3 w-3 transition-transform', subThreadsExpanded && 'rotate-90')}
              weight="bold"
            />
          </button>
        )}
      </div>

      {hasSubThreads && subThreadsExpanded && (
        <div className="ml-4 mt-px space-y-1">
          {subThreadGroups.map(({ runId, threads: groupThreads }) => {
            const prompt = runId ? councilPromptById.get(runId) : undefined;
            return (
              <div key={runId || 'ungrouped'}>
                {runId && (
                  <div className="px-2.5 py-0.5 text-xs text-muted-foreground/70 truncate">
                    {prompt ? (prompt.length > 50 ? prompt.slice(0, 50) + '…' : prompt) : runId}
                  </div>
                )}
                <div className="space-y-px">
                  {groupThreads.map((child) =>
                    runId ? (
                      <div
                        key={child.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedThread(child.id)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedThread(child.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          selectedId === child.id ? 'bg-accent' : 'hover:bg-accent/70'
                        )}
                      >
                        <span
                          className={cn(
                            'h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px]',
                            threadStatusDot[child.status]
                          )}
                        />
                        <span className="flex-1 min-w-0 text-muted-foreground truncate">{child.name}</span>
                        {(child.autopilotState === 'thinking' || child.autopilotState === 'sent') && (
                          <Robot className="h-3.5 w-3.5 shrink-0 animate-pulse text-status-success" weight="fill" />
                        )}
                      </div>
                    ) : (
                      <ThreadItem key={child.id} thread={child} />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
