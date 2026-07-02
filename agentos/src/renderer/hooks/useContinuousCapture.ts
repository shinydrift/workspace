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
  /** Toggle always-on capture. Enabling starts the mic immediately (needs mic permission). */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Add system audio to the mix. Must be called from a user gesture (screen-share picker). */
  armSystemAudio: () => Promise<void>;
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

    segmentStartRef.current = Date.now();
    // Align the first cut to the next wall-clock boundary, then roll every 5 minutes.
    timeoutRef.current = setTimeout(() => {
      rotate();
      intervalRef.current = setInterval(rotate, SEGMENT_MS);
    }, msToNextBoundary());
  }, [rotate, teardown]);

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

  const armSystemAudio = useCallback(async () => {
    const audioCtx = audioCtxRef.current;
    const mixer = mixerRef.current;
    if (!audioCtx || !mixer) return;
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1 },
      });
      displayStream.getVideoTracks().forEach((t) => t.stop());
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        stopStreamTracks(displayStream);
        setError('No system audio track was shared.');
        return;
      }
      stopStreamTracks(sysStreamRef.current);
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
      setError(`System audio not shared: ${getErrorMessage(err)}`);
    }
  }, []);

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

  return { enabled, micActive, usingSystemAudio, error, setEnabled, armSystemAudio };
}
