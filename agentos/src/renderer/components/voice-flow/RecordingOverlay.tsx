import React, { useEffect, useState } from 'react';
import type { RecordingOverlayPayload } from '../../../shared/types';
import { RecordingPill } from './RecordingPill';

export function RecordingOverlay() {
  const [payload, setPayload] = useState<RecordingOverlayPayload>({
    state: 'idle',
    downloadProgress: null,
    transcriptPreview: '',
  });
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    const off = window.electronAPI?.on.recordingOverlayState(setPayload);
    return () => off?.();
  }, []);

  // Self-managed timer so the overlay doesn't need IPC every second
  useEffect(() => {
    if (payload.state !== 'recording') {
      setRecordingSeconds(0);
      return;
    }
    const id = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [payload.state]);

  return (
    <RecordingPill
      state={payload.state}
      recordingSeconds={recordingSeconds}
      downloadProgress={payload.downloadProgress}
      transcriptPreview={payload.transcriptPreview}
      onCancel={() => window.electronAPI?.win.cancelRecording()}
      overlay
    />
  );
}
