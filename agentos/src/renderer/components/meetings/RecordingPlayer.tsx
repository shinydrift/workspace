import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, CircleNotch, Warning } from '@phosphor-icons/react';
import { cn, formatSeconds } from '@/lib/utils';
import { claimRecordingPlayback, releaseRecordingPlayback } from './recordingPlayback';

interface RecordingPlayerProps {
  recordingId: string;
  durationSeconds: number;
  /** Begin playback as soon as the audio loads (used when picking a timeline segment). */
  autoPlay?: boolean;
  className?: string;
}

/**
 * Inline audio transport for a single recording. Audio bytes are pulled over IPC and wrapped
 * in a Blob URL on first play (lazy — no eager reads), so a long list of rows stays cheap.
 * Mount with a `key={recordingId}` when the id can change to get a clean element + cleanup.
 */
export function RecordingPlayer({ recordingId, durationSeconds, autoPlay = false, className }: RecordingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadPromiseRef = useRef<Promise<HTMLAudioElement | null> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);

  const ensureLoaded = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    if (loadPromiseRef.current) return loadPromiseRef.current;
    setLoading(true);
    setError('');
    const promise = (async () => {
      try {
        const { data } = await window.electronAPI.files.readRecording({ recordingId });
        const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
        urlRef.current = url;
        const audio = new Audio(url);
        audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
        audio.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        });
        audio.addEventListener('ended', () => {
          setPlaying(false);
          setCurrent(0);
        });
        audio.addEventListener('play', () => {
          claimRecordingPlayback(audio);
          setPlaying(true);
        });
        audio.addEventListener('pause', () => setPlaying(false));
        audioRef.current = audio;
        setLoaded(true);
        return audio;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audio');
        return null;
      } finally {
        setLoading(false);
        loadPromiseRef.current = null;
      }
    })();
    loadPromiseRef.current = promise;
    return promise;
  }, [recordingId]);

  const toggle = useCallback(async () => {
    const audio = await ensureLoaded();
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError('Playback failed'));
    else audio.pause();
  }, [ensureLoaded]);

  // Auto-start once on mount when requested (timeline segment selection).
  useEffect(() => {
    if (autoPlay) void toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop playback and release the Blob URL when this player goes away.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        releaseRecordingPlayback(audio);
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current = null;
      urlRef.current = null;
    };
  }, []);

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    setCurrent(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  const total = duration > 0 ? duration : durationSeconds;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? 'Pause' : 'Play'}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors'
        )}
      >
        {loading ? (
          <CircleNotch className="h-3.5 w-3.5 animate-spin" />
        ) : playing ? (
          <Pause weight="fill" className="h-3.5 w-3.5" />
        ) : (
          <Play weight="fill" className="h-3.5 w-3.5" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={total || 1}
        step={0.1}
        value={Math.min(current, total || current)}
        onChange={seek}
        disabled={!loaded && !loading}
        aria-label="Seek"
        className="h-1 flex-1 cursor-pointer accent-blue-500 disabled:cursor-default"
      />

      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatSeconds(Math.floor(current))} / {formatSeconds(Math.floor(total))}
      </span>

      {error && <Warning weight="fill" className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label={error} />}
    </div>
  );
}
