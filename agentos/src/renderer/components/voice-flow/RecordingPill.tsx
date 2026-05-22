import React, { useEffect, useRef, useState } from 'react';
import { cn, formatSeconds } from '@/lib/utils';
import type { VoiceFlowState } from '@/hooks/useVoiceFlow';

const BAR_COUNT = 12;
const MIN_H = 3;
const MAX_H = 20;
const AMPLITUDE_SCALE = 4;

function WaveformBars({ analyserNode }: { analyserNode: AnalyserNode | null }) {
  const [heights, setHeights] = useState<number[]>(() => Array(BAR_COUNT).fill(MIN_H));
  const rafRef = useRef<number>(0);
  const prevHeightsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!analyserNode) {
      setHeights(Array(BAR_COUNT).fill(MIN_H));
      return;
    }

    const buf = new Uint8Array(analyserNode.frequencyBinCount);
    const segSize = Math.floor(buf.length / BAR_COUNT);

    const tick = () => {
      analyserNode.getByteTimeDomainData(buf);
      const next: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        const start = i * segSize;
        for (let j = start; j < start + segSize; j++) {
          sum += Math.abs(buf[j] - 128);
        }
        const avg = sum / segSize;
        next.push(Math.min(MIN_H + (avg / 128) * (MAX_H - MIN_H) * AMPLITUDE_SCALE, MAX_H));
      }
      const prev = prevHeightsRef.current;
      if (next.some((h, i) => Math.abs(h - (prev[i] ?? 0)) > 0.5)) {
        prevHeightsRef.current = next;
        setHeights(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserNode]);

  return (
    <div className="flex items-center gap-px h-6">
      {heights.map((h, i) => (
        <div
          key={i}
          className={cn('w-0.5 rounded-full bg-white', !analyserNode && 'animate-pulse')}
          style={{
            height: `${h}px`,
            animationDelay: analyserNode ? undefined : `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

interface RecordingPillProps {
  state: VoiceFlowState;
  recordingSeconds: number;
  downloadProgress: number | null;
  transcriptPreview: string;
  onCancel: () => void;
  overlay?: boolean;
  analyserNode?: AnalyserNode | null;
}

export function RecordingPill({
  state,
  recordingSeconds,
  downloadProgress,
  transcriptPreview,
  onCancel,
  overlay,
  analyserNode,
}: RecordingPillProps) {
  if (state === 'idle') return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 rounded-full bg-neutral-900 shadow-lg select-none z-50',
        overlay
          ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
          : 'fixed bottom-6 left-1/2 -translate-x-1/2'
      )}
    >
      {state === 'recording' ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-white/50 shrink-0" />
          <WaveformBars analyserNode={analyserNode ?? null} />
          <span className="tabular-nums text-white text-sm min-w-[2.5rem] text-right">
            {formatSeconds(recordingSeconds)}
          </span>
          <button
            onClick={onCancel}
            className="flex cursor-pointer items-center justify-center w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 shrink-0"
            aria-label="Stop recording"
          >
            <span className="block w-2 h-2 rounded-sm bg-white/60" />
          </button>
        </>
      ) : downloadProgress !== null ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
          <span className="text-white/70 text-sm">Downloading model…</span>
          <div className="w-20 h-1 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <span className="tabular-nums text-white/50 text-xs">{downloadProgress}%</span>
        </>
      ) : transcriptPreview ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
          <span className="text-white text-sm max-w-xs truncate">{transcriptPreview}</span>
        </>
      ) : (
        <div className="flex items-center gap-1.5 py-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
