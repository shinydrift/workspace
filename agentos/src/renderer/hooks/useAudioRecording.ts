import { useState, useRef, useCallback, useEffect } from 'react';
import { attachAudioCapture, AudioCapture, encodePcmAsWav, resamplePcmTo16kHz } from '@/lib/audio';

interface UseAudioRecordingOptions {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

interface UseAudioRecordingResult {
  recording: boolean;
  transcribing: boolean;
  recordingSeconds: number;
  toggleRecording: () => Promise<void>;
}

export function useAudioRecording({ onTranscript, onError }: UseAudioRecordingOptions): UseAudioRecordingResult {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    return () => {
      audioCaptureRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const interval = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      // Stop: collect PCM, encode WAV, transcribe
      if (audioCaptureRef.current) {
        audioCaptureRef.current.stop();
        audioCaptureRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;

      setRecording(false);

      const chunks = pcmChunksRef.current;
      pcmChunksRef.current = [];
      if (chunks.length === 0) {
        onError('No audio was captured.');
        return;
      }

      const resampled = await resamplePcmTo16kHz(chunks, sampleRate);
      const arrayBuffer = encodePcmAsWav([resampled], 16000);
      setTranscribing(true);
      try {
        const { text } = await window.electronAPI.audio.transcribe(arrayBuffer);
        if (text) onTranscript(text);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setTranscribing(false);
      }
      return;
    }

    onError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      pcmChunksRef.current = [];

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      audioCaptureRef.current = await attachAudioCapture(audioCtx, source, (chunk) => {
        pcmChunksRef.current.push(chunk);
      });

      setRecording(true);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Microphone access denied');
    }
  }, [recording, onTranscript, onError]);

  return { recording, transcribing, recordingSeconds, toggleRecording };
}
