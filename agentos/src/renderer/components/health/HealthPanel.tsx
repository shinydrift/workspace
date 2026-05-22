import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import type { HealthCheck, HealthReport } from '../../../shared/types';
import { cn } from '@/lib/utils';
import { statusColors } from '@/lib/status-colors';

function StatusDot({ status }: { status: HealthCheck['status'] }) {
  const color =
    status === 'ok' ? statusColors.success.dot : status === 'warn' ? statusColors.warning.dot : statusColors.error.dot;
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0 mt-1', color)} />;
}

export function HealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const result = await window.electronAPI.health.run();
      setReport(result);
    } finally {
      setRunning(false);
    }
  }, []);

  const summary = report
    ? report.checks.reduce(
        (acc, c) => {
          acc[c.status]++;
          return acc;
        },
        { ok: 0, warn: 0, error: 0 } as Record<HealthCheck['status'], number>
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Run a health check across all AgentOS subsystems.</p>
          {report && (
            <p className="text-xs text-muted-foreground mt-1">
              Last run: {new Date(report.ranAt).toLocaleTimeString()}
              {' · '}
              <span className="text-status-success-foreground">{summary!.ok} ok</span>
              {summary!.warn > 0 && <span className="text-status-warning-foreground"> · {summary!.warn} warn</span>}
              {summary!.error > 0 && <span className="text-status-error"> · {summary!.error} error</span>}
            </p>
          )}
        </div>
        <Button onClick={run} disabled={running} size="sm">
          {running ? 'Running…' : 'Run Health Check'}
        </Button>
      </div>

      {report && (
        <div className="space-y-1">
          {report.checks.map((check) => (
            <div key={check.id} className="flex gap-3 py-2 border-b border-border last:border-0">
              <StatusDot status={check.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">{check.label}</p>
                {check.message && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate" title={check.message}>
                    {check.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!report && !running && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Click "Run Health Check" to check system health.
        </p>
      )}
    </div>
  );
}
