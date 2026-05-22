import React, { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import type { AutomationJob, SavedProject } from '../../../shared/types';
import type { FormState } from './scheduleUtils';
import { triggerLabel, computeNextRun } from './scheduleUtils';
import { AutomationRunHistory } from '../insights/AutomationRunHistory';
import { ScheduleFields } from './ScheduleFields';
import { SectionHeader, PropertyRow, InlineSelect, timeAgo } from './RightPanelHelpers';
import { useSlackChannelData } from '../../hooks/useSlackChannelData';

interface Props {
  editing: FormState;
  patch: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  job?: AutomationJob;
  projects: SavedProject[];
}

export function RightPanel({ editing, patch, job, projects }: Props) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { slackChannels } = useSlackChannelData(editing.projectId);
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent" />
      <ScrollArea className="h-full">
        <div className="flex flex-col divide-y divide-border">
          {job && (
            <section className="px-4 py-3 space-y-1.5">
              <SectionHeader>Status</SectionHeader>
              <PropertyRow label="Status">
                {editing.enabled ? (
                  <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                    Disabled
                  </span>
                )}
              </PropertyRow>
              <PropertyRow label="Next run">
                <span className="text-sm text-right">{computeNextRun(editing, job)}</span>
              </PropertyRow>
              {job.lastRunAt && (
                <PropertyRow label="Last ran">
                  <span className="text-sm">{timeAgo(job.lastRunAt)}</span>
                </PropertyRow>
              )}
              {!job.lastRunAt && (
                <PropertyRow label="Last ran">
                  <span className="text-sm text-muted-foreground">—</span>
                </PropertyRow>
              )}
            </section>
          )}

          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Details</SectionHeader>
            <PropertyRow label="Folder">
              {projectOptions.length > 0 ? (
                <InlineSelect
                  value={editing.projectId}
                  onChange={(v) => patch('projectId', v)}
                  options={projectOptions}
                />
              ) : (
                <span className="text-sm text-muted-foreground">No projects</span>
              )}
            </PropertyRow>
            <PropertyRow label="Repeats">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setScheduleOpen((o) => !o)}
                className="h-auto gap-1 px-0 py-0 text-sm text-foreground/80 hover:bg-transparent hover:text-foreground"
              >
                <span className="max-w-[140px] truncate text-right">{triggerLabel(editing)}</span>
                <CaretDown
                  className={`h-3 w-3 text-muted-foreground transition-transform ${scheduleOpen ? 'rotate-180' : ''}`}
                />
              </Button>
            </PropertyRow>
            {scheduleOpen && (
              <div className="pl-0">
                <ScheduleFields editing={editing} patch={patch} />
              </div>
            )}
            {slackChannels.length > 0 && (
              <PropertyRow label="Channel">
                <InlineSelect
                  value={editing.notificationSlackChannelId !== '' ? editing.notificationSlackChannelId : '__none__'}
                  onChange={(v) => {
                    const id = v === '__none__' ? '' : v;
                    patch('notificationChannel', id ? 'slack' : 'none');
                    patch('notificationSlackChannelId', id);
                  }}
                  options={[
                    { value: '__none__', label: 'None' },
                    ...slackChannels.map((c) => ({ value: c.id, label: `#${c.name}` })),
                  ]}
                />
              </PropertyRow>
            )}
            {editing.notificationChannel === 'slack' && (
              <PropertyRow label="Notify on failure">
                <Switch checked={editing.notifyOnFailure} onCheckedChange={(v) => patch('notifyOnFailure', v)} />
              </PropertyRow>
            )}
            <PropertyRow label="Delete after run">
              <Switch checked={editing.deleteAfterRun} onCheckedChange={(v) => patch('deleteAfterRun', v)} />
            </PropertyRow>
          </section>

          {job && <AutomationRunHistory job={job} />}
        </div>
      </ScrollArea>
    </div>
  );
}
