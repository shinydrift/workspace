import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryHealthReport } from '../../../shared/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';

interface Props {
  threadId: string;
}

function Badge({ count }: { count: number }) {
  return (
    <span
      className={cn(
        'ml-2 rounded px-1.5 py-0.5 text-xs font-medium',
        count === 0 ? statusColors.success.badge : statusColors.warning.badge
      )}
    >
      {count}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/30 transition-colors"
      >
        <span>
          {title}
          <Badge count={count} />
        </span>
        <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-border/60 px-4 py-3 space-y-2">{children}</div>}
    </div>
  );
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString();
}

export function MemoryHealthView({ threadId }: Props) {
  const [report, setReport] = useState<MemoryHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runHealthCheck = useCallback(() => {
    setLoading(true);
    setError(null);
    window.electronAPI.memory
      .healthCheck(threadId)
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [threadId]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const handleResetConfirm = () => {
    setConfirming(false);
    setResetting(true);
    setError(null);
    setSuccess(false);
    window.electronAPI.memory
      .reindex(threadId)
      .then(() => {
        setSuccess(true);
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setSuccess(false), 3000);
        runHealthCheck();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setResetting(false));
  };

  // Don't hide the panel behind a loading screen while a reset is in progress —
  // the button's own "Resetting…" label is sufficient feedback.
  if (loading && !resetting) {
    return <div className="p-6 text-sm text-muted-foreground">Running health checks…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-status-error">{error}</div>;
  }
  if (!report) return null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-end gap-2">
          {success && <span className="text-xs text-status-success">Reindexed</span>}
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">Clears all embeddings and re-indexes from scratch.</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleResetConfirm}
              >
                Confirm
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={resetting}
              onClick={() => setConfirming(true)}
            >
              {resetting ? 'Resetting…' : 'Reset & reindex'}
            </Button>
          )}
        </div>
        <Section title="Stale files" count={report.staleFiles.length}>
          {report.staleFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">All good — no stale files.</p>
          ) : (
            report.staleFiles.map((f) => (
              <div key={f.path} className="rounded border border-border/60 bg-muted/30 px-3 py-2">
                <div className="truncate text-xs font-medium">{f.path}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  indexed {fmtDate(f.indexedAt)} · modified {fmtDate(f.modifiedAt)}
                </div>
              </div>
            ))
          )}
        </Section>

        <Section title="Embedding gaps" count={report.unembeddedChunks.length}>
          {report.unembeddedChunks.length === 0 ? (
            <p className="text-xs text-muted-foreground">All good — no missing embeddings.</p>
          ) : (
            report.unembeddedChunks.map((c) => (
              <div key={c.id} className="rounded border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs font-medium">
                  {c.path}:{c.startLine}–{c.endLine}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{c.preview}</div>
              </div>
            ))
          )}
        </Section>

        <Section title="Duplicate chunks" count={report.duplicateGroups.length}>
          {report.duplicateGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">All good — no duplicates.</p>
          ) : (
            report.duplicateGroups.map((g) => (
              <div key={g.hash} className="rounded border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs font-medium">{g.count} chunks with identical content</div>
                <div className="mt-0.5 text-xs text-muted-foreground">sample: {g.samplePath}</div>
              </div>
            ))
          )}
        </Section>

        <Section title="Model mismatch" count={report.staleModelChunks}>
          {report.staleModelChunks === 0 ? (
            <p className="text-xs text-muted-foreground">All good — all chunks match the current embedding model.</p>
          ) : (
            <div className="rounded border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-xs font-medium">{report.staleModelChunks} chunks indexed with a different model</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                These chunks are invisible to vector search. Run a full reindex to fix.
              </div>
            </div>
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}
