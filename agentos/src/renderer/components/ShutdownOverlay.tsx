import React, { useEffect, useState } from 'react';
import type { ShutdownOverlayPayload } from '../../shared/types';
import { OverlayPill } from './OverlayPill';

export function ShutdownOverlay() {
  const [payload, setPayload] = useState<ShutdownOverlayPayload | null>(null);

  useEffect(() => {
    const off = window.electronAPI?.on.shutdownOverlayState(setPayload);
    return () => off?.();
  }, []);

  if (!payload) return null;

  return (
    <OverlayPill>
      {payload.done ? (
        <span className="h-1.5 w-1.5 rounded-full bg-white/60 shrink-0" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
      )}
      <span className="text-white/70 text-sm">{payload.step}</span>
    </OverlayPill>
  );
}
