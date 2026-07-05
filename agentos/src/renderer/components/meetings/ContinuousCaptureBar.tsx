import React from 'react';
import { Warning } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { UseContinuousCaptureResult } from '../../hooks/useContinuousCapture';

/**
 * A small always-visible recording pill. Capture runs seamlessly in the background — this only
 * signals whether it is live and lets the user toggle it. No segment or retention mechanics shown.
 */
export function ContinuousCaptureBar({ capture }: { capture: UseContinuousCaptureResult }) {
  const { enabled, micActive, usingSystemAudio, error, setEnabled } = capture;
  const live = enabled && micActive;
  return (
    <div className="mx-4 mt-4 mb-2">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 py-1 pl-2.5 pr-1.5">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            live ? 'animate-pulse bg-red-500' : enabled ? 'bg-amber-400' : 'bg-muted-foreground/40'
          )}
        />
        <span className="text-xs text-foreground">
          {enabled ? (usingSystemAudio ? 'Recording · mic + system' : 'Recording · mic') : 'Recording off'}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setEnabled(v)}
          aria-label="Toggle background recording"
          className="scale-90"
        />
      </div>

      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-500">
          <Warning className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
