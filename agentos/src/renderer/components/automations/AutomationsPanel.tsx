import React, { useMemo, useState } from 'react';
import type { AutomationJob } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { ContentCard } from '@/components/ui/content-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PanelHeader } from '@/components/ui/panel-header';
import { useAutomations } from '../../hooks/useAutomations';
import { AutomationFlowBuilder } from './AutomationFlowBuilder';
import { AutomationJobRow } from './AutomationJobRow';
import { Plus } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';

interface Props {
  open: boolean;
  jobs: AutomationJob[];
  onJobsChange: (jobs: AutomationJob[]) => void;
}

export function AutomationsPanel({ open, jobs, onJobsChange }: Props) {
  const { listOp, saveOp, editing, setEditing, projects, save, runNow, remove, startNew, fromJob } = useAutomations(
    open,
    jobs,
    onJobsChange
  );
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<AutomationJob | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; jobs: AutomationJob[] }>();
    for (const job of jobs) {
      const key = job.projectId || '';
      if (!map.has(key)) {
        const name = job.projectId ? (projects.find((p) => p.id === job.projectId)?.name ?? job.projectId) : 'AgentOS';
        map.set(key, { name, jobs: [] });
      }
      map.get(key)!.jobs.push(job);
    }
    return [...map.values()];
  }, [jobs, projects]);

  if (!open) return null;

  // ── Builder view ─────────────────────────────────────────────────────────────
  if (editing) {
    const existingJob = editing.id ? jobs.find((j) => j.id === editing.id) : undefined;

    return (
      <>
        <AutomationFlowBuilder
          editing={editing}
          setEditing={setEditing}
          projects={projects}
          save={save}
          saveBusy={saveOp.busy}
          saveError={saveOp.error ?? listOp.error}
          onBack={() => setEditing(null)}
          job={existingJob}
          onRunNow={existingJob ? () => runNow(existingJob) : undefined}
          onDelete={existingJob ? () => setConfirmDeleteJob(existingJob) : undefined}
        />
        <ConfirmDialog
          open={confirmDeleteJob !== null}
          title={`Delete "${confirmDeleteJob?.name}"?`}
          description="This automation will be permanently deleted."
          confirmLabel="Delete"
          onConfirm={() => {
            const job = confirmDeleteJob;
            setConfirmDeleteJob(null);
            if (job) void remove(job).then(() => setEditing(null));
          }}
          onCancel={() => setConfirmDeleteJob(null)}
        />
      </>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <ContentCard className="relative">
      <PanelHeader
        title="Automations"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={startNew}
            title="New automation"
            aria-label="New automation"
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
      />

      <div className="max-w-[1200px] w-full mx-auto flex-1 min-h-0 flex flex-col">
        {listOp.error && (
          <div className="mx-3 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {listOp.error}
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <ScrollFade />
          <ScrollArea className="h-full">
            <div className="px-3 pb-4">
              {listOp.busy && <p className="text-sm text-muted-foreground py-3">Loading…</p>}

              {!listOp.busy && jobs.length === 0 && (
                <div className="py-12 flex flex-col items-center text-center gap-3">
                  <div className="text-sm text-muted-foreground">No automations yet.</div>
                  <Button type="button" size="sm" onClick={startNew}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    New automation
                  </Button>
                </div>
              )}

              {groups.length > 0 &&
                groups.map((group) => (
                  <div key={group.name}>
                    <div className="text-xs font-medium text-muted-foreground pt-3 pb-1">{group.name}</div>
                    <div className="divide-y divide-border/60">
                      {group.jobs.map((job) => (
                        <AutomationJobRow
                          key={job.id}
                          job={job}
                          historyOpen={historyJobId === job.id}
                          onEdit={() => setEditing(fromJob(job))}
                          onToggleHistory={() => setHistoryJobId((prev) => (prev === job.id ? null : job.id))}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </ContentCard>
  );
}
