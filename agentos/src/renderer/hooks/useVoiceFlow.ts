import { useCallback, useEffect, useRef, useState } from 'react';
import { attachAudioCapture, type AudioCapture, encodePcmAsWav, resamplePcmTo16kHz } from '@/lib/audio';
import { useUIStore } from '@/store/uiStore';

export type VoiceFlowState = 'idle' | 'recording' | 'transcribing';

export interface UseVoiceFlowResult {
  state: VoiceFlowState;
  recordingSeconds: number;
  /** 0–100 while the model is being downloaded; null otherwise. */
  downloadProgress: number | null;
  /** Partial transcript text streamed during transcription. */
  transcriptPreview: string;
  analyserNode: AnalyserNode | null;
  cancel: () => void;
}

/** RMS threshold below which we consider the audio to be silence and skip transcription. */
const SILENCE_RMS_THRESHOLD = 0.005;
/** Hard cap on buffered audio — guards against memory growth if recording gets stuck. */
const MAX_RECORD_SECONDS = 120;
/** Consecutive silence duration before auto-stop. */
const AUTO_STOP_SILENCE_MS = 3000;
const SILENCE_CHECK_INTERVAL_MS = 100;

function hasAudioEnergy(chunks: Float32Array[]): boolean {
  let sum = 0;
  let count = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
      count++;
    }
  }
  return count > 0 && Math.sqrt(sum / count) > SILENCE_RMS_THRESHOLD;
}

function playStartChime(): void {
  try {
    const ctx = new AudioContext();
    const play = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + startOffset + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startOffset + duration);
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration);
    };
    play(587, 0, 0.18);
    play(880, 0.12, 0.2);
    setTimeout(() => ctx.close(), 600);
  } catch {
    // non-fatal
  }
}

export function useVoiceFlow(): UseVoiceFlowResult {
  const [state, setState] = useState<VoiceFlowState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState('');
  const setPendingTranscript = useUIStore((s) => s.setPendingTranscript);

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const stateRef = useRef<VoiceFlowState>('idle');
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Routing context captured at recording start. */
  const routingRef = useRef<{ appFocused: boolean; frontmostApp: string | null }>({
    appFocused: false,
    frontmostApp: null,
  });
  /** Set when RECORDING_CANCEL arrives while getUserMedia is still pending. */
  const stopPendingRef = useRef(false);
  /** Set when cancel fires during transcription — checked at each await point in handleAutoStop. */
  const cancelledRef = useRef(false);

  const setStateSync = useCallback((s: VoiceFlowState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // Timer for elapsed seconds
  useEffect(() => {
    if (state !== 'recording') {
      setRecordingSeconds(0);
      return;
    }
    const id = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const stopCapture = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioCaptureRef.current?.stop();
    audioCaptureRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserNodeRef.current = null;
    setAnalyserNode(null);
    return { chunks: pcmChunksRef.current.splice(0), sampleRate };
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopPendingRef.current = true;
    stopCapture();
    setDownloadProgress(null);
    setTranscriptPreview('');
    setStateSync('idle');
    window.electronAPI?.win.notifyVoiceFlowStopped();
  }, [stopCapture, setStateSync]);

  // Silence-triggered auto-stop: transcribes audio and routes transcript.
  // Defined before handleStart so the silence watchdog can reference it without a stale closure.
  const handleAutoStop = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    const { appFocused, frontmostApp } = routingRef.current;
    const selectedThreadId = useUIStore.getState().selectedThreadId;
    const { chunks, sampleRate } = stopCapture();
    const energetic = hasAudioEnergy(chunks);
    console.log('[voice-flow] auto-stop, captured audio', {
      chunkCount: chunks.length,
      totalSamples: chunks.reduce((n, c) => n + c.length, 0),
      sampleRate,
      hasEnergy: energetic,
    });

    if (chunks.length === 0 || !energetic) {
      console.log('[voice-flow] skipping transcription (empty or silent)');
      setStateSync('idle');
      window.electronAPI?.win.notifyVoiceFlowStopped();
      return;
    }

    setTranscriptPreview('');
    setStateSync('transcribing');
    try {
      const resampled = await resamplePcmTo16kHz(chunks, sampleRate);
      if (cancelledRef.current) return;
      const arrayBuffer = encodePcmAsWav([resampled], 16000);
      const { text } = await window.electronAPI.audio.transcribe(arrayBuffer);
      if (cancelledRef.current) {
        console.log('[voice-flow] transcription completed but cancelled — discarding');
        return;
      }
      console.log('[voice-flow] transcription result', { chars: text.length, preview: text.slice(0, 80) });
      const trimmed = text.trim();
      if (!trimmed) return;

      const routeToThread = appFocused && selectedThreadId != null;
      const pasteToExternal = !appFocused && frontmostApp != null;
      console.log('[voice-flow] routing decision', {
        appFocused,
        frontmostApp,
        selectedThreadId,
        routeToThread,
        pasteToExternal,
      });

      if (routeToThread) {
        setPendingTranscript({ text: trimmed, autoSubmit: true, newThread: false });
      } else if (pasteToExternal) {
        let pasted = false;
        try {
          await window.electronAPI.win.pasteTranscript(trimmed, frontmostApp);
          pasted = true;
        } catch (err) {
          console.warn('[voice-flow] pasteTranscript failed, falling back to new thread', err);
        }
        if (pasted) return;
      }
      if (!routeToThread) {
        try {
          await window.electronAPI.win.focus();
        } catch (err) {
          console.warn('[voice-flow] win.focus() failed', err);
        }
        window.dispatchEvent(new CustomEvent('voiceflow:newThread'));
        setPendingTranscript({ text: trimmed, autoSubmit: true, newThread: true });
      }
    } catch (err) {
      console.error('[voice-flow] transcribe IPC failed', err);
    } finally {
      // If cancel() already reset state and acked main, don't stomp a possibly-new session.
      if (!cancelledRef.current) {
        setDownloadProgress(null);
        setTranscriptPreview('');
        setStateSync('idle');
        window.electronAPI?.win.notifyVoiceFlowStopped();
      }
    }
  }, [stopCapture, setStateSync, setPendingTranscript]);

  const handleStart = useCallback(
    async (payload: { appFocused: boolean; frontmostApp: string | null }) => {
      console.log('[voice-flow] handleStart received from main', { currentState: stateRef.current, ...payload });
      if (stateRef.current !== 'idle') return;
      stopPendingRef.current = false;
      cancelledRef.current = false;
      routingRef.current = payload;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopPendingRef.current) {
          console.log('[voice-flow] cancel arrived during getUserMedia, discarding');
          stream.getTracks().forEach((t) => t.stop());
          stopPendingRef.current = false;
          return;
        }
        streamRef.current = stream;
        pcmChunksRef.current = [];

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        // AnalyserNode requires a path to destination to be rendered by the Web Audio pull graph.
        const analyserSilencer = audioCtx.createGain();
        analyserSilencer.gain.value = 0;
        analyser.connect(analyserSilencer);
        analyserSilencer.connect(audioCtx.destination);
        analyserNodeRef.current = analyser;
        setAnalyserNode(analyser);
        const maxSamples = MAX_RECORD_SECONDS * audioCtx.sampleRate;
        let totalSamples = 0;
        audioCaptureRef.current = await attachAudioCapture(audioCtx, source, (chunk) => {
          if (totalSamples >= maxSamples) return;
          pcmChunksRef.current.push(chunk);
          totalSamples += chunk.length;
        });
        if (stopPendingRef.current) {
          console.log('[voice-flow] cancel arrived during attachAudioCapture, discarding');
          stopCapture();
          stopPendingRef.current = false;
          return;
        }

        setDownloadProgress(null);
        setTranscriptPreview('');
        playStartChime();
        setStateSync('recording');
        console.log('[voice-flow] recording started', { sampleRate: audioCtx.sampleRate });

        // Silence watchdog — auto-stop after AUTO_STOP_SILENCE_MS of no voice activity.
        let silenceMs = 0;
        silenceTimerRef.current = setInterval(() => {
          const node = analyserNodeRef.current;
          if (!node) return;
          const buf = new Float32Array(node.fftSize);
          node.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          if (rms < SILENCE_RMS_THRESHOLD) {
            silenceMs += SILENCE_CHECK_INTERVAL_MS;
            if (silenceMs >= AUTO_STOP_SILENCE_MS) {
              console.log('[voice-flow] silence threshold reached, auto-stopping');
              clearInterval(silenceTimerRef.current!);
              silenceTimerRef.current = null;
              handleAutoStop();
            }
          } else {
            silenceMs = 0;
          }
        }, SILENCE_CHECK_INTERVAL_MS);
      } catch (err) {
        console.error('[voice-flow] handleStart failed (getUserMedia?)', err);
        stopPendingRef.current = false;
        setStateSync('idle');
      }
    },
    [stopCapture, setStateSync, handleAutoStop]
  );

  // Broadcast recording state to main so the always-on-top overlay can mirror it.
  // recordingSeconds is intentionally excluded — the overlay self-times to avoid 1 IPC/sec.
  useEffect(() => {
    window.electronAPI?.win.broadcastRecordingState({ state, downloadProgress, transcriptPreview });
  }, [state, downloadProgress, transcriptPreview]);

  // Listen for hold-start, hotkey-stop, and cancel from main process.
  useEffect(() => {
    const offStart = window.electronAPI?.on.voiceFlowStart(handleStart);
    const offStop = window.electronAPI?.on.voiceFlowStop(() => handleAutoStop());
    const offCancel = window.electronAPI?.on.recordingCancel(cancel);
    return () => {
      offStart?.();
      offStop?.();
      offCancel?.();
    };
  }, [handleStart, handleAutoStop, cancel]);

  // Download progress and streaming segment events
  useEffect(() => {
    const offProgress = window.electronAPI?.on.voiceFlowDownloadProgress((e) => {
      setDownloadProgress(e.percent < 100 ? e.percent : null);
    });
    const offSegment = window.electronAPI?.on.voiceFlowTranscriptSegment((e) => {
      setTranscriptPreview(e.text);
    });
    return () => {
      offProgress?.();
      offSegment?.();
    };
  }, []);

  // Esc cancels active recording
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (stateRef.current === 'recording' || stateRef.current === 'transcribing')) cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioCaptureRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  return { state, recordingSeconds, downloadProgress, transcriptPreview, analyserNode, cancel };
}
