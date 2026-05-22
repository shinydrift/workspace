import React, { useEffect, useState } from 'react';
import type { ShutdownOverlayPayload } from '../../shared/types';

export function ShutdownOverlay() {
  const [payload, setPayload] = useState<ShutdownOverlayPayload | null>(null);

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
  }, []);

  useEffect(() => {
    const off = window.electronAPI?.on.shutdownOverlayState(setPayload);
    return () => off?.();
  }, []);

  if (!payload) return null;

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-neutral-900 shadow-lg select-none z-50">
      {payload.done ? (
        <span className="h-1.5 w-1.5 rounded-full bg-white/60 shrink-0" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
      )}
      <span className="text-white/70 text-sm">{payload.step}</span>
    </div>
  );
}
