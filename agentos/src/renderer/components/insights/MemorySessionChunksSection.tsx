import React, { useState } from 'react';
import type { Thread, MemoryThreadChunk } from '../../../shared/types';
import { usePollData } from '../../hooks/usePollData';
import { timeAgo } from '../../lib/utils';
import { InsightSection } from './InsightSection';
import { ArrowUpRight } from '@phosphor-icons/react';

interface Props {
  thread: Thread;
  onOpenInSessions?: () => void;
}

export function MemorySessionChunksSection({ thread, onOpenInSessions }: Props) {
  const [chunks, setChunks] = useState<MemoryThreadChunk[]>([]);

  const intervalMs = thread.status === 'running' ? 10_000 : 30_000;

  usePollData(
    () => window.electronAPI.memory.getThreadChunks(thread.id),
    setChunks,
    intervalMs,
    [thread.id],
    'session chunks'
  );

  if (chunks.length === 0) return null;

  return (
    <InsightSection
      title="Auto-indexed"
      count={`${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}`}
      headerAction={
        onOpenInSessions ? (
          <button
            onClick={onOpenInSessions}
            aria-label="Open in sessions"
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          >
            <ArrowUpRight size={11} />
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1">
        {chunks.map((chunk) => (
          <div key={chunk.chunkId} className="rounded-md px-3 py-2 bg-muted/20 text-xs flex flex-col gap-0.5">
            <p className="text-foreground/80 leading-relaxed break-words min-w-0">
              {chunk.summary || <span className="italic text-muted-foreground/60">No summary</span>}
            </p>
            <p className="text-muted-foreground/50 text-[10px]">{timeAgo(chunk.updatedAt)}</p>
          </div>
        ))}
      </div>
    </InsightSection>
  );
}
