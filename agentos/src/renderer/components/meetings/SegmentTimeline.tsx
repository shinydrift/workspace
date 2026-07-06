import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarBlank, CircleNotch, Pause, Play, Warning, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { formatSeconds } from '@/lib/utils';
import type { RecordingRecord, SavedProject } from '../../../shared/types';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import { claimRecordingPlayback, releaseRecordingPlayback } from './recordingPlayback';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;
const DEFAULT_SELECTION_MS = HOUR_MS;
const HOUR_PX = 48; // Calendar-legible hour height.
const TIMELINE_HEIGHT = (WINDOW_MS / HOUR_MS) * HOUR_PX; // Hourly grid across the retention window.
const MERGE_GAP_MS = 90 * 1000; // Bridge tiny gaps so captured audio reads as one continuous stretch.
const TIMELINE_LANE_CLASS = 'inset-x-2';

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

function fmtHour(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric' });
}

// Compact clock range shown inside the selection block, e.g. "6:30 PM – 7:30 PM".
function fmtClockRange(from: number, to: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${new Date(from).toLocaleTimeString('en-US', opts)} – ${new Date(to).toLocaleTimeString('en-US', opts)}`;
}

function clampFrac(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlaps(segment: RecordingRecord, from: number, to: number): boolean {
  return segment.createdAt < to && segment.createdAt + segment.durationSeconds * 1000 > from;
}

/**
 * Collapse the underlying capture clips into continuous availability ranges so the timeline shows
 * "there is audio here" without ever exposing individual clip boundaries.
 */
function mergeAvailability(segments: RecordingRecord[]): Array<{ from: number; to: number }> {
  const sorted = [...segments].sort((a, b) => a.createdAt - b.createdAt);
  const ranges: Array<{ from: number; to: number }> = [];
  for (const s of sorted) {
    const start = s.createdAt;
    const end = s.createdAt + s.durationSeconds * 1000;
    const last = ranges[ranges.length - 1];
    if (last && start - last.to <= MERGE_GAP_MS) last.to = Math.max(last.to, end);
    else ranges.push({ from: start, to: end });
  }
  return ranges;
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

  const totalDuration = useMemo(() => segments.reduce((sum, s) => sum + s.durationSeconds, 0), [segments]);
  const elapsedBefore = useMemo(
    () => segments.slice(0, index).reduce((sum, s) => sum + s.durationSeconds, 0),
    [index, segments]
  );
  const windowCurrent = elapsedBefore + current;

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

  // Play the clip at nextIndex, optionally starting partway in. The underlying clips are stitched
  // into one continuous stream — callers address time by window position, never by clip.
  const playIndex = useCallback(
    async (nextIndex: number, shouldPlay = true, startAt = 0) => {
      const segment = segments[nextIndex];
      if (!segment) return;
      const token = ++loadTokenRef.current;
      cleanupAudio();
      setIndex(nextIndex);
      setCurrent(startAt);
      setLoading(true);
      setError('');
      onFocusSegment(segment);
      try {
        const { data } = await window.electronAPI.files.readRecording({ recordingId: segment.id });
        if (token !== loadTokenRef.current) return;
        const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
        urlRef.current = url;
        const audio = new Audio(url);
        if (startAt > 0) audio.currentTime = startAt;
        audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
        audio.addEventListener('loadedmetadata', () => {
          if (startAt > 0) audio.currentTime = startAt;
        });
        audio.addEventListener('ended', () => {
          if (nextIndex + 1 < segments.length) {
            void playIndex(nextIndex + 1, true);
          } else {
            cleanupAudio();
            setPlaying(false);
            setIndex(0);
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
    setIndex(0);
    setCurrent(0);
    setPlaying(false);
    cleanupAudio(true);
  }, [cleanupAudio, segments]);

  useEffect(() => () => cleanupAudio(true), [cleanupAudio]);

  function toggle() {
    if (!segments.length) return;
    if (!audioRef.current) {
      void playIndex(index, true);
      return;
    }
    if (audioRef.current.paused) void audioRef.current.play().catch(() => setError('Playback failed'));
    else audioRef.current.pause();
  }

  // Map a window-relative position back to the clip that holds it, then seek there transparently.
  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const target = Number(e.target.value);
    let acc = 0;
    let j = 0;
    for (; j < segments.length - 1; j++) {
      if (target < acc + segments[j].durationSeconds) break;
      acc += segments[j].durationSeconds;
    }
    const offset = Math.max(0, target - acc);
    if (j === index && audioRef.current) {
      audioRef.current.currentTime = offset;
      setCurrent(offset);
    } else {
      void playIndex(j, playing, offset);
    }
  }

  const progressLabel = `${formatSeconds(Math.floor(windowCurrent))} / ${formatSeconds(Math.floor(totalDuration))}`;

  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          {!segments.length && <p className="text-[11px] text-muted-foreground truncate">No audio in this window</p>}
        </div>
        <Button
          type="button"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!segments.length || loading}
          onClick={toggle}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {loading ? (
            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
          ) : playing ? (
            <Pause weight="fill" className="h-3.5 w-3.5" />
          ) : (
            <Play weight="fill" className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          step={0.1}
          value={Math.min(windowCurrent, totalDuration || windowCurrent)}
          onChange={seek}
          disabled={!segments.length}
          aria-label="Seek preview"
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
 * Calendar-style picker over always-on capture. Captured audio stays invisible in the background;
 * here the user drags a meeting slot on a newest-first timeline and turns it into a meeting thread.
 * The underlying clips are an implementation detail — never surfaced as counts or blocks.
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

  const from = now - WINDOW_MS;
  const selFrom = Math.round(from + startFrac * WINDOW_MS);
  const selTo = Math.round(from + endFrac * WINDOW_MS);
  const selectedSegments = useMemo(
    () => segments.filter((s) => overlaps(s, selFrom, selTo)),
    [segments, selFrom, selTo]
  );
  const selectedDuration = Math.max(0, Math.round((selTo - selFrom) / 1000));
  const availability = useMemo(() => mergeAvailability(segments), [segments]);
  const hasAudio = selectedSegments.length > 0;

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

  // Vertical position on the newest-first axis: top of the track is now, bottom is 7 days ago.
  const posFromFrac = useCallback((frac: number): number => (1 - frac) * 100, []);
  // Read a time-fraction (0 = oldest edge, 1 = now) from a pointer's vertical position.
  const timeFracFromEvent = useCallback((clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 1;
    return clampFrac(1 - (clientY - rect.top) / rect.height);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const frac = timeFracFromEvent(e.clientY);
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
  }, [endFrac, startFrac, timeFracFromEvent]);

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

  async function createMeeting() {
    if (!defaultProject) return;
    setBusy(true);
    setError('');
    try {
      const name = `Meeting - ${fmtRange(selFrom, selTo)}`;
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

  const hourMarks: Array<{ ts: number; isDay: boolean }> = [];
  for (let ts = Math.ceil(from / HOUR_MS) * HOUR_MS; ts <= now; ts += HOUR_MS) {
    hourMarks.push({ ts, isDay: new Date(ts).getHours() === 0 });
  }

  return (
    <>
      <div className="mx-4 mb-4 rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <CalendarBlank className="h-3.5 w-3.5 text-blue-400" />
              Meetings
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {active ? 'Pick a time to turn into a meeting' : 'Recent audio you can turn into a meeting'}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => setOpen(true)}>
            <CalendarBlank className="h-3.5 w-3.5" />
            New meeting
          </Button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent hideClose className="w-[1040px] max-w-[96vw] gap-0 p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarBlank size={16} className="text-blue-400" />
              <SheetTitle>New meeting</SheetTitle>
              {loading && <CircleNotch className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />}
              <span className="text-xs text-muted-foreground truncate">{fmtRange(selFrom, selTo)}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_320px] overflow-hidden">
            <ScrollArea className="min-h-0 border-r border-border">
              <div className="p-5">
                <div className="flex gap-2" style={{ height: TIMELINE_HEIGHT }}>
                  <div className="relative w-20 shrink-0">
                    {hourMarks.map(({ ts, isDay }) => (
                      <span
                        key={ts}
                        className={`absolute right-1.5 -translate-y-1/2 whitespace-nowrap text-[11px] ${
                          isDay ? 'font-semibold text-foreground/80' : 'text-muted-foreground/70'
                        }`}
                        style={{ top: `${posFromFrac((ts - from) / WINDOW_MS)}%` }}
                      >
                        {isDay ? fmtDay(ts) : fmtHour(ts)}
                      </span>
                    ))}
                  </div>
                  <div
                    ref={trackRef}
                    className="relative flex-1 rounded-md border border-border bg-muted/20"
                    onDoubleClick={(e) => {
                      const frac = timeFracFromEvent(e.clientY);
                      const distanceToStart = Math.abs(frac - startFrac);
                      const distanceToEnd = Math.abs(frac - endFrac);
                      if (distanceToEnd < distanceToStart) setEndFrac(Math.max(frac, startFrac + 0.002));
                      else setStartFrac(Math.min(frac, endFrac - 0.002));
                    }}
                  >
                    {hourMarks.map(({ ts, isDay }) => (
                      <div
                        key={ts}
                        className={`absolute inset-x-0 border-t ${isDay ? 'border-border' : 'border-border/40'}`}
                        style={{ top: `${posFromFrac((ts - from) / WINDOW_MS)}%` }}
                      />
                    ))}

                    {availability.map((range) => {
                      const topFrac = clampFrac((range.to - from) / WINDOW_MS);
                      const botFrac = clampFrac((range.from - from) / WINDOW_MS);
                      const top = posFromFrac(topFrac);
                      const height = Math.max(6, (topFrac - botFrac) * TIMELINE_HEIGHT);
                      return (
                        <div
                          key={range.from}
                          className={`absolute ${TIMELINE_LANE_CLASS} rounded-sm border border-blue-400/15 bg-blue-400/10 pointer-events-none`}
                          style={{ top: `${top}%`, height }}
                        />
                      );
                    })}

                    <div
                      className={`absolute ${TIMELINE_LANE_CLASS} overflow-hidden rounded-md border border-blue-400/70 bg-blue-400/20 pointer-events-none`}
                      style={{ top: `${posFromFrac(endFrac)}%`, height: `${(endFrac - startFrac) * 100}%` }}
                    >
                      <p className="whitespace-nowrap px-2 py-1 text-[11px] font-medium text-foreground/90">
                        {fmtClockRange(selFrom, selTo)}
                      </p>
                    </div>

                    {(['start', 'end'] as const).map((which) => (
                      <div
                        key={which}
                        role="slider"
                        aria-label={which === 'end' ? 'Meeting end' : 'Meeting start'}
                        aria-valuenow={Math.round((which === 'start' ? startFrac : endFrac) * 100)}
                        tabIndex={0}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          dragging.current = which;
                        }}
                        className={`absolute ${TIMELINE_LANE_CLASS} z-10 -mt-2 h-4 cursor-ns-resize`}
                        style={{ top: `${posFromFrac(which === 'start' ? startFrac : endFrac)}%` }}
                      >
                        <div className="h-1 rounded-full bg-blue-400 shadow-sm" />
                      </div>
                    ))}

                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 -translate-y-1/2"
                      style={{ top: `${posFromFrac(1)}%` }}
                    >
                      <div className="relative h-0.5 bg-red-500">
                        <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="flex min-h-0 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-3 p-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick length</p>
                    <div className="grid grid-cols-5 gap-1">
                      {PRESETS.map((preset) => (
                        <Button
                          key={preset.label}
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 px-1.5 text-xs"
                          onClick={() => applyPreset(preset)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border/70 bg-muted/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">Meeting slot</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{fmtRange(selFrom, selTo)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] text-muted-foreground">Length</p>
                        <p className="mt-1 tabular-nums text-xs text-foreground">{formatSeconds(selectedDuration)}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 justify-start px-2 text-xs"
                        onClick={() => nudge('start', -5 * 60 * 1000)}
                      >
                        Start -5m
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 justify-start px-2 text-xs"
                        onClick={() => nudge('start', 5 * 60 * 1000)}
                      >
                        Start +5m
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 justify-start px-2 text-xs"
                        onClick={() => nudge('end', -5 * 60 * 1000)}
                      >
                        End -5m
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 justify-start px-2 text-xs"
                        onClick={() => nudge('end', 5 * 60 * 1000)}
                      >
                        End +5m
                      </Button>
                    </div>
                  </div>

                  <SelectionPlayer segments={selectedSegments} onFocusSegment={() => {}} />
                  {!hasAudio && (
                    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      No captured audio in this slot yet.
                    </p>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t border-border p-4">
                {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
                <Button
                  type="button"
                  className="w-full gap-1"
                  disabled={busy || !hasAudio || !defaultProject}
                  onClick={() => void createMeeting()}
                >
                  {busy ? (
                    <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarBlank className="h-3.5 w-3.5" />
                  )}
                  Create meeting
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
