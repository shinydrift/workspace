import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { SectionHeader } from './SectionHeader';
import { InheritHint } from './InheritHint';
import { PresetGrid, detectPreset, type Preset } from '../../settings/PresetGrid';
import type { AppSettings, MemorySearchSettings, ProjectConfig } from '../../../../shared/types';

type MemoryConfig = NonNullable<ProjectConfig['memory']>;

interface Props {
  memory: MemoryConfig;
  appSettings: AppSettings | null;
  savingKey: string | null;
  onPatch: (patch: MemoryConfig) => void;
}

type ProjectCodeKey = keyof Pick<MemoryConfig, 'codeVectorWeight' | 'codeTextWeight' | 'codeDecayHalfLifeDays'>;

const PRESET_KEYS: ProjectCodeKey[] = ['codeVectorWeight', 'codeTextWeight', 'codeDecayHalfLifeDays'];

const PRESETS: Preset<MemoryConfig, ProjectCodeKey>[] = [
  {
    name: 'default',
    label: 'Default',
    description: 'Clear all overrides — inherit from app settings.',
    settings: {},
  },
  {
    name: 'precise',
    label: 'Precise',
    description: 'Favor semantic similarity, decay older results faster.',
    settings: { codeVectorWeight: 0.75, codeTextWeight: 0.25, codeDecayHalfLifeDays: 90 },
  },
  {
    name: 'broad',
    label: 'Broad',
    description: 'Favor keyword matches, retain older results longer.',
    settings: { codeVectorWeight: 0.4, codeTextWeight: 0.6, codeDecayHalfLifeDays: 365 },
  },
  {
    name: 'custom',
    label: 'Custom',
    description: 'Override each parameter manually.',
    settings: {},
  },
];

const SLIDERS: {
  key: ProjectCodeKey;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
  appKey: keyof MemorySearchSettings;
  defaultVal: number;
}[] = [
  {
    key: 'codeVectorWeight',
    label: 'Vector weight',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'codeVectorWeight',
    defaultVal: 0.55,
  },
  {
    key: 'codeTextWeight',
    label: 'Text weight',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'codeTextWeight',
    defaultVal: 0.45,
  },
  {
    key: 'codeDecayHalfLifeDays',
    label: 'Decay half-life',
    low: 'off',
    high: '365d',
    min: 0,
    max: 365,
    step: 1,
    appKey: 'codeDecayHalfLifeDays',
    defaultVal: 180,
  },
];

export function CodeSection({ memory, appSettings, savingKey, onPatch }: Props) {
  const ms = appSettings?.memorySearch ?? {};
  const [forceCustom, setForceCustom] = useState(false);

  const activePreset = useMemo(
    () => (forceCustom ? 'custom' : detectPreset(PRESETS, memory, PRESET_KEYS)),
    [forceCustom, memory]
  );

  const applyPreset = (preset: Preset<MemoryConfig, ProjectCodeKey>) => {
    if (preset.name === 'custom') {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    const next: MemoryConfig = { ...memory };
    for (const k of PRESET_KEYS) {
      next[k] = preset.settings[k];
    }
    onPatch(next);
  };

  return (
    <>
      <SectionHeader
        title="Code"
        description="Per-project code search tuning. Overrides app-level settings when set."
      />
      <div className="space-y-3">
        <Label className="text-sm font-medium">Code search tuning</Label>
        <p className="text-xs text-muted-foreground">
          Pick a preset or override individual parameters. Unset fields inherit the app setting. Vector and text weights
          are applied independently and do not need to sum to 1.
        </p>

        <PresetGrid presets={PRESETS} activePreset={activePreset} onSelect={applyPreset} />

        {SLIDERS.map(({ key, label, low, high, min, max, step, appKey, defaultVal }) => {
          const overridden = memory[key] !== undefined;
          const appVal = (ms[appKey] as number | undefined) ?? defaultVal;
          const current = (memory[key] as number | undefined) ?? appVal;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {label}
                  <span className="ml-1 text-muted-foreground/60">({current})</span>
                </span>
                {overridden && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                    onClick={() => onPatch({ ...memory, [key]: undefined })}
                  >
                    reset
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground/60">{low}</span>
                <Slider
                  min={min}
                  max={max}
                  step={step}
                  value={[current]}
                  onValueChange={([v]) => onPatch({ ...memory, [key]: v })}
                  className="flex-1"
                />
                <span className="w-8 shrink-0 text-xs text-muted-foreground/60">{high}</span>
              </div>
              <InheritHint show={!overridden} />
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Set decay half-life to 0 to disable time-based decay for code results.
        </p>
        {savingKey === 'memory' && <p className="text-xs text-muted-foreground">Saving…</p>}
      </div>
    </>
  );
}
