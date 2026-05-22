import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { BigFiveSliders } from '../../settings/BigFiveSliders';
import {
  CUSTOM_PRESET_ID,
  DEFAULT_PERSONALITY_SETTINGS,
  DEFAULT_PRESET_ID,
  PERSONA_PRESETS,
  personalityRefreshJobId,
  getPreset,
  type BigFiveTraits,
  type PersonalitySettings,
} from '../../../../shared/types';

const FALLBACK_TRAITS: BigFiveTraits = {
  openness: 3,
  conscientiousness: 3,
  extraversion: 3,
  agreeableness: 3,
  neuroticism: 3,
};

interface Props {
  projectId: string;
  personality: PersonalitySettings | undefined;
  savingKey: string | null;
  onPatch: (patch: PersonalitySettings | undefined) => void;
}

export function PersonalitySection({ projectId, personality, savingKey, onPatch }: Props) {
  const enabled = personality !== undefined;
  const effective = personality ?? DEFAULT_PERSONALITY_SETTINGS;

  const [agentStyle, setAgentStyle] = useState(effective.agentStyle ?? '');
  const [autopilotInstructions, setAutopilotInstructions] = useState(effective.autopilotInstructions ?? '');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleRefreshNow() {
    if (!projectId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await window.electronAPI.automation.run(personalityRefreshJobId(projectId));
      if (!result.ok) {
        console.error('Personality refresh failed:', result.error);
        setRefreshError(result.error ?? 'Refresh failed');
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setAgentStyle(effective.agentStyle ?? '');
  }, [effective.agentStyle]);

  useEffect(() => {
    setAutopilotInstructions(effective.autopilotInstructions ?? '');
  }, [effective.autopilotInstructions]);

  const currentTraits =
    effective.bigFive ?? getPreset(effective.activePresetId ?? DEFAULT_PRESET_ID)?.traits ?? FALLBACK_TRAITS;

  function patch(partial: Partial<PersonalitySettings>) {
    onPatch({ ...effective, ...partial });
  }

  function selectPreset(presetId: string) {
    if (presetId === effective.activePresetId) return;
    if (presetId === CUSTOM_PRESET_ID) {
      patch({ activePresetId: presetId, bigFive: currentTraits });
    } else {
      const preset = getPreset(presetId);
      patch({
        activePresetId: presetId,
        bigFive: preset?.traits && presetId !== DEFAULT_PRESET_ID ? preset.traits : undefined,
      });
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <SectionHeader title="Personality" description="Configure personality emulation for this project." />
        {enabled && projectId && (
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void handleRefreshNow()}
              className="shrink-0 text-xs"
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
            {refreshError && <p className="text-xs text-destructive">{refreshError}</p>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            id="proj-personality-enabled"
            checked={enabled}
            onCheckedChange={(checked) => onPatch(checked === true ? DEFAULT_PERSONALITY_SETTINGS : undefined)}
          />
          <Label htmlFor="proj-personality-enabled" className="text-sm cursor-pointer select-none">
            Enable personality emulation for this project
          </Label>
        </div>

        {enabled && (
          <>
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Preset</div>
              <div className="flex flex-wrap gap-1.5">
                {PERSONA_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    title={preset.description}
                    onClick={() => selectPreset(preset.id)}
                    className={cn(
                      'h-auto px-2.5 py-1 text-xs',
                      effective.activePresetId === preset.id
                        ? 'border-foreground/60 bg-foreground/10 text-foreground hover:bg-foreground/10 hover:text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                    )}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <BigFiveSliders
              traits={currentTraits}
              disabled={effective.activePresetId !== CUSTOM_PRESET_ID}
              onChange={(t) => patch({ bigFive: t })}
            />

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Agent Style</div>
              <Textarea
                value={agentStyle}
                onChange={(e) => {
                  setAgentStyle(e.target.value);
                  patch({ agentStyle: e.target.value });
                }}
                rows={8}
                placeholder="No personality profile saved yet."
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Autopilot Instructions</div>
              <Textarea
                value={autopilotInstructions}
                onChange={(e) => {
                  setAutopilotInstructions(e.target.value);
                  patch({ autopilotInstructions: e.target.value });
                }}
                rows={4}
                placeholder="How to compose messages on your behalf."
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
          </>
        )}
      </div>

      {savingKey === 'personality' && <p className="text-xs text-muted-foreground">Saving…</p>}
    </>
  );
}
