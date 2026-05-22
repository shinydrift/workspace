import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SectionHeader } from './SectionHeader';
import { InheritHint } from './InheritHint';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../../../shared/types';
import type { AppSettings, Provider, ProviderEntry } from '../../../../shared/types';
import { ProviderModelBadges } from '../../threads/ProviderModelBadges';

// Matches ProjectConfig['agents'] — full shape needed so spread-patching preserves non-autopilot fields
interface AgentsConfig {
  providerOrder?: ProviderEntry[];
  queueSilenceFallbackMs?: number;
  autopilotMaxConsecutiveTurns?: number;
  autopilotTranscriptMessages?: number;
  autopilotPlannerProvider?: Provider;
  autopilotPlannerModel?: string;
}

interface Props {
  agents: AgentsConfig;
  appSettings: AppSettings | null;
  savingKey: string | null;
  onAgentsPatch: (patch: AgentsConfig) => void;
}

export function AutopilotSection({ agents, appSettings, savingKey, onAgentsPatch }: Props) {
  const appAutopilotTurns =
    appSettings?.autopilot?.maxConsecutiveTurns ?? DEFAULT_AUTOPILOT_SETTINGS.maxConsecutiveTurns;
  const appAutopilotTranscript =
    appSettings?.autopilot?.transcriptMessages ?? DEFAULT_AUTOPILOT_SETTINGS.transcriptMessages;

  const turnsOverridden = agents.autopilotMaxConsecutiveTurns !== undefined;
  const transcriptOverridden = agents.autopilotTranscriptMessages !== undefined;
  const plannerProviderOverridden = agents.autopilotPlannerProvider !== undefined;
  const plannerModelOverridden = agents.autopilotPlannerModel !== undefined;

  const effectivePlannerProvider = agents.autopilotPlannerProvider ?? appSettings?.autopilot?.plannerProvider;

  return (
    <>
      <SectionHeader title="Autopilot" description="Per-project autopilot overrides." />

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="proj-ap-turns">Max Consecutive Auto-Turns</Label>
              {turnsOverridden && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                  onClick={() => onAgentsPatch({ ...agents, autopilotMaxConsecutiveTurns: undefined })}
                >
                  reset
                </Button>
              )}
            </div>
            <Input
              id="proj-ap-turns"
              type="number"
              min={1}
              value={agents.autopilotMaxConsecutiveTurns ?? appAutopilotTurns}
              onChange={(e) =>
                onAgentsPatch({ ...agents, autopilotMaxConsecutiveTurns: Number(e.target.value) || appAutopilotTurns })
              }
            />
            <InheritHint show={!turnsOverridden} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="proj-ap-transcript">Planner Transcript Messages</Label>
              {transcriptOverridden && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                  onClick={() => onAgentsPatch({ ...agents, autopilotTranscriptMessages: undefined })}
                >
                  reset
                </Button>
              )}
            </div>
            <Input
              id="proj-ap-transcript"
              type="number"
              min={1}
              value={agents.autopilotTranscriptMessages ?? appAutopilotTranscript}
              onChange={(e) =>
                onAgentsPatch({
                  ...agents,
                  autopilotTranscriptMessages: Number(e.target.value) || appAutopilotTranscript,
                })
              }
            />
            <InheritHint show={!transcriptOverridden} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label>Planner</Label>
            {(plannerProviderOverridden || plannerModelOverridden) && (
              <Button
                type="button"
                variant="ghost"
                className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                onClick={() =>
                  onAgentsPatch({ ...agents, autopilotPlannerProvider: undefined, autopilotPlannerModel: undefined })
                }
              >
                reset
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <ProviderModelBadges
              provider={effectivePlannerProvider ?? 'claude'}
              model={agents.autopilotPlannerModel}
              onProviderChange={(p) =>
                onAgentsPatch({ ...agents, autopilotPlannerProvider: p, autopilotPlannerModel: undefined })
              }
              onModelChange={(m) =>
                onAgentsPatch({
                  ...agents,
                  autopilotPlannerProvider: agents.autopilotPlannerProvider ?? effectivePlannerProvider ?? 'claude',
                  autopilotPlannerModel: m,
                })
              }
            />
            {!plannerProviderOverridden && !plannerModelOverridden && (
              <span className="text-xs text-muted-foreground">app default</span>
            )}
          </div>
        </div>
      </div>

      {savingKey === 'agents' && <p className="text-xs text-muted-foreground">Saving…</p>}
    </>
  );
}
