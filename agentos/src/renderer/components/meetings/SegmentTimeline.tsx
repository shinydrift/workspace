import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, CaretUp, CircleNotch, Pause, Play, Timer, WaveTriangle, Warning, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn, formatSeconds } from '@/lib/utils';
import type { RecordingRecord, SavedProject } from '../../../shared/types';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import { claimRecordingPlayback, releaseRecordingPlayback } from './recordingPlayback';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;
const DEFAULT_SELECTION_MS = HOUR_MS;
const TIMELINE_HEIGHT = 3024; // 18px/hour across the 7-day retention window.

type DragTarget = 'start' | 'end' | null;

const PRESETS: Array<{ label: string; ms?: number; today?: boolean }> = [
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: HOUR_MS },
  { label: '3h', ms: 3 * HOUR_MS },
  { label: 'Today', today: true },
];

function fmtRange(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const day = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${day}, ${f.toLocaleTimeString('en-US', opts)}-${t.toLocaleTimeString('en-US', opts)}`;
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function clampFrac(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlaps(segment: RecordingRecord, from: number, to: number): boolean {
  return segment.createdAt < to && segment.createdAt + segment.durationSeconds * 1000 > from;
}

function segmentEnd(segment: RecordingRecord): number {
  return segment.createdAt + segment.durationSeconds * 1000;
}

interface SegmentTimelineProps {
  defaultProject: SavedProject | null;
  active: boolean;
}

function SelectionPlayer({
  segments,
  onFocusSegment,
}: {
  segments: RecordingRecord[];
  onFocusSegment: (segment: RecordingRecord) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(segments[0]?.durationSeconds ?? 0);

  const currentSegment = segments[index] ?? null;
  const totalDuration = useMemo(() => segments.reduce((sum, s) => sum + s.durationSeconds, 0), [segments]);
  const elapsedBefore = useMemo(
    () => segments.slice(0, index).reduce((sum, s) => sum + s.durationSeconds, 0),
    [index, segments]
  );

  const cleanupAudio = useCallback((invalidateLoad = false) => {
    if (invalidateLoad) loadTokenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      releaseRecordingPlayback(audio);
    }
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const playIndex = useCallback(
    async (nextIndex: number, shouldPlay = true) => {
      const segment = segments[nextIndex];
      if (!segment) return;
      const token = ++loadTokenRef.current;
      cleanupAudio();
      setIndex(nextIndex);
      setCurrent(0);
      setDuration(segment.durationSeconds);
      setLoading(true);
      setError('');
      onFocusSegment(segment);
      try {
        const { data } = await window.electronAPI.files.readRecording({ recordingId: segment.id });
        if (token !== loadTokenRef.current) return;
        const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
        urlRef.current = url;
        const audio = new Audio(url);
        audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
        audio.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        });
        audio.addEventListener('ended', () => {
          if (nextIndex + 1 < segments.length) {
            void playIndex(nextIndex + 1, true);
          } else {
            setPlaying(false);
            setCurrent(0);
          }
        });
        audio.addEventListener('play', () => setPlaying(true));
        audio.addEventListener('play', () => claimRecordingPlayback(audio));
        audio.addEventListener('pause', () => setPlaying(false));
        audioRef.current = audio;
        if (shouldPlay) void audio.play().catch(() => setError('Playback failed'));
      } catch (err) {
        if (token === loadTokenRef.current) setError(err instanceof Error ? err.message : 'Failed to load audio');
      } finally {
        if (token === loadTokenRef.current) setLoading(false);
      }
    },
    [cleanupAudio, onFocusSegment, segments]
  );

  useEffect(() => {
    if (index >= segments.length) setIndex(0);
    setDuration(segments[0]?.durationSeconds ?? 0);
    setCurrent(0);
    setPlaying(false);
    cleanupAudio(true);
  }, [cleanupAudio, index, segments]);

  useEffect(() => () => cleanupAudio(true), [cleanupAudio]);

  function toggle() {
    if (!currentSegment) return;
    if (!audioRef.current) {
      void playIndex(index, true);
      return;
    }
    if (audioRef.current.paused) void audioRef.current.play().catch(() => setError('Playback failed'));
    else audioRef.current.pause();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    setCurrent(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  const windowCurrent = elapsedBefore + current;
  const progressLabel = `${formatSeconds(Math.floor(windowCurrent))} / ${formatSeconds(Math.floor(totalDuration))}`;

  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Selection playback</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {currentSegment
              ? `Segment ${index + 1} of ${segments.length} · ${new Date(currentSegment.createdAt).toLocaleTimeString(
                  'en-US',
                  { hour: 'numeric', minute: '2-digit' }
                )}`
              : 'No recorded audio in this selection'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index <= 0 || loading}
            onClick={() => void playIndex(index - 1, playing)}
            aria-label="Previous segment"
          >
            <CaretUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="h-8 w-8"
            disabled={!currentSegment || loading}
            onClick={toggle}
            aria-label={playing ? 'Pause selection' : 'Play selection'}
          >
            {loading ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            ) : playing ? (
              <Pause weight="fill" className="h-3.5 w-3.5" />
            ) : (
              <Play weight="fill" className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index >= segments.length - 1 || loading}
            onClick={() => void playIndex(index + 1, playing)}
            aria-label="Next segment"
          >
            <CaretDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(current, duration || current)}
          onChange={seek}
          disabled={!audioRef.current}
          aria-label="Seek current segment"
          className="h-1 flex-1 cursor-pointer accent-blue-500 disabled:cursor-default"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{progressLabel}</span>
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
          <Warning className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Sheet-based browser for always-on capture segments. The visible panel stays compact;
 * the sheet owns time-window selection, sparse/gap visibility, playback, and summarizing.
 */
export function SegmentTimeline({ defaultProject, active }: SegmentTimelineProps) {
  const { upsertThread } = useDomainStore();
  const { setSelectedThread } = useUIStore();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<DragTarget>(null);

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [segments, setSegments] = useState<RecordingRecord[]>([]);
  const [startFrac, setStartFrac] = useState(1 - DEFAULT_SELECTION_MS / WINDOW_MS);
  const [endFrac, setEndFrac] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const from = now - WINDOW_MS;
  const selFrom = Math.round(from + startFrac * WINDOW_MS);
  const selTo = Math.round(from + endFrac * WINDOW_MS);
  const selectedSegments = useMemo(
    () => segments.filter((s) => overlaps(s, selFrom, selTo)),
    [segments, selFrom, selTo]
  );
  const selectedDuration = Math.max(0, Math.round((selTo - selFrom) / 1000));
  const latestSegment = segments[segments.length - 1] ?? null;

  const load = useCallback(async () => {
    const t = Date.now();
    setLoading(true);
    const list = await window.electronAPI.files
      .listSegments({ from: t - WINDOW_MS, to: t })
      .catch(() => [] as RecordingRecord[]);
    setNow(t);
    setSegments(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [active, load]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const fracFromEvent = useCallback((clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    return clampFrac((clientY - rect.top) / rect.height);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const frac = fracFromEvent(e.clientY);
      if (dragging.current === 'start') setStartFrac(Math.min(frac, endFrac - 0.002));
      else setEndFrac(Math.max(frac, startFrac + 0.002));
    }
    function onUp() {
      dragging.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [endFrac, fracFromEvent, startFrac]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const nextFrom = preset.today ? Math.max(from, startOfToday.getTime()) : now - (preset.ms ?? DEFAULT_SELECTION_MS);
    setStartFrac(clampFrac((nextFrom - from) / WINDOW_MS));
    setEndFrac(1);
  }

  function nudge(which: 'start' | 'end', deltaMs: number) {
    const delta = deltaMs / WINDOW_MS;
    if (which === 'start') setStartFrac((v) => Math.min(clampFrac(v + delta), endFrac - 0.002));
    else setEndFrac((v) => Math.max(clampFrac(v + delta), startFrac + 0.002));
  }

  async function summarize() {
    if (!defaultProject) return;
    setBusy(true);
    setError('');
    try {
      const name = `Discussion - ${fmtRange(selFrom, selTo)}`;
      const thread = await window.electronAPI.thread.create({
        name,
        workingDirectory: defaultProject.path,
        projectName: defaultProject.name?.trim() || undefined,
      });
      upsertThread({ ...thread, logBuffer: [] });
      await window.electronAPI.terminal.sendInput({
        threadId: thread.id,
        input: `/meeting-notes\nwindow_from: ${selFrom}\nwindow_to: ${selTo}\n`,
      });
      setSelectedThread(thread.id);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setBusy(false);
    }
  }

  if (!active && segments.length === 0) return null;

  const dayLines = Array.from({ length: 8 }, (_, i) => from + i * DAY_MS);

  return (
    <>
      <div className="mx-4 mb-4 rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <Timer className="h-3.5 w-3.5 text-blue-400" />
              Capture timeline
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {segments.length === 0
                ? active
                  ? 'Waiting for the first spoken segment'
                  : 'No retained segments'
                : `${segments.length} retained segment${segments.length === 1 ? '' : 's'} · latest ${new Date(
                    latestSegment?.createdAt ?? Date.now()
                  ).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => setOpen(true)}>
            <WaveTriangle className="h-3.5 w-3.5" />
            Open capture timeline
          </Button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent hideClose className="w-[1040px] max-w-[96vw] gap-0 p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <WaveTriangle size={16} className="text-blue-400" />
              <SheetTitle>Capture Timeline</SheetTitle>
              {loading && <CircleNotch className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />}
              <span className="text-xs text-muted-foreground truncate">{fmtRange(selFrom, selTo)}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
              aria-label="Close capture timeline"
            >
              <X size={16} />
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_340px] overflow-hidden">
            <ScrollArea className="min-h-0 border-r border-border">
              <div className="p-5">
                <div
                  ref={trackRef}
                  className="relative rounded-md border border-border bg-muted/20"
                  style={{ height: TIMELINE_HEIGHT }}
                  onDoubleClick={(e) => {
                    const frac = fracFromEvent(e.clientY);
                    const distanceToStart = Math.abs(frac - startFrac);
                    const distanceToEnd = Math.abs(frac - endFrac);
                    if (distanceToStart < distanceToEnd) setStartFrac(Math.min(frac, endFrac - 0.002));
                    else setEndFrac(Math.max(frac, startFrac + 0.002));
                  }}
                >
                  {dayLines.map((ts, i) => (
                    <div
                      key={ts}
                      className="absolute left-0 right-0 border-t border-border/50"
                      style={{ top: `${(i / 7) * 100}%` }}
                    >
                      {i < 7 && (
                        <span className="absolute left-3 top-1 text-[11px] font-medium text-muted-foreground/80">
                          {fmtDay(ts)}
                        </span>
                      )}
                    </div>
                  ))}

                  {segments.map((segment) => {
                    const top = ((segment.createdAt - from) / WINDOW_MS) * 100;
                    const height = Math.max(12, ((segment.durationSeconds * 1000) / WINDOW_MS) * TIMELINE_HEIGHT);
                    const isSelected = overlaps(segment, selFrom, selTo);
                    const isFocused = focusedId === segment.id;
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => {
                          setFocusedId(segment.id);
                          setStartFrac(clampFrac((segment.createdAt - from) / WINDOW_MS));
                          setEndFrac(clampFrac((segmentEnd(segment) - from) / WINDOW_MS));
                        }}
                        className={cn(
                          'absolute left-28 right-5 rounded-sm border px-2 text-left transition-colors',
                          isSelected
                            ? 'border-blue-400/70 bg-blue-500/25 text-blue-100'
                            : 'border-border bg-background/70 text-muted-foreground hover:bg-accent/50',
                          isFocused && 'ring-1 ring-blue-300'
                        )}
                        style={{ top: `${top}%`, height }}
                        title={`${new Date(segment.createdAt).toLocaleString()} - ${formatSeconds(
                          segment.durationSeconds
                        )}`}
                      >
                        <span className="block truncate text-[11px]">
                          {new Date(segment.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          · {formatSeconds(segment.durationSeconds)}
                        </span>
                      </button>
                    );
                  })}

                  <div
                    className="absolute left-20 right-2 rounded-md border border-blue-400/70 bg-blue-400/10 pointer-events-none"
                    style={{ top: `${startFrac * 100}%`, height: `${(endFrac - startFrac) * 100}%` }}
                  />

                  {(['start', 'end'] as const).map((which) => (
                    <div
                      key={which}
                      role="slider"
                      aria-label={`${which} of capture window`}
                      aria-valuenow={Math.round((which === 'start' ? startFrac : endFrac) * 100)}
                      tabIndex={0}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        dragging.current = which;
                      }}
                      className="absolute left-16 right-2 z-10 -mt-2 h-4 cursor-ns-resize"
                      style={{ top: `${(which === 'start' ? startFrac : endFrac) * 100}%` }}
                    >
                      <div className="h-1 rounded-full bg-blue-400 shadow-sm" />
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>

            <div className="flex min-h-0 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick window</p>
                    <div className="grid grid-cols-5 gap-1">
                      {PRESETS.map((preset) => (
                        <Button
                          key={preset.label}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => applyPreset(preset)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-foreground">Selected window</p>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtRange(selFrom, selTo)}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-background/70 p-2">
                        <p className="text-muted-foreground">Duration</p>
                        <p className="mt-1 tabular-nums text-foreground">{formatSeconds(selectedDuration)}</p>
                      </div>
                      <div className="rounded-md bg-background/70 p-2">
                        <p className="text-muted-foreground">Segments</p>
                        <p className="mt-1 tabular-nums text-foreground">{selectedSegments.length}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => nudge('start', -5 * 60 * 1000)}>
                        Start -5m
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => nudge('start', 5 * 60 * 1000)}>
                        Start +5m
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => nudge('end', -5 * 60 * 1000)}>
                        End -5m
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => nudge('end', 5 * 60 * 1000)}>
                        End +5m
                      </Button>
                    </div>
                  </div>

                  <SelectionPlayer segments={selectedSegments} onFocusSegment={(segment) => setFocusedId(segment.id)} />

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Selected segments
                    </p>
                    {selectedSegments.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        No captured speech overlaps this window.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {selectedSegments.map((segment) => (
                          <button
                            key={segment.id}
                            type="button"
                            onClick={() => setFocusedId(segment.id)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
                              focusedId === segment.id
                                ? 'border-blue-400/70 bg-blue-500/15'
                                : 'border-border bg-background/60 hover:bg-accent/40'
                            )}
                          >
                            <span className="min-w-0 truncate">
                              {new Date(segment.createdAt).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {formatSeconds(segment.durationSeconds)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>

              <div className="border-t border-border p-4">
                {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
                <Button
                  type="button"
                  className="w-full gap-1"
                  disabled={busy || selectedSegments.length === 0 || !defaultProject}
                  onClick={() => void summarize()}
                >
                  {busy ? (
                    <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <WaveTriangle className="h-3.5 w-3.5" />
                  )}
                  Summarize selected window
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
