import React from 'react';
import { Microphone, Waveform, Warning } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import type { UseContinuousCaptureResult } from '../../hooks/useContinuousCapture';

/**
 * Controls for always-on capture: a single toggle plus live source status. The toggle pulls
 * in the mic and system audio together; system audio re-arms on the next interaction after a
 * restart, so there's no separate button.
 */
export function ContinuousCaptureBar({ capture }: { capture: UseContinuousCaptureResult }) {
  const { enabled, micActive, usingSystemAudio, error, setEnabled } = capture;
  return (
    <div className="mx-4 mt-4 mb-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Waveform className="h-4 w-4 shrink-0 text-blue-400" />
          <div className="min-w-0">
            <p className="text-sm text-foreground">Always-on capture</p>
            <p className="text-xs text-muted-foreground">Mic + system audio · rolling 5-min segments · kept 7 days</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => void setEnabled(v)} aria-label="Toggle always-on capture" />
      </div>

      {enabled && (
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Microphone className={micActive ? 'h-3 w-3 text-green-400' : 'h-3 w-3'} />
              {micActive ? 'Mic on' : 'Mic off'}
            </span>
            <span className={usingSystemAudio ? 'text-green-400' : ''}>
              {usingSystemAudio ? '+ system audio' : 'mic only'}
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1 mt-2 text-xs text-amber-500">
          <Warning className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
