import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { attachAudioCapture, encodePcmAsWav, resamplePcmTo16kHz, type AudioCapture } from '@/lib/audio';

// Rolling segment length. Segments are cut on wall-clock 5-minute boundaries so a
// picked time slot lines up with the clips it contains.
const SEGMENT_MS = 5 * 60 * 1000;

function stopStreamTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function msToNextBoundary(): number {
  return SEGMENT_MS - (Date.now() % SEGMENT_MS);
}

export interface UseContinuousCaptureResult {
  enabled: boolean;
  micActive: boolean;
  usingSystemAudio: boolean;
  error: string;
  /**
   * Toggle always-on capture. Enabling starts the mic and pulls in system audio too (needs
   * mic + screen-recording permission). System audio needs a user gesture, so on auto-restore
   * at launch it arms on the first interaction instead.
   */
  setEnabled: (enabled: boolean) => Promise<void>;
}

/**
 * Always-on capture that rolls the microphone (+ optionally system audio) into fixed
 * 5-minute segments, transcribing and saving each as it closes. Segments are stored
 * independently of any thread; a time slot of them can later be summarized. Mounted once
 * at the app root so capture survives navigation.
 */
export function useContinuousCapture(): UseContinuousCaptureResult {
  const [enabled, setEnabledState] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [usingSystemAudio, setUsingSystemAudio] = useState(false);
  const [error, setError] = useState('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixerRef = useRef<GainNode | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sysStreamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const segmentStartRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cleanup for the "arm system audio on next user gesture" fallback (see armSystemAudio).
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  const processSegment = useCallback(
    async (chunks: Float32Array[], sampleRate: number, startedAt: number, endedAt: number) => {
      try {
        const resampled = await resamplePcmTo16kHz(chunks, sampleRate);
        const arrayBuffer = encodePcmAsWav([resampled], 16000);
        const { text } = await window.electronAPI.audio.transcribe(arrayBuffer);
        const transcript = text.trim();
        // Drop silent clips — nothing was said, so nothing to summarize.
        if (!transcript) return;
        await window.electronAPI.files.saveRecording({
          duration: Math.round((endedAt - startedAt) / 1000),
          arrayBuffer,
          transcript,
          kind: 'segment',
          startedAt,
        });
      } catch (err) {
        // A single failed segment must not stop continuous capture.
        console.error('continuous capture: segment failed', getErrorMessage(err));
      }
    },
    []
  );

  // Snapshot the accumulated PCM, reset the buffer, and process the closed segment
  // out-of-band so capture keeps running without a gap.
  const rotate = useCallback(() => {
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const startedAt = segmentStartRef.current;
    const endedAt = Date.now();
    segmentStartRef.current = endedAt;
    if (chunks.length === 0) return;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    void processSegment(chunks, sampleRate, startedAt, endedAt);
  }, [processSegment]);

  const teardown = useCallback(() => {
    gestureCleanupRef.current?.();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    stopStreamTracks(micStreamRef.current);
    stopStreamTracks(sysStreamRef.current);
    micStreamRef.current = null;
    sysStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    mixerRef.current = null;
    pcmChunksRef.current = [];
    setMicActive(false);
    setUsingSystemAudio(false);
  }, []);

  // Pull system audio into the mix. It's granted as loopback with no picker (see the main
  // process display-media handler), but the getDisplayMedia() call still needs a user gesture.
  // The toggle click provides one; on auto-restore at launch there's none, so on failure we
  // retry once the user next interacts with the window — no button, it just comes back.
  const armSystemAudio = useCallback(async () => {
    const audioCtx = audioCtxRef.current;
    const mixer = mixerRef.current;
    if (!audioCtx || !mixer || sysStreamRef.current) return;
    // Capture now, before getDisplayMedia consumes it: a failure with a gesture in hand is a
    // real problem (permission denied), while one without is just the no-gesture launch case.
    const hadGesture = navigator.userActivation?.isActive ?? false;
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1 },
      });
      // Capture may have been torn down (or restarted) while the request resolved — don't leave
      // a live loopback stream running or touch a closed context.
      if (audioCtxRef.current !== audioCtx) {
        stopStreamTracks(displayStream);
        return;
      }
      displayStream.getVideoTracks().forEach((t) => t.stop());
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        stopStreamTracks(displayStream);
        return;
      }
      sysStreamRef.current = displayStream;
      audioCtx.createMediaStreamSource(new MediaStream(audioTracks)).connect(mixer);
      setUsingSystemAudio(true);
      // If the user stops sharing from the OS, fall back to mic-only. Guard on the exact
      // stream so a stale listener from a previous share can't stop a freshly-armed one.
      audioTracks[0].addEventListener('ended', () => {
        if (sysStreamRef.current !== displayStream) return;
        stopStreamTracks(displayStream);
        sysStreamRef.current = null;
        setUsingSystemAudio(false);
      });
    } catch (err) {
      if (hadGesture) {
        // A gesture-backed attempt failed — surface it and stop. Retrying on every interaction
        // would just re-hit the same denial and nag the OS permission prompt.
        setError(`System audio unavailable: ${getErrorMessage(err)}`);
        return;
      }
      // No user gesture yet (auto-restore at launch) — arm on the next interaction.
      if (gestureCleanupRef.current) return;
      const retry = () => {
        gestureCleanupRef.current?.();
        void armSystemAudio();
      };
      gestureCleanupRef.current = () => {
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
        gestureCleanupRef.current = null;
      };
      window.addEventListener('pointerdown', retry);
      window.addEventListener('keydown', retry);
    }
  }, []);

  const start = useCallback(async () => {
    setError('');
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const mixer = audioCtx.createGain();
    mixerRef.current = mixer;

    try {
      // Auto-restore at launch has no user gesture, so the context can come up suspended;
      // without resuming it, capture produces silence and every segment is dropped.
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = micStream;
      audioCtx.createMediaStreamSource(micStream).connect(mixer);
      setMicActive(true);

      captureRef.current = await attachAudioCapture(audioCtx, mixer, (chunk) => {
        pcmChunksRef.current.push(chunk);
      });
    } catch (err) {
      teardown();
      setError(`Couldn't start capture: ${getErrorMessage(err)}`);
      throw err;
    }

    // System audio is part of the same capture now — best-effort, mic keeps going without it.
    void armSystemAudio();

    segmentStartRef.current = Date.now();
    // Align the first cut to the next wall-clock boundary, then roll every 5 minutes.
    timeoutRef.current = setTimeout(() => {
      rotate();
      intervalRef.current = setInterval(rotate, SEGMENT_MS);
    }, msToNextBoundary());
  }, [rotate, teardown, armSystemAudio]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (next === enabled) return;
      if (next) {
        try {
          await start();
          setEnabledState(true);
          void window.electronAPI.settings.set({ continuousCaptureEnabled: true });
        } catch {
          setEnabledState(false);
          void window.electronAPI.settings.set({ continuousCaptureEnabled: false });
        }
      } else {
        rotate(); // flush the final partial segment
        teardown();
        setEnabledState(false);
        void window.electronAPI.settings.set({ continuousCaptureEnabled: false });
      }
    },
    [enabled, start, rotate, teardown]
  );

  // Restore the persisted preference on mount.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.settings
      .get()
      .then((settings) => {
        if (!cancelled && settings.continuousCaptureEnabled) void setEnabled(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { enabled, micActive, usingSystemAudio, error, setEnabled };
}
