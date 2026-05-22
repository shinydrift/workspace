import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PresetName = 'default' | 'precise' | 'broad' | 'custom';

export interface Preset<T, K extends keyof T = keyof T> {
  name: PresetName;
  label: string;
  description: string;
  settings: Partial<Pick<T, K>>;
}

export function detectPreset<T, K extends keyof T>(
  presets: Preset<T, K>[],
  current: Partial<T>,
  keys: K[]
): PresetName {
  for (const preset of presets) {
    if (preset.name === 'custom') continue;
    const matches = keys.every((k) => current[k] === preset.settings[k]);
    if (matches) return preset.name;
  }
  return 'custom';
}

interface Props<T, K extends keyof T> {
  presets: Preset<T, K>[];
  activePreset: PresetName;
  onSelect: (preset: Preset<T, K>) => void;
}

export function PresetGrid<T, K extends keyof T>({ presets, activePreset, onSelect }: Props<T, K>) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.name}
          type="button"
          variant="outline"
          onClick={() => onSelect(preset)}
          className={cn(
            'h-auto flex-col items-start px-3 py-2 text-xs',
            activePreset === preset.name
              ? 'border-primary bg-primary/5 text-primary font-medium hover:bg-primary/5 hover:text-primary'
              : 'text-muted-foreground hover:border-foreground hover:bg-transparent'
          )}
        >
          <span className="font-medium">{preset.label}</span>
          <span className="mt-0.5 text-muted-foreground text-wrap text-left">{preset.description}</span>
        </Button>
      ))}
    </div>
  );
}
