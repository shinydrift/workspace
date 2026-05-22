import React from 'react';
import type { BigFiveTraits } from '../../../shared/types';
import { Slider } from '@/components/ui/slider';

const TRAIT_CONFIG = [
  { key: 'openness', label: 'Openness', low: 'Conventional', high: 'Imaginative' },
  { key: 'conscientiousness', label: 'Conscientiousness', low: 'Flexible', high: 'Thorough' },
  { key: 'extraversion', label: 'Extraversion', low: 'Reserved', high: 'Expressive' },
  { key: 'agreeableness', label: 'Agreeableness', low: 'Direct', high: 'Empathetic' },
  // Big Five stores "neuroticism" (high = volatile), but users expect a positive scale.
  // We display it as "Stability" (high = steady) and invert on read/write: stored = 6 - sliderValue.
  { key: 'stability', label: 'Stability', low: 'Reactive', high: 'Steady' },
] as const;

type TraitKey = (typeof TRAIT_CONFIG)[number]['key'];

interface Props {
  traits: BigFiveTraits;
  onChange?: (traits: BigFiveTraits) => void;
  disabled?: boolean;
}

function getSliderValue(traits: BigFiveTraits, key: TraitKey): number {
  if (key === 'stability') return 6 - traits.neuroticism;
  return traits[key];
}

function applySliderChange(traits: BigFiveTraits, key: TraitKey, value: number): BigFiveTraits {
  if (key === 'stability') return { ...traits, neuroticism: 6 - value };
  return { ...traits, [key]: value };
}

export function BigFiveSliders({ traits, onChange, disabled = false }: Props) {
  return (
    <div className="space-y-3">
      {TRAIT_CONFIG.map(({ key, label, low, high }) => {
        const value = getSliderValue(traits, key);
        return (
          <div key={key} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground/60">{low}</span>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[value]}
              disabled={disabled}
              title={`${label}: ${value} — ${value <= 2 ? low : value >= 4 ? high : 'Neutral'}`}
              onValueChange={(vals) => {
                if (!onChange) return;
                onChange(applySliderChange(traits, key, vals[0]));
              }}
              className="flex-1"
            />
            <span className="w-16 shrink-0 text-xs text-muted-foreground/60">{high}</span>
          </div>
        );
      })}
    </div>
  );
}
