import React from 'react';
import { ChartLine } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/status-badge';
import type { AutomationJob } from '../../../shared/types';
import { describeTrigger } from './scheduleUtils';
import { AutomationRunHistory } from '../insights/AutomationRunHistory';

interface Props {
  job: AutomationJob;
  historyOpen: boolean;
  onEdit: () => void;
  onToggleHistory: () => void;
}

export function AutomationJobRow({ job, historyOpen, onEdit, onToggleHistory }: Props) {
  return (
    <div>
      <div className="flex items-center gap-1 -mx-1.5 px-1.5 rounded-xl hover:bg-accent/70 transition-colors">
        <button
          type="button"
          onClick={onEdit}
          title="Edit automation"
          aria-label="Edit automation"
          className="flex items-center gap-3 py-2 text-left flex-1 min-w-0 h-auto justify-start font-normal px-0"
        >
          <StatusDot
            status={
              !job.enabled
                ? 'pending'
                : job.lastRunStatus === 'error'
                  ? 'error'
                  : job.lastRunStatus === 'ok'
                    ? 'success'
                    : 'idle'
            }
            tooltip={
              !job.enabled
                ? 'Disabled'
                : job.lastRunStatus === 'error'
                  ? 'Last run failed'
                  : job.lastRunStatus === 'ok'
                    ? 'Last run succeeded'
                    : 'Never run'
            }
            className="shrink-0"
          />

          <div className="flex items-baseline gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground truncate">{job.name}</span>
          </div>

          <span className="text-xs text-muted-foreground shrink-0">{describeTrigger(job.trigger)}</span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('shrink-0 h-6 w-6', historyOpen ? 'text-foreground bg-accent' : 'text-muted-foreground')}
          title="Run history"
          aria-label="Run history"
          onClick={onToggleHistory}
        >
          <ChartLine className="h-3.5 w-3.5" />
        </Button>
      </div>

      {historyOpen && (
        <div className="mb-1 rounded-lg border border-border/60 bg-muted/20">
          <AutomationRunHistory job={job} />
        </div>
      )}
    </div>
  );
}
