import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleRow } from '@/components/ui/toggle-row';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../../shared/types';
import { ProviderModelBadges } from '../threads/ProviderModelBadges';
import { useSettings } from '../../contexts/SettingsContext';

export function AutopilotTab() {
  const { agents } = useSettings();

  const plannerOverridden = agents.autopilotPlannerProvider !== undefined || agents.autopilotPlannerModel !== undefined;

  return (
    <div className="space-y-2">
      <ToggleRow
        label="Enable Autopilot by default"
        description="New threads start with Autopilot on"
        checked={agents.autopilotEnabled}
        onCheckedChange={(v) => agents.setAutopilotEnabled(v)}
      />
      {agents.autopilotEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="autopilot-max-turns">Max Consecutive Auto-Turns</Label>
            <Input
              id="autopilot-max-turns"
              type="number"
              min={1}
              value={agents.autopilotMaxConsecutiveTurns}
              onChange={(e) =>
                agents.setAutopilotMaxConsecutiveTurns(
                  Number(e.target.value) || DEFAULT_AUTOPILOT_SETTINGS.maxConsecutiveTurns
                )
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="autopilot-transcript-messages">Planner Transcript Messages</Label>
            <Input
              id="autopilot-transcript-messages"
              type="number"
              min={1}
              value={agents.autopilotTranscriptMessages}
              onChange={(e) =>
                agents.setAutopilotTranscriptMessages(
                  Number(e.target.value) || DEFAULT_AUTOPILOT_SETTINGS.transcriptMessages
                )
              }
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label>Planner</Label>
          {plannerOverridden && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={() => {
                agents.setAutopilotPlannerProvider(undefined);
                agents.setAutopilotPlannerModel(undefined);
              }}
            >
              reset
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ProviderModelBadges
            provider={agents.autopilotPlannerProvider ?? 'claude'}
            model={agents.autopilotPlannerModel}
            onProviderChange={(p) => {
              agents.setAutopilotPlannerProvider(p);
              agents.setAutopilotPlannerModel(undefined);
            }}
            onModelChange={(m) => {
              if (!agents.autopilotPlannerProvider) {
                agents.setAutopilotPlannerProvider('claude');
              }
              agents.setAutopilotPlannerModel(m);
            }}
          />
          {!plannerOverridden && <span className="text-xs text-muted-foreground">same as thread</span>}
        </div>
      </div>
    </div>
  );
}
