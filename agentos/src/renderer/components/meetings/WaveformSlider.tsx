import React from 'react';
import { cn } from '@/lib/utils';

export interface WaveformRange {
  from: number;
  to: number;
  peaks?: number[];
}

interface Props {
  duration: number;
  current: number;
  ranges?: WaveformRange[];
  disabled?: boolean;
  label: string;
  onSeek: (seconds: number) => void;
  className?: string;
}

/** A wall-clock slider: blank hatched spans are capture gaps, not compressed time. */
export function WaveformSlider({ duration, current, ranges, disabled, label, onSeek, className }: Props) {
  const total = Math.max(duration, 0.001);
  const available = ranges?.length ? ranges : [{ from: 0, to: total }];
  const bars = Array.from({ length: 72 }, (_, index) => {
    const at = ((index + 0.5) / 72) * total;
    const range = available.find((item) => at >= item.from && at <= item.to);
    const peakIndex = range?.peaks?.length
      ? Math.min(
          range.peaks.length - 1,
          Math.floor(((at - range.from) / Math.max(0.001, range.to - range.from)) * range.peaks.length)
        )
      : -1;
    const peak = peakIndex >= 0 ? (range?.peaks?.[peakIndex] ?? 0) : 0;
    const height = Math.max(8, peak * 100);
    const played = at <= current;
    return (
      <i
        key={index}
        className={cn(
          'w-px rounded-full',
          range ? (played ? 'bg-blue-400' : 'bg-muted-foreground/45') : 'bg-transparent'
        )}
        style={{ height: `${height}%` }}
      />
    );
  });
  return (
    <div className={cn('relative h-7 flex-1 overflow-hidden rounded-sm', className)}>
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, rgb(148 163 184 / .35) 4px 5px)',
        }}
      />
      {available.map((range, index) => (
        <i
          key={`${range.from}-${range.to}-${index}`}
          aria-hidden
          className="absolute inset-y-0 bg-background/90"
          style={{ left: `${(range.from / total) * 100}%`, width: `${((range.to - range.from) / total) * 100}%` }}
        />
      ))}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-between px-1">
        {bars}
      </div>
      <input
        type="range"
        min={0}
        max={total}
        step={0.05}
        value={Math.min(Math.max(current, 0), total)}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${Math.floor(current)} seconds of ${Math.floor(duration)} seconds`}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  );
}
