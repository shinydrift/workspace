import { useCallback, useEffect, useRef, useState } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useUIStore } from '../store/uiStore';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { attachAudioCapture, encodePcmAsWav, resamplePcmTo16kHz, type AudioCapture } from '@/lib/audio';

export const MEETING_TEMPLATE = `You are a meeting notes assistant. Review this raw meeting transcript and produce structured notes.

**Title:** (infer a concise title from the discussion)
**Date:** {date}
**Duration:** {duration}
**Raw transcript:** {transcriptPath}

## Summary
(3–5 sentences summarizing what was discussed)

## Key Decisions
- (bullet list of decisions made; omit section if none)

## Action Items
- [ ] Task description — Owner: (person if mentioned) | Due: (date if mentioned)

## Open Questions
- (unresolved items or follow-ups; omit section if none)

---
Transcript:
---
{transcript}
---

After producing these notes, feel free to answer any follow-up questions about this meeting.`;

function stopStreamTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export type RecorderState = 'idle' | 'recording' | 'processing' | 'error';

export interface ProcessingEntry {
  statusMsg: string;
  durationSeconds: number;
  createdAt: number;
  recordingId?: string;
  error?: string;
}

export interface UseMeetingRecorderResult {
  state: RecorderState;
  elapsed: number;
  errorMsg: string;
  statusMsg: string;
  processingEntry: ProcessingEntry | null;
  usingSystemAudio: boolean;
  systemAudioFailed: boolean;
  startRecording: () => Promise<void>;
  stopAndProcess: () => Promise<void>;
  createThread: (
    recordingId: string,
    createdAt: number,
    workingDirectory: string,
    projectName?: string
  ) => Promise<void>;
  reset: () => void;
}

export function useMeetingRecorder(workingDirectory: string, projectName?: string): UseMeetingRecorderResult {
  const { upsertThread } = useDomainStore();
  const { setSelectedThread } = useUIStore();

  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [processingEntry, setProcessingEntry] = useState<ProcessingEntry | null>(null);
  const [usingSystemAudio, setUsingSystemAudio] = useState(false);
  const [systemAudioFailed, setSystemAudioFailed] = useState(false);

  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const startTimeRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sysStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStreamTracks(micStreamRef.current);
      stopStreamTracks(sysStreamRef.current);
      audioCtxRef.current?.close();
      timerRef.current = null;
      micStreamRef.current = null;
      sysStreamRef.current = null;
      audioCtxRef.current = null;
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      setErrorMsg('');
      setStatusMsg('');
      setSystemAudioFailed(false);
      pcmChunksRef.current = [];

      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      stopStreamTracks(micStreamRef.current);
      stopStreamTracks(sysStreamRef.current);
      micStreamRef.current = null;
      sysStreamRef.current = null;
      audioCtxRef.current?.close();

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const mixer = audioCtx.createGain();

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStreamRef.current = micStream;
        audioCtx.createMediaStreamSource(micStream).connect(mixer);
      } catch (err) {
        audioCtx.close();
        audioCtxRef.current = null;
        const name = err instanceof Error ? err.name : '';
        let msg: string;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          msg = 'Microphone access denied. Please allow microphone access in System Settings.';
        } else if (name === 'NotFoundError') {
          msg = 'No microphone found. Please connect a microphone and try again.';
        } else if (name === 'NotReadableError') {
          msg = 'Microphone is in use by another application. Close it and try again.';
        } else {
          msg = `Failed to access microphone: ${getErrorMessage(err)}`;
        }
        setErrorMsg(msg);
        setState('error');
        return;
      }

      let sysAudioCaptured = false;
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: { width: 1, height: 1 },
        });
        displayStream.getVideoTracks().forEach((t) => t.stop());
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length > 0) {
          sysStreamRef.current = displayStream;
          audioCtx.createMediaStreamSource(new MediaStream(audioTracks)).connect(mixer);
          sysAudioCaptured = true;
        }
      } catch {
        // system audio unavailable — mic-only is fine
      }

      setUsingSystemAudio(sysAudioCaptured);
      setSystemAudioFailed(!sysAudioCaptured);

      try {
        audioCaptureRef.current = await attachAudioCapture(audioCtx, mixer, (chunk) => {
          pcmChunksRef.current.push(chunk);
        });
      } catch (err) {
        stopStreamTracks(micStreamRef.current);
        stopStreamTracks(sysStreamRef.current);
        micStreamRef.current = null;
        sysStreamRef.current = null;
        audioCtx.close();
        audioCtxRef.current = null;
        setErrorMsg(`Failed to start audio capture: ${getErrorMessage(err)}`);
        setState('error');
        return;
      }

      startTimeRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setState('recording');
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    if (!audioCaptureRef.current) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const finalElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const now = new Date();
    const threadName = `Meeting — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

    setState('processing');

    const entry: ProcessingEntry = {
      statusMsg: 'Preparing audio…',
      durationSeconds: finalElapsed,
      createdAt: now.getTime(),
    };
    setProcessingEntry(entry);

    const modelReady = await window.electronAPI.audio.modelReady().catch(() => ({ ready: true }));
    const transcribeMsg = modelReady.ready ? 'Transcribing audio…' : 'Downloading STT model (~150 MB, first run only)…';
    setStatusMsg(transcribeMsg);
    setProcessingEntry((prev) => (prev ? { ...prev, statusMsg: transcribeMsg } : null));

    audioCaptureRef.current.stop();
    audioCaptureRef.current = null;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;

    stopStreamTracks(micStreamRef.current);
    stopStreamTracks(sysStreamRef.current);
    micStreamRef.current = null;
    sysStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    if (pcmChunksRef.current.length === 0) {
      setProcessingEntry(null);
      setErrorMsg('No audio was captured.');
      setState('error');
      return;
    }

    setStatusMsg('Preparing audio…');
    setProcessingEntry((prev) => (prev ? { ...prev, statusMsg: 'Preparing audio…' } : null));
    let resampled: Float32Array;
    try {
      resampled = await resamplePcmTo16kHz(pcmChunksRef.current, sampleRate);
    } catch (err) {
      setProcessingEntry(null);
      setErrorMsg(`Audio processing failed: ${getErrorMessage(err)}`);
      setState('error');
      return;
    }
    pcmChunksRef.current = [];
    const arrayBuffer = encodePcmAsWav([resampled], 16000);

    let transcript = '';
    try {
      const result = await window.electronAPI.audio.transcribe(arrayBuffer);
      transcript = result.text.trim();
    } catch (err) {
      setProcessingEntry(null);
      setErrorMsg(`Transcription failed: ${getErrorMessage(err)}`);
      setState('error');
      return;
    }

    if (!transcript) {
      setProcessingEntry(null);
      setErrorMsg('No speech detected in the recording.');
      setState('error');
      return;
    }

    let recordingId: string;
    try {
      setStatusMsg('Saving recording…');
      setProcessingEntry((prev) => (prev ? { ...prev, statusMsg: 'Saving recording…' } : null));
      const savedResult = await window.electronAPI.files.saveRecording({
        duration: finalElapsed,
        arrayBuffer,
        transcript,
      });
      recordingId = savedResult.recordingId;
      setProcessingEntry((prev) => (prev ? { ...prev, recordingId } : null));
    } catch (err) {
      setProcessingEntry(null);
      setErrorMsg(`Failed to save recording: ${getErrorMessage(err)}`);
      setState('error');
      return;
    }

    if (!workingDirectory) {
      setProcessingEntry(null);
      setState('idle');
      setElapsed(0);
      return;
    }

    setStatusMsg('Creating meeting thread…');
    setProcessingEntry((prev) => (prev ? { ...prev, statusMsg: 'Creating meeting thread…' } : null));
    try {
      const thread = await window.electronAPI.thread.create({
        name: threadName,
        workingDirectory,
        projectName: projectName?.trim() || undefined,
      });
      await window.electronAPI.files.setRecordingThread({ recordingId, threadId: thread.id }).catch((): null => null);
      upsertThread({ ...thread, logBuffer: [], recordingId });
      await window.electronAPI.terminal.sendInput({
        threadId: thread.id,
        input: `/meeting-notes\nrecording_id: ${recordingId}\n`,
      });
      setSelectedThread(thread.id);
    } catch (err) {
      setProcessingEntry(null);
      setErrorMsg(`Failed to create thread: ${getErrorMessage(err)}`);
      setState('error');
      return;
    }

    setProcessingEntry(null);
    setState('idle');
    setElapsed(0);
  }, [workingDirectory, projectName, upsertThread, setSelectedThread]);

  const createThread = useCallback(
    async (recordingId: string, createdAt: number, wDir: string, pName?: string) => {
      const d = new Date(createdAt);
      const threadName = `Meeting — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      const thread = await window.electronAPI.thread.create({
        name: threadName,
        workingDirectory: wDir,
        projectName: pName?.trim() || undefined,
      });
      await window.electronAPI.files.setRecordingThread({ recordingId, threadId: thread.id }).catch((): null => null);
      upsertThread({ ...thread, logBuffer: [], recordingId });
      await window.electronAPI.terminal.sendInput({
        threadId: thread.id,
        input: `/meeting-notes\nrecording_id: ${recordingId}\n`,
      });
      setSelectedThread(thread.id);
    },
    [upsertThread, setSelectedThread]
  );

  const reset = useCallback(() => {
    setState('idle');
    setErrorMsg('');
    setStatusMsg('');
    setProcessingEntry(null);
    setElapsed(0);
    setSystemAudioFailed(false);
    pcmChunksRef.current = [];
  }, []);

  return {
    state,
    elapsed,
    errorMsg,
    statusMsg,
    processingEntry,
    usingSystemAudio,
    systemAudioFailed,
    startRecording,
    stopAndProcess,
    createThread,
    reset,
  };
}
