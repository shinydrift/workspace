import React, { useCallback, useEffect, useRef } from 'react';
import { ContentCard } from '@/components/ui/content-card';
import { Textarea } from '@/components/ui/textarea';
import { useDragResize, DragHandle } from '../../hooks/useDragResize';
import type { AutomationJob, SavedProject } from '../../../shared/types';
import type { FormState } from './scheduleUtils';
import { computeNextRun } from './scheduleUtils';
import { RightPanel } from './RightPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { FlowBuilderHeader } from './FlowBuilderHeader';

// computeNextRun returns these status strings instead of a real time; keep them out of the header label.
const NON_TIME_NEXT_RUN = ['—', 'In the past', 'Not yet run', 'Pending'];

interface Props {
  editing: FormState;
  setEditing: React.Dispatch<React.SetStateAction<FormState | null>>;
  projects: SavedProject[];
  save: () => void;
  saveBusy: boolean;
  saveError: string | null;
  onBack: () => void;
  job?: AutomationJob;
  onRunNow?: () => void;
  onDelete?: () => void;
}

export function AutomationFlowBuilder({
  editing,
  setEditing,
  projects,
  save,
  saveBusy,
  saveError,
  onBack,
  job,
  onRunNow,
  onDelete,
}: Props) {
  const { width: panelWidth, handleMouseDown: panelMouseDown } = useDragResize({
    defaultWidth: 272,
    minWidth: 180,
    maxWidth: 440,
    storageKey: 'agentos:automationPanelWidth',
    direction: 'left',
  });

  const patch = useCallback(
    <K extends keyof FormState>(key: K, val: FormState[K]) => {
      setEditing((prev) => (prev ? { ...prev, [key]: val } : prev));
    },
    [setEditing]
  );

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const t = setTimeout(() => saveRef.current(), 800);
    return () => clearTimeout(t);
  }, [editing]);

  // Cron next-run can't be computed client-side, so only show the header label for `every`/`at` times.
  const computedNextRun =
    editing.triggerKind === 'schedule' && editing.enabled && editing.scheduleKind !== 'cron'
      ? computeNextRun(editing, job)
      : null;
  const nextRunLabel = computedNextRun && !NON_TIME_NEXT_RUN.includes(computedNextRun) ? computedNextRun : null;

  return (
    <ContentCard>
      <FlowBuilderHeader
        name={editing.name}
        enabled={editing.enabled}
        saveBusy={saveBusy}
        saveError={saveError}
        nextRunLabel={nextRunLabel}
        onBack={onBack}
        onNameChange={(name) => patch('name', name)}
        onToggleEnabled={() => patch('enabled', !editing.enabled)}
        onRunNow={onRunNow}
        onDelete={onDelete}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="relative flex-1 min-h-0">
          <ScrollFade />
          <ScrollArea className="h-full">
            <div className="flex flex-col px-12 py-8 relative">
              <Textarea
                value={editing.instructions}
                onChange={(e) => patch('instructions', e.target.value)}
                placeholder="Add prompt e.g. look for crashes in $sentry"
                className="w-full border-none bg-transparent shadow-none focus-visible:ring-0 rounded-none resize-none text-sm leading-relaxed min-h-[300px] px-0 py-0"
              />
            </div>
          </ScrollArea>
        </div>

        <ScrollArea className="shrink-0 border-l border-border bg-background" style={{ width: panelWidth }}>
          <DragHandle onMouseDown={panelMouseDown} direction="left" />
          <RightPanel editing={editing} patch={patch} job={job} projects={projects} />
        </ScrollArea>
      </div>
    </ContentCard>
  );
}
