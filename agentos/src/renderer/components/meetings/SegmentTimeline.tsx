import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleNotch, WaveTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RecordingRecord, SavedProject } from '../../../shared/types';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS; // retention window — the full pickable span
const DEFAULT_SELECTION_MS = 60 * 60 * 1000; // last hour, pre-selected

function fmtRange(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const day = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${day}, ${f.toLocaleTimeString('en-US', opts)}–${t.toLocaleTimeString('en-US', opts)}`;
}

interface SegmentTimelineProps {
  defaultProject: SavedProject | null;
  active: boolean;
}

/**
 * Visual 7-day timeline of continuous-capture segments. Drag the start/end handles to
 * pick a time slot, then spawn a thread that summarizes just that window via /meeting-notes.
 */
export function SegmentTimeline({ defaultProject, active }: SegmentTimelineProps) {
  const { upsertThread } = useDomainStore();
  const { setSelectedThread } = useUIStore();
  const trackRef = useRef<HTMLDivElement>(null);

  const [now, setNow] = useState(() => Date.now());
  const [segments, setSegments] = useState<RecordingRecord[]>([]);
  const [startFrac, setStartFrac] = useState(1 - DEFAULT_SELECTION_MS / WINDOW_MS);
  const [endFrac, setEndFrac] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dragging = useRef<'start' | 'end' | null>(null);

  const from = now - WINDOW_MS;
  const load = useCallback(async () => {
    const t = Date.now();
    const list = await window.electronAPI.files
      .listSegments({ from: t - WINDOW_MS, to: t })
      .catch(() => [] as RecordingRecord[]);
    setNow(t);
    setSegments(list);
  }, []);

  // Load on mount and whenever capture toggles — past segments stay pickable for 7 days
  // even after capture is turned off.
  useEffect(() => {
    void load();
  }, [active, load]);

  const selFrom = Math.round(from + startFrac * WINDOW_MS);
  const selTo = Math.round(from + endFrac * WINDOW_MS);
  const selectedCount = segments.filter(
    (s) => s.createdAt < selTo && s.createdAt + s.durationSeconds * 1000 > selFrom
  ).length;

  const fracFromEvent = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const frac = fracFromEvent(e.clientX);
      if (dragging.current === 'start') setStartFrac(Math.min(frac, endFrac - 0.005));
      else setEndFrac(Math.max(frac, startFrac + 0.005));
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
  }, [startFrac, endFrac, fracFromEvent]);

  async function summarize() {
    if (!defaultProject) return;
    setBusy(true);
    setError('');
    try {
      const name = `Discussion — ${fmtRange(selFrom, selTo)}`;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setBusy(false);
    }
  }

  // Nothing captured yet and capture is off — keep the panel uncluttered.
  if (!active && segments.length === 0) return null;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timeline (last 7 days)</p>
        <span className="text-xs text-muted-foreground">{fmtRange(selFrom, selTo)}</span>
      </div>

      <div ref={trackRef} className="relative h-12 rounded-md bg-muted/50 border border-border select-none">
        {/* day gridlines */}
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/40"
            style={{ left: `${(i / 7) * 100}%` }}
          />
        ))}

        {/* segment blocks */}
        {segments.map((s) => {
          const left = ((s.createdAt - from) / WINDOW_MS) * 100;
          const width = Math.max(0.4, ((s.durationSeconds * 1000) / WINDOW_MS) * 100);
          return (
            <div
              key={s.id}
              className="absolute top-2 bottom-2 rounded-sm bg-blue-500/60"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={new Date(s.createdAt).toLocaleString()}
            />
          );
        })}

        {/* selection band */}
        <div
          className="absolute top-0 bottom-0 bg-blue-400/15 border-x-2 border-blue-400"
          style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
        />

        {/* handles */}
        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            role="slider"
            aria-label={`${which} of time slot`}
            aria-valuenow={Math.round((which === 'start' ? startFrac : endFrac) * 100)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = which;
            }}
            className={cn(
              'absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize flex items-center justify-center',
              'after:content-[""] after:w-1 after:h-6 after:rounded-full after:bg-blue-400'
            )}
            style={{ left: `${(which === 'start' ? startFrac : endFrac) * 100}%` }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">
          {selectedCount === 0
            ? 'No segments in this slot'
            : `${selectedCount} segment${selectedCount === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-destructive max-w-[200px] truncate">{error}</span>}
          <Button
            size="sm"
            className="gap-1"
            disabled={busy || selectedCount === 0 || !defaultProject}
            onClick={() => void summarize()}
          >
            {busy ? <CircleNotch className="h-3 w-3 animate-spin" /> : <WaveTriangle className="h-3 w-3" />}
            Summarize this slot
          </Button>
        </div>
      </div>
    </div>
  );
}
