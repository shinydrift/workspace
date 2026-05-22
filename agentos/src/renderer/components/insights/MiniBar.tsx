import React from 'react';
import { cn } from '@/lib/utils';

interface MiniBarSegment {
  value: number;
  className: string;
}

interface MiniBarProps {
  segments: MiniBarSegment[];
  trackClassName?: string;
}

export function MiniBar({ segments, trackClassName }: MiniBarProps) {
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted/30', trackClassName)}>
      {segments.map((seg, i) => (
        <div
          key={i}
          className={cn('h-full', seg.className)}
          style={{ width: `${Math.max(0, Math.min(100, seg.value))}%` }}
        />
      ))}
    </div>
  );
}
