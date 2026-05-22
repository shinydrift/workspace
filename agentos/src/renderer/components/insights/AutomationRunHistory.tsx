import React, { useEffect, useState } from 'react';
import type { AutomationJob } from '../../../shared/types';
import { useInsightsStore } from '../../store/insightsStore';
import { formatCost, formatDuration, formatTimestamp } from '../../lib/analyticsFormatters';
import { CheckCircle, XCircle, MinusCircle } from '@phosphor-icons/react';
import { List, ListItem } from '@/components/ui/list';
import { Button } from '@/components/ui/button';

interface Props {
  job: AutomationJob;
}

const PAGE_SIZE = 20;
const MAX_LIMIT = 500;

export function AutomationRunHistory({ job }: Props) {
  const { automationRuns, setAutomationRuns } = useInsightsStore();
  const runs = automationRuns[job.id] ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.analytics
      .getAutomationRuns(job.id, limit)
      .then((r) => {
        if (!cancelled) {
          setAutomationRuns(job.id, r);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to load automation run history', err);
        if (!cancelled) {
          setError('Failed to load run history');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, limit, setAutomationRuns]);

  return (
    <div className="px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground mb-2">Run History</p>

      {loading && runs === null && <p className="text-xs text-muted-foreground py-2">Loading…</p>}

      {error && <p className="text-xs text-destructive py-2">{error}</p>}

      {!loading && !error && (runs === null || runs.length === 0) && (
        <p className="text-xs text-muted-foreground py-2">No runs recorded yet.</p>
      )}

      {runs && runs.length > 0 && (
        <List>
          {runs.map((run) => {
            const dur = run.completedAt != null ? formatDuration(run.completedAt - run.startedAt) : '—';
            return (
              <ListItem key={run.id} className="gap-3">
                <StatusIcon status={run.status} />
                <span className="flex-1 text-foreground">{formatTimestamp(run.startedAt)}</span>
                <div className="flex items-center gap-3 tabular-nums text-muted-foreground shrink-0">
                  <span>{formatCost(run.costUsdMicro)}</span>
                  <span>{run.turnCount} turns</span>
                  <span>{dur}</span>
                </div>
              </ListItem>
            );
          })}
        </List>
      )}

      {runs && runs.length >= limit && limit < MAX_LIMIT && (
        <Button
          type="button"
          variant="ghost"
          className="mt-2 h-auto p-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors"
          onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: 'ok' | 'error' | 'skipped' }) {
  if (status === 'ok') return <CheckCircle className="h-3.5 w-3.5 text-status-success" weight="fill" />;
  if (status === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive" weight="fill" />;
  return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" weight="fill" />;
}
