import React, { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import type { AutomationJob, SavedProject } from '../../../shared/types';
import { getEffectivePrimaryProviderEntry } from '../../../shared/effectiveProjectSettings';
import type { FormState } from './scheduleUtils';
import { triggerLabel, humanizeCron } from './scheduleUtils';
import { AutomationRunHistory } from '../insights/AutomationRunHistory';
import { ProviderModelBadges } from '../threads/ProviderModelBadges';
import { ScheduleFields } from './ScheduleFields';
import { SectionHeader, PropertyRow, InlineSelect } from './RightPanelHelpers';
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
  const cronDescription =
    editing.triggerKind === 'schedule' && editing.scheduleKind === 'cron' ? humanizeCron(editing.cronExpr) : null;

  // Clear the pinned model tuple (used on un-pin and on provider change) so a value never
  // outlives the provider it applied to.
  const clearModelFields = () => {
    patch('model', undefined);
    patch('effort', undefined);
    patch('reasoning', undefined);
  };

  // Turning the pin on seeds it from this project's effective default rather than a hardcoded
  // provider, so "use a specific model" starts as "whatever this project runs by default".
  const enableModelPin = async () => {
    try {
      const project = projects.find((p) => p.id === editing.projectId);
      const [settings, lookup] = await Promise.all([
        window.electronAPI.settings.get(),
        project ? window.electronAPI.project.getConfig(project.path).catch((): null => null) : Promise.resolve(null),
      ]);
      const primary = getEffectivePrimaryProviderEntry(settings, lookup?.config ?? null);
      patch('provider', primary.provider);
      patch('model', primary.model);
      patch('effort', primary.effort);
      patch('reasoning', primary.reasoning);
    } catch {
      patch('provider', 'claude');
    }
  };

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent" />
      <ScrollArea className="h-full">
        <div className="flex flex-col divide-y divide-border">
          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Project</SectionHeader>
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
          </section>

          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Repeats</SectionHeader>
            <PropertyRow label="Schedule">
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
            {cronDescription && <p className="text-xs text-muted-foreground leading-relaxed">{cronDescription}</p>}
            {scheduleOpen && (
              <div className="pl-0">
                <ScheduleFields editing={editing} patch={patch} />
              </div>
            )}
          </section>

          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Model</SectionHeader>
            <PropertyRow label="Use specific model">
              <Switch
                checked={editing.provider !== undefined}
                onCheckedChange={(v) => {
                  if (v) {
                    void enableModelPin();
                  } else {
                    patch('provider', undefined);
                    clearModelFields();
                  }
                }}
              />
            </PropertyRow>
            {editing.provider !== undefined ? (
              <ProviderModelBadges
                provider={editing.provider}
                model={editing.model}
                effort={editing.effort}
                reasoning={editing.reasoning}
                onProviderChange={(p) => {
                  patch('provider', p);
                  clearModelFields();
                }}
                onModelChange={(m) => patch('model', m)}
                onEffortChange={(e) => patch('effort', e)}
                onReasoningChange={(r) => patch('reasoning', r)}
              />
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Inherits the project / app default each time it runs.
              </p>
            )}
          </section>

          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Channel</SectionHeader>
            {slackChannels.length > 0 ? (
              <PropertyRow label="Notify">
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
            ) : (
              <PropertyRow label="Notify">
                <span className="text-sm text-muted-foreground">No channels</span>
              </PropertyRow>
            )}
            {editing.notificationChannel === 'slack' && (
              <PropertyRow label="Notify on failure">
                <Switch checked={editing.notifyOnFailure} onCheckedChange={(v) => patch('notifyOnFailure', v)} />
              </PropertyRow>
            )}
          </section>

          <section className="px-4 py-3 space-y-1.5">
            <SectionHeader>Options</SectionHeader>
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
