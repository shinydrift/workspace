import React, { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { MemoryConfig } from '../../../shared/types';
import { useSettings } from '../../contexts/SettingsContext';
import { PresetGrid, detectPreset, type Preset } from './PresetGrid';

type MemoryPresetKey = keyof Pick<
  MemoryConfig,
  'maxResults' | 'minScore' | 'vectorWeight' | 'textWeight' | 'decayHalfLifeDays' | 'mmrLambda'
>;

const PRESET_KEYS: MemoryPresetKey[] = [
  'maxResults',
  'minScore',
  'vectorWeight',
  'textWeight',
  'decayHalfLifeDays',
  'mmrLambda',
];

const PRESETS: Preset<MemoryConfig, MemoryPresetKey>[] = [
  {
    name: 'default',
    label: 'Default',
    description: 'Balanced retrieval — 8 results, 0.1 min score, hybrid vector/text.',
    settings: {},
  },
  {
    name: 'precise',
    label: 'Precise',
    description: 'Fewer, higher-quality results with a stricter relevance threshold.',
    settings: {
      maxResults: 5,
      minScore: 0.3,
      vectorWeight: 0.8,
      textWeight: 0.2,
      decayHalfLifeDays: 30,
      mmrLambda: 0.85,
    },
  },
  {
    name: 'broad',
    label: 'Broad',
    description: 'More results, lower threshold — good for exploratory recall.',
    settings: {
      maxResults: 15,
      minScore: 0.05,
      vectorWeight: 0.6,
      textWeight: 0.4,
      decayHalfLifeDays: 90,
      mmrLambda: 0.5,
    },
  },
  {
    name: 'custom',
    label: 'Custom',
    description: 'Set every parameter manually.',
    settings: {},
  },
];

type SliderKey = keyof Pick<
  MemoryConfig,
  'maxResults' | 'minScore' | 'vectorWeight' | 'textWeight' | 'decayHalfLifeDays' | 'mmrLambda' | 'sessionRetentionDays'
>;

const SLIDER_CONFIG: {
  key: SliderKey;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
}[] = [
  { key: 'maxResults', label: 'Max results', low: '1', high: '50', min: 1, max: 50, step: 1, defaultVal: 8 },
  { key: 'minScore', label: 'Min score', low: '0', high: '1', min: 0, max: 1, step: 0.05, defaultVal: 0.5 },
  { key: 'vectorWeight', label: 'Vector weight', low: '0', high: '1', min: 0, max: 1, step: 0.05, defaultVal: 0.7 },
  { key: 'textWeight', label: 'Text weight', low: '0', high: '1', min: 0, max: 1, step: 0.05, defaultVal: 0.3 },
  {
    key: 'decayHalfLifeDays',
    label: 'Decay half-life',
    low: '1d',
    high: '365d',
    min: 1,
    max: 365,
    step: 1,
    defaultVal: 45,
  },
  { key: 'mmrLambda', label: 'MMR lambda', low: '0', high: '1', min: 0, max: 1, step: 0.05, defaultVal: 0.7 },
  {
    key: 'sessionRetentionDays',
    label: 'Session retention',
    low: '∞',
    high: '365d',
    min: 0,
    max: 365,
    step: 1,
    defaultVal: 0,
  },
];

export function SearchTuningSection() {
  const { memory } = useSettings();
  const [forceCustom, setForceCustom] = useState(false);

  const patchSearch = (patch: Partial<MemoryConfig>) => memory.setMemoryConfig({ ...memory.memoryConfig, ...patch });

  const activePreset = useMemo(
    () => (forceCustom ? 'custom' : detectPreset(PRESETS, memory.memoryConfig, PRESET_KEYS)),
    [forceCustom, memory.memoryConfig]
  );

  const applyPreset = (preset: Preset<MemoryConfig, MemoryPresetKey>) => {
    if (preset.name === 'custom') {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    const next: MemoryConfig = { ...memory.memoryConfig };
    for (const k of PRESET_KEYS) {
      next[k] = preset.settings[k];
    }
    memory.setMemoryConfig(next);
  };

  return (
    <div className="mt-4 space-y-3">
      <Label className="text-sm font-medium">Search tuning</Label>

      <PresetGrid presets={PRESETS} activePreset={activePreset} onSelect={applyPreset} />

      {activePreset === 'custom' && (
        <div className="space-y-3">
          {SLIDER_CONFIG.map(({ key, label, low, high, min, max, step, defaultVal }) => {
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
                  onValueChange={([v]) => patchSearch({ [key]: v })}
                  className="flex-1"
                />
                <span className="w-12 shrink-0 text-xs text-muted-foreground/60">{high}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
