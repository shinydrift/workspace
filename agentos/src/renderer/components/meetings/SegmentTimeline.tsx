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
const NEW_SELECTION_MS = 30 * 60 * 1000; // Clicking an empty area drops a fresh 30-minute slot you can drag to extend.
const HOUR_PX = 48; // Calendar-legible hour height.
const TIMELINE_HEIGHT = (WINDOW_MS / HOUR_MS) * HOUR_PX; // Hourly grid across the retention window.
const MERGE_GAP_MS = 90 * 1000; // Bridge tiny gaps so captured audio reads as one continuous stretch.
const SNAP_MS = 5 * 60 * 1000; // Drag snaps to 5-minute marks; nudges and keyboard steps move by the same unit.
const MIN_GAP_FRAC = SNAP_MS / WINDOW_MS; // Shortest slot you can drag (5 min) — matches the smallest preset.
const NOW_TICK_MS = 30 * 1000; // Keep the "now" edge live while the picker is open.
const TIMELINE_LANE_CLASS = 'inset-x-2';

type DragTarget = 'start' | 'end' | 'block' | 'new' | null;

function fmtRange(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const dayOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const fDay = f.toLocaleDateString('en-US', dayOpts);
  const fTime = f.toLocaleTimeString('en-US', timeOpts);
  const tTime = t.toLocaleTimeString('en-US', timeOpts);
  if (f.toDateString() === t.toDateString()) return `${fDay}, ${fTime}-${tTime}`;
  // Slot spans midnight — show the day on both ends so the range stays unambiguous.
  return `${fDay} ${fTime} - ${t.toLocaleDateString('en-US', dayOpts)} ${tTime}`;
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtHour(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric' });
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Compact clock range shown inside the selection block, e.g. "6:30 PM – 7:30 PM".
function fmtClockRange(from: number, to: number): string {
  return `${fmtClock(from)} – ${fmtClock(to)}`;
}

function clampFrac(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Snap a window fraction to the nearest 5-minute mark, keeping it in range.
function snapFracToGrid(frac: number, from: number): number {
  const snapped = Math.round((from + frac * WINDOW_MS) / SNAP_MS) * SNAP_MS;
  return clampFrac((snapped - from) / WINDOW_MS);
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

function SelectionPlayer({ segments }: { segments: RecordingRecord[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);

  // The parent hands us a fresh array on every drag tick and every "now" tick, even when the
  // overlapping recordings are unchanged. Key resets on the recording identity so playback keeps
  // running while you drag, and only tears down when the underlying saved recordings actually change.
  const segmentKey = useMemo(() => segments.map((s) => s.id).join('|'), [segments]);
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
    [cleanupAudio, segments]
  );

  useEffect(() => {
    setIndex(0);
    setCurrent(0);
    setPlaying(false);
    cleanupAudio(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupAudio, segmentKey]);

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<DragTarget>(null);
  const blockAnchor = useRef<{ grabFrac: number; startFrac: number; endFrac: number } | null>(null);
  const newAnchor = useRef<number | null>(null);
  const newDragged = useRef(false);
  const didScroll = useRef(false);

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const nowRef = useRef(now);
  nowRef.current = now;
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
  const availability = useMemo(() => mergeAvailability(segments), [segments]);
  // Enable Create whenever the slot overlaps captured audio, using the same merged ranges the
  // timeline shades — so a slot sitting inside a bridged gap no longer shows blue yet stays disabled.
  const hasAudio = useMemo(
    () => availability.some((r) => selFrom < r.to && selTo > r.from),
    [availability, selFrom, selTo]
  );

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
  }, [active, open, load]);

  // Keep the "now" edge live while the picker is open. The window slides forward, but the user's
  // chosen absolute times stay put (an end pinned to "now" keeps tracking now).
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      const next = Date.now();
      const shift = (next - nowRef.current) / WINDOW_MS;
      if (shift <= 0) return;
      setNow(next);
      setStartFrac((f) => clampFrac(f - shift));
      setEndFrac((f) => (f >= 1 ? 1 : clampFrac(f - shift)));
    }, NOW_TICK_MS);
    return () => clearInterval(id);
  }, [open]);

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
      const rawFrac = timeFracFromEvent(e.clientY);
      if (dragging.current === 'new') {
        const anchor = newAnchor.current;
        if (anchor == null) return;
        const frac = snapFracToGrid(rawFrac, from);
        if (Math.abs(frac - anchor) >= MIN_GAP_FRAC) newDragged.current = true;
        setStartFrac(Math.min(anchor, frac));
        setEndFrac(Math.max(anchor, frac));
        return;
      }
      if (dragging.current === 'block') {
        const anchor = blockAnchor.current;
        if (!anchor) return;
        const len = anchor.endFrac - anchor.startFrac;
        const nextStart = clampFrac(
          Math.min(snapFracToGrid(anchor.startFrac + (rawFrac - anchor.grabFrac), from), 1 - len)
        );
        setStartFrac(nextStart);
        setEndFrac(nextStart + len);
        return;
      }
      const frac = snapFracToGrid(rawFrac, from);
      if (dragging.current === 'start') setStartFrac(Math.min(frac, endFrac - MIN_GAP_FRAC));
      else setEndFrac(Math.max(frac, startFrac + MIN_GAP_FRAC));
    }
    function onUp() {
      if (dragging.current === 'new' && !newDragged.current && newAnchor.current != null) {
        // A plain click (no meaningful drag) drops a default 30-minute slot at the clicked time.
        const len = NEW_SELECTION_MS / WINDOW_MS;
        const nextStart = clampFrac(Math.min(newAnchor.current, 1 - len));
        setStartFrac(nextStart);
        setEndFrac(nextStart + len);
      }
      dragging.current = null;
      blockAnchor.current = null;
      newAnchor.current = null;
      newDragged.current = false;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [endFrac, from, startFrac, timeFracFromEvent]);

  // On open, jump the timeline to the newest captured audio so recent recordings are in view
  // without scrolling the full retention window. Runs once per open.
  useEffect(() => {
    if (!open) {
      didScroll.current = false;
      return;
    }
    if (didScroll.current || loading || !availability.length) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const newest = availability[availability.length - 1];
    const topPct = posFromFrac(clampFrac((newest.to - from) / WINDOW_MS)) / 100;
    viewport.scrollTop = Math.max(0, topPct * TIMELINE_HEIGHT - 60);
    didScroll.current = true;
  }, [open, loading, availability, from, posFromFrac]);

  function nudge(which: 'start' | 'end', deltaMs: number) {
    const delta = deltaMs / WINDOW_MS;
    if (which === 'start') setStartFrac((v) => Math.min(clampFrac(v + delta), endFrac - MIN_GAP_FRAC));
    else setEndFrac((v) => Math.max(clampFrac(v + delta), startFrac + MIN_GAP_FRAC));
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
            <ScrollArea viewportRef={viewportRef} className="min-h-0 border-r border-border">
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
                    className="relative flex-1 cursor-crosshair rounded-md border border-border bg-muted/20"
                    onPointerDown={(e) => {
                      // Press on an empty area starts a fresh selection; drag to size it, or release
                      // without dragging for a default 30-minute slot.
                      e.preventDefault();
                      const anchor = snapFracToGrid(timeFracFromEvent(e.clientY), from);
                      newAnchor.current = anchor;
                      newDragged.current = false;
                      dragging.current = 'new';
                      setStartFrac(anchor);
                      setEndFrac(anchor);
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
                        <button
                          type="button"
                          key={range.from}
                          title="Select this recorded stretch"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            setStartFrac(clampFrac((range.from - from) / WINDOW_MS));
                            setEndFrac(clampFrac((range.to - from) / WINDOW_MS));
                          }}
                          className={`absolute ${TIMELINE_LANE_CLASS} cursor-pointer rounded-sm border border-blue-400/15 bg-blue-400/10 transition-colors hover:bg-blue-400/20`}
                          style={{ top: `${top}%`, height }}
                        />
                      );
                    })}

                    <div
                      role="button"
                      aria-label="Move meeting slot"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragging.current = 'block';
                        blockAnchor.current = { grabFrac: timeFracFromEvent(e.clientY), startFrac, endFrac };
                      }}
                      className={`absolute ${TIMELINE_LANE_CLASS} cursor-grab overflow-hidden rounded-md border border-blue-400/70 bg-blue-400/20 active:cursor-grabbing`}
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
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((which === 'start' ? startFrac : endFrac) * 100)}
                        aria-valuetext={fmtClock(which === 'start' ? selFrom : selTo)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          const step = (e.shiftKey ? 1 : 5) * 60 * 1000;
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            nudge(which, step);
                          } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            nudge(which, -step);
                          }
                        }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
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
                  <SelectionPlayer segments={selectedSegments} />
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
