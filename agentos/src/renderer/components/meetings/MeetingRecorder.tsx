import React, { useEffect, useState } from 'react';
import { Microphone, Stop, Waveform, VideoCamera } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn, formatSeconds } from '@/lib/utils';
import type { UseMeetingRecorderResult } from '../../hooks/useMeetingRecorder';

interface Props {
  recorder: UseMeetingRecorderResult;
}

export function MeetingRecorder({ recorder }: Props) {
  const {
    state,
    elapsed,
    errorMsg,
    usingSystemAudio,
    systemAudioFailed,
    startRecording,
    stopAndProcess,
    reset,
  } = recorder;

  const [meetingActive, setMeetingActive] = useState(false);

  useEffect(() => {
    const offDetected = window.electronAPI.on.meetingDetected(() => setMeetingActive(true));
    const offEnded = window.electronAPI.on.meetingEnded(() => setMeetingActive(false));
    return () => {
      offDetected();
      offEnded();
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-10">
      {meetingActive && state === 'idle' && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm w-full max-w-sm">
          <VideoCamera className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="flex-1 text-blue-300">Meeting detected in browser</span>
          <Button size="sm" className="shrink-0" onClick={() => void startRecording()}>
            Record
          </Button>
        </div>
      )}
      <div className="relative flex items-center justify-center w-20 h-20">
        {state === 'recording' && <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />}
        <div
          className={cn(
            'w-20 h-20 rounded-full flex items-center justify-center transition-colors',
            state === 'recording' ? 'bg-red-500/15 border-2 border-red-500' : 'bg-muted border-2 border-border'
          )}
        >
          {state === 'recording' ? (
            <Waveform className="h-8 w-8 text-red-500" />
          ) : (
            <Microphone className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
      </div>

      {state === 'recording' && (
        <div className="text-2xl font-mono font-semibold tabular-nums text-foreground">{formatSeconds(elapsed)}</div>
      )}

      {state === 'recording' && (
        <p className={cn('text-xs', usingSystemAudio ? 'text-muted-foreground' : 'text-amber-500')}>
          {usingSystemAudio ? 'Mic + system audio' : 'Mic only — system audio unavailable'}
        </p>
      )}

      {state === 'idle' && systemAudioFailed && (
        <p className="text-xs text-amber-500 text-center max-w-xs">
          System audio unavailable. Grant Screen Recording permission to capture meeting audio.
        </p>
      )}

      {(state === 'idle' || state === 'processing') && (
        <Button onClick={() => void startRecording()} className="gap-2 px-6" disabled={state === 'processing'}>
          <Microphone className="h-4 w-4" />
          Start Recording
        </Button>
      )}

      {state === 'recording' && (
        <Button onClick={() => void stopAndProcess()} variant="destructive" className="gap-2 px-6">
          <Stop className="h-4 w-4" />
          Stop & Generate Notes
        </Button>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive text-center max-w-sm">{errorMsg}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try Again
          </Button>
        </div>
      )}

      {state === 'idle' && (
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Records mic{' '}
          {usingSystemAudio ? '+ system audio' : '(+ system audio if Screen Recording permission is granted)'}. When
          stopped, AgentOS transcribes locally and sends notes to a new Claude thread.
        </p>
      )}
    </div>
  );
}
