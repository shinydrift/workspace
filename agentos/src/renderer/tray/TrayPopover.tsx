import React, { useEffect, useLayoutEffect, useState } from 'react';
import type { TrayThread, ThreadStatus } from '../../shared/types';
import { AgentOSLogo } from '../components/ui/agentos-logo';
import { LogoTextAnimation } from '../components/ui/logo-text-animation';
import { ScrollArea } from '@/components/ui/scroll-area';

function formatTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 5000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

const STATUS_DOT: Record<ThreadStatus, string> = {
  running: 'bg-blue-500',
  idle: 'bg-zinc-400',
  error: 'bg-status-error',
  building: 'bg-orange-400',
  stopped: 'bg-zinc-500',
  archived: 'bg-zinc-600',
};

function statusLabel(t: TrayThread): string {
  if (t.autopilotEnabled && t.status !== 'error') return 'autopilot';
  return t.status;
}

export function TrayPopover() {
  const [threads, setThreads] = useState<TrayThread[]>([]);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.classList.toggle('dark', mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const off = window.electronAPI?.on.trayThreadsUpdate((data) => setThreads(data));
    return () => off?.();
  }, []);

  const running = threads.filter((t) => t.status === 'running').length;
  const isActive = threads.some((t) => t.status === 'running' || t.status === 'building');

  return (
    <div className="flex h-screen flex-col text-sm select-none rounded-xl overflow-hidden backdrop-blur-xl shadow-2xl bg-white/90 text-zinc-900 ring-1 ring-black/10 dark:bg-zinc-900/90 dark:text-zinc-100 dark:ring-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        {isActive ? <LogoTextAnimation className="h-4 w-auto" /> : <AgentOSLogo className="h-4 w-auto" />}
        <div className="flex gap-1">
          <button
            onClick={() => window.electronAPI?.tray.openApp()}
            className="px-2 py-0.5 rounded text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
          >
            Open
          </button>
          <button
            onClick={() => window.electronAPI?.tray.quitApp()}
            className="px-2 py-0.5 rounded text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
          >
            Quit
          </button>
        </div>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1">
        {threads.length === 0 ? (
          <div className="px-3 py-4 text-zinc-400 dark:text-zinc-500 text-xs">No active threads</div>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              onClick={() => window.electronAPI?.tray.focusThread(t.id)}
              className="w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[t.status]}`} />
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-100 max-w-[140px]">{t.name}</span>
                <span className="ml-auto text-zinc-400 dark:text-zinc-500 text-xs shrink-0">{statusLabel(t)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 pl-4">
                <span className="text-zinc-400 dark:text-zinc-500 text-xs truncate max-w-[120px]">{t.projectName}</span>
                <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
                <span className="text-zinc-300 dark:text-zinc-600 text-xs shrink-0">
                  {formatTimeAgo(t.lastActiveAt)}
                </span>
              </div>
              {t.lastMessage && <div className="mt-0.5 pl-4 text-zinc-400 text-xs truncate">{t.lastMessage}</div>}
            </button>
          ))
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 text-xs">
        {threads.length} thread{threads.length !== 1 ? 's' : ''}
        {running > 0 && ` · ${running} running`}
      </div>
    </div>
  );
}
