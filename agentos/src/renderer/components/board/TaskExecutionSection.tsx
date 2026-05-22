import React, { useEffect, useState } from 'react';
import { Wrench, Timer } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Thread } from '../../../shared/types';

interface Props {
  thread: Thread;
}

type ExecStatus = 'queued' | 'starting' | 'working' | 'idle' | 'error' | 'stopped';

function getExecStatus(thread: Thread): ExecStatus {
  if (thread.status === 'building') return 'starting';
  if (thread.status === 'running') return 'working';
  if (thread.status === 'error') return 'error';
  if (thread.status === 'stopped') return 'stopped';
  if ((thread.queueDepth ?? 0) > 0) return 'queued';
  return 'idle';
}

const STATUS_LABEL: Record<ExecStatus, string> = {
  queued: 'Queued',
  starting: 'Starting',
  working: 'Working',
  idle: 'Idle',
  error: 'Error',
  stopped: 'Stopped',
};

const STATUS_DOT: Record<ExecStatus, string> = {
  queued: 'bg-blue-400',
  starting: 'bg-yellow-400 animate-pulse',
  working: 'bg-green-400 animate-pulse',
  idle: 'bg-muted-foreground/40',
  error: 'bg-red-500',
  stopped: 'bg-muted-foreground/40',
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

export function TaskExecutionSection({ thread }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [toolCount, setToolCount] = useState<number | null>(null);

  const status = getExecStatus(thread);
  const isActive = status === 'working' || status === 'starting';

  // Live elapsed timer while session is active
  useEffect(() => {
    if (!isActive) return;
    setNow(Date.now()); // reset immediately so elapsed never shows negative on restart
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Fetch session-scoped tool count on mount and on every status change
  useEffect(() => {
    let cancelled = false;
    async function fetchToolCount() {
      try {
        const breakdown = await window.electronAPI.analytics.getToolBreakdown(thread.id, thread.sessionStartedAt);
        if (!cancelled) setToolCount(breakdown.reduce((acc, t) => acc + t.count, 0));
      } catch {
        // non-critical, leave as null
      }
    }
    void fetchToolCount();
    return () => {
      cancelled = true;
    };
  }, [thread.id, thread.status, thread.sessionStartedAt]);

  const elapsed = thread.sessionStartedAt && isActive ? now - thread.sessionStartedAt : null;

  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Execution</p>
      <div className="space-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2.5">
        {/* Status row */}
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[status])} />
          <span className="text-xs font-medium text-foreground/85">{STATUS_LABEL[status]}</span>
        </div>

        {/* Elapsed + tool count — shown when there's data */}
        {(elapsed !== null || toolCount !== null) && (
          <div className="flex items-center gap-4 pl-4">
            {elapsed !== null && (
              <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                <Timer size={11} className="shrink-0" />
                {formatElapsed(elapsed)}
              </span>
            )}
            {toolCount !== null && toolCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                <Wrench size={11} className="shrink-0" />
                {toolCount} tool {toolCount === 1 ? 'call' : 'calls'}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
