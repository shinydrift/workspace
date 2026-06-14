import React, { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { MemoryConfig } from '../../../shared/types';
import { useSettings } from '../../contexts/SettingsContext';
import { PresetGrid, detectPreset, type Preset } from './PresetGrid';

type CodeSliderKey = keyof Pick<MemoryConfig, 'codeVectorWeight' | 'codeTextWeight' | 'codeDecayHalfLifeDays'>;

const PRESET_KEYS: CodeSliderKey[] = ['codeVectorWeight', 'codeTextWeight', 'codeDecayHalfLifeDays'];

const PRESETS: Preset<MemoryConfig, CodeSliderKey>[] = [
  {
    name: 'default',
    label: 'Default',
    description: 'Balanced vector + text retrieval with 180d decay.',
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
];

const SLIDERS: {
  key: CodeSliderKey;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
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
    defaultVal: 180,
  },
];

export function CodeTab() {
  const { memory } = useSettings();

  const patch = (key: CodeSliderKey, value: number) => memory.setMemoryConfig({ ...memory.memoryConfig, [key]: value });

  const activePreset = useMemo(() => detectPreset(PRESETS, memory.memoryConfig, PRESET_KEYS), [memory.memoryConfig]);

  const applyPreset = (preset: Preset<MemoryConfig, CodeSliderKey>) => {
    const next: MemoryConfig = { ...memory.memoryConfig };
    for (const k of PRESET_KEYS) {
      next[k] = preset.settings[k];
    }
    memory.setMemoryConfig(next);
  };

  return (
    <>
      <p className="text-xs text-muted-foreground mb-4">
        Search tuning for code indexing. These override the memory search weights when querying indexed source files.
      </p>

      <div className="space-y-3">
        <Label className="text-sm font-medium">Code search tuning</Label>
        <p className="text-xs text-muted-foreground">
          Pick a preset or tweak individual sliders. Vector and text weights are applied independently and do not need
          to sum to 1.
        </p>

        <PresetGrid presets={PRESETS} activePreset={activePreset} onSelect={applyPreset} />

        <div className="space-y-3">
          {SLIDERS.map(({ key, label, low, high, min, max, step, defaultVal }) => {
            const current = memory.memoryConfig[key] ?? defaultVal;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs text-muted-foreground">
                  {label}
                  <span className="ml-1 text-muted-foreground/60">({current})</span>
                </span>
                <span className="w-12 shrink-0 text-right text-xs text-muted-foreground/60">{low}</span>
                <Slider
                  min={min}
                  max={max}
                  step={step}
                  value={[current]}
                  onValueChange={([v]) => patch(key, v)}
                  className="flex-1"
                />
                <span className="w-12 shrink-0 text-xs text-muted-foreground/60">{high}</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Set decay half-life to 0 to disable time-based decay for code results.
        </p>
      </div>
    </>
  );
}
