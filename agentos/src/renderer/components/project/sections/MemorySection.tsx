import React, { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { SectionHeader } from './SectionHeader';
import { InheritHint } from './InheritHint';
import { PresetGrid, detectPreset, type Preset } from '../../settings/PresetGrid';
import type { AppSettings, ProjectConfig } from '../../../../shared/types';

type MemoryConfig = NonNullable<ProjectConfig['memory']>;

interface Props {
  memory: MemoryConfig;
  appSettings: AppSettings | null;
  savingKey: string | null;
  onPatch: (patch: MemoryConfig) => void;
}

type ProjectSearchKey = keyof Pick<
  MemoryConfig,
  'maxResults' | 'minScore' | 'vectorWeight' | 'textWeight' | 'mmrLambda' | 'sessionRetentionDays'
>;

type ProjectPresetKey = keyof Pick<
  MemoryConfig,
  'maxResults' | 'minScore' | 'vectorWeight' | 'textWeight' | 'mmrLambda'
>;

const PRESET_KEYS: ProjectPresetKey[] = ['maxResults', 'minScore', 'vectorWeight', 'textWeight', 'mmrLambda'];

const PRESETS: Preset<MemoryConfig, ProjectPresetKey>[] = [
  {
    name: 'default',
    label: 'Default',
    description: 'Clear all overrides — inherit from app settings.',
    settings: {},
  },
  {
    name: 'precise',
    label: 'Precise',
    description: 'Fewer, higher-quality results with a stricter relevance threshold.',
    settings: { maxResults: 5, minScore: 0.3, vectorWeight: 0.8, textWeight: 0.2, mmrLambda: 0.85 },
  },
  {
    name: 'broad',
    label: 'Broad',
    description: 'More results, lower threshold — good for exploratory recall.',
    settings: { maxResults: 15, minScore: 0.05, vectorWeight: 0.6, textWeight: 0.4, mmrLambda: 0.5 },
  },
  {
    name: 'custom',
    label: 'Custom',
    description: 'Override each parameter manually.',
    settings: {},
  },
];

const SEARCH_SLIDERS: {
  key: ProjectSearchKey;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
  appKey: keyof MemoryConfig;
  defaultVal: number;
}[] = [
  {
    key: 'maxResults',
    label: 'Max results',
    low: '1',
    high: '50',
    min: 1,
    max: 50,
    step: 1,
    appKey: 'maxResults',
    defaultVal: 8,
  },
  {
    key: 'minScore',
    label: 'Min score',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'minScore',
    defaultVal: 0.1,
  },
  {
    key: 'vectorWeight',
    label: 'Vector weight',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'vectorWeight',
    defaultVal: 0.7,
  },
  {
    key: 'textWeight',
    label: 'Text weight',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'textWeight',
    defaultVal: 0.3,
  },
  {
    key: 'mmrLambda',
    label: 'MMR lambda',
    low: '0',
    high: '1',
    min: 0,
    max: 1,
    step: 0.05,
    appKey: 'mmrLambda',
    defaultVal: 0.7,
  },
  {
    key: 'sessionRetentionDays',
    label: 'Session retention',
    low: '∞',
    high: '365d',
    min: 0,
    max: 365,
    step: 1,
    appKey: 'sessionRetentionDays',
    defaultVal: 0,
  },
];

export function MemorySection({ memory, appSettings, savingKey, onPatch }: Props) {
  const ms = appSettings?.memory ?? {};
  const [forceCustom, setForceCustom] = useState(false);

  const activePreset = useMemo(
    () => (forceCustom ? 'custom' : detectPreset(PRESETS, memory, PRESET_KEYS)),
    [forceCustom, memory]
  );

  const applyPreset = (preset: Preset<MemoryConfig, ProjectPresetKey>) => {
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
      <SectionHeader title="Memory" description="Per-project memory, graph, and search tuning." />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Switch checked={memory.enabled ?? true} onCheckedChange={(v) => onPatch({ ...memory, enabled: v })} />
          <Label className="font-normal">Enable memory for this project</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={memory.decayEnabled ?? false}
            onCheckedChange={(v) => onPatch({ ...memory, decayEnabled: v })}
          />
          <Label className="font-normal">Enable memory decay</Label>
        </div>
        {(memory.decayEnabled ?? false) && (
          <div className="grid grid-cols-2 gap-3 pl-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="proj-mem-halflife">Half-life (days)</Label>
              <Input
                id="proj-mem-halflife"
                type="number"
                min={1}
                value={memory.decayHalfLifeDays ?? 30}
                onChange={(e) => onPatch({ ...memory, decayHalfLifeDays: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="proj-mem-minscore">Min score</Label>
              <Input
                id="proj-mem-minscore"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={memory.decayMinScore ?? 0.1}
                onChange={(e) => onPatch({ ...memory, decayMinScore: Number(e.target.value) })}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Switch
            checked={memory.graphEnabled ?? false}
            onCheckedChange={(v) => onPatch({ ...memory, graphEnabled: v })}
          />
          <Label className="font-normal">Enable knowledge graph</Label>
        </div>
        {(memory.graphEnabled ?? false) && (
          <div className="flex flex-col gap-1 pl-6">
            <Label htmlFor="proj-mem-graphboost">Graph boost factor</Label>
            <Input
              id="proj-mem-graphboost"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={memory.graphBoost ?? 1}
              onChange={(e) => onPatch({ ...memory, graphBoost: Number(e.target.value) })}
              className="w-24"
            />
          </div>
        )}

        <div className="pt-3 space-y-3">
          <Label className="text-sm font-medium">Search tuning</Label>
          <p className="text-xs text-muted-foreground">
            Pick a preset or override individual parameters. Unset fields inherit the app setting.
          </p>

          <PresetGrid presets={PRESETS} activePreset={activePreset} onSelect={applyPreset} />

          {SEARCH_SLIDERS.map(({ key, label, low, high, min, max, step, appKey, defaultVal }) => {
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
        </div>

        {savingKey === 'memory' && <p className="text-xs text-muted-foreground">Saving…</p>}
      </div>
    </>
  );
}
