import React, { useMemo, useState } from 'react';
import type { LogLevel } from '../../../shared/types';
import { useLogsStore } from '../../store/logsStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useSettings } from '../../contexts/SettingsContext';

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string }> = {
  debug: { label: 'DBG', color: 'text-muted-foreground' },
  info: { label: 'INF', color: 'text-foreground' },
  warn: { label: 'WRN', color: 'text-amber-500' },
  error: { label: 'ERR', color: 'text-destructive' },
};

export function LogsTab() {
  const { logs, clearLogs } = useLogsStore();
  const { agents } = useSettings();
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [subsystemFilter, setSubsystemFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const subsystems = useMemo(() => ['all', ...new Set(logs.map((l) => l.subsystem))], [logs]);

  const filtered = useMemo(() => {
    const result = logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (subsystemFilter !== 'all' && entry.subsystem !== subsystemFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!entry.message.toLowerCase().includes(q) && !entry.subsystem.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    result.reverse();
    return result;
  }, [logs, levelFilter, subsystemFilter, searchQuery]);

  return (
    <div className="flex flex-col h-full" onChange={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <div className="relative flex-1">
          <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search logs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 pr-2 text-xs"
          />
        </div>
        <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel | 'all')}>
          <SelectTrigger className="h-7 w-auto px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>
        <Select value={subsystemFilter} onValueChange={setSubsystemFilter}>
          <SelectTrigger className="h-7 w-auto px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {subsystems.map((subsystem) => (
              <SelectItem key={subsystem} value={subsystem}>
                {subsystem}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent whitespace-nowrap"
          onClick={clearLogs}
        >
          Clear
        </Button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap shrink-0">
          Retain
          <Input
            type="number"
            min={1}
            max={365}
            value={agents.logRetentionDays}
            onChange={(e) =>
              agents.setLogRetentionDays(Math.min(365, Math.max(1, Math.floor(Number(e.target.value) || 1))))
            }
            className="h-7 w-14 px-1.5 text-xs text-center"
          />
          days
        </label>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 font-mono text-xs">
          <div className="space-y-0.5">
            {filtered.map((entry) => (
              <div key={entry.id}>
                <div
                  className={cn('flex gap-2 rounded px-1 -mx-1', entry.meta && 'cursor-pointer hover:bg-accent/30')}
                  onClick={() => entry.meta && setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <span className="shrink-0 text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span className={cn('shrink-0', LEVEL_CONFIG[entry.level].color)}>
                    {LEVEL_CONFIG[entry.level].label}
                  </span>
                  <span className="shrink-0 text-blue-400">[{entry.subsystem}]</span>
                  <span className="break-all">{entry.message}</span>
                  {entry.meta && (
                    <span className="shrink-0 text-muted-foreground/50 ml-auto">
                      {expandedId === entry.id ? '▾' : '▸'}
                    </span>
                  )}
                </div>
                {expandedId === entry.id && entry.meta && (
                  <pre className="ml-4 mt-0.5 mb-1 rounded bg-muted/40 p-1.5 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(entry.meta, null, 2)}
                  </pre>
                )}
              </div>
            ))}
            {filtered.length === 0 && <div className="py-3 text-center text-muted-foreground">No log entries</div>}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
