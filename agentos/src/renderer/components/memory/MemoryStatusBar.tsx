import React from 'react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';
import type { MemoryDoctorResult, MemoryIndexStatus } from '../../../shared/types';

interface Props {
  status: MemoryIndexStatus;
  builtAtLabel: string;
  doctor: MemoryDoctorResult;
  busy: string | null;
  error: string | null;
  saveMessage: string | null;
  onRefresh: () => void;
}

export function MemoryStatusBar({ status, builtAtLabel, doctor, busy, error, saveMessage, onRefresh }: Props) {
  return (
    <div className="border-b border-border/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {status.memoryFileCount} memory files
        </div>
        <div className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {status.sessionFileCount} session logs
        </div>
        <div className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {status.entryCount} indexed entries
        </div>
        <div className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          semantic: {status.embeddingProvider ? `${status.embeddingProvider}/${status.embeddingModel}` : 'off'}
        </div>
        <div className="text-xs text-muted-foreground">Last build: {builtAtLabel}</div>
        <div
          className={cn(
            'rounded px-2 py-1 text-xs',
            doctor.ok ? statusColors.success.badge : statusColors.warning.badge
          )}
        >
          doctor: {doctor.ok ? 'ok' : 'attention'}
        </div>
        <Button type="button" variant="outline" className="h-8" onClick={onRefresh} disabled={busy !== null}>
          Reindex
        </Button>
      </div>
      {error && <div className="mt-2 text-xs text-status-error">{error}</div>}
      {saveMessage && <div className="mt-2 text-xs text-status-success-foreground">{saveMessage}</div>}
      {doctor.issues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {doctor.issues.map((issue) => (
            <div
              key={issue}
              className="rounded border border-status-warning bg-status-warning-muted px-2 py-1 text-xs text-status-warning-foreground"
            >
              {issue}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
