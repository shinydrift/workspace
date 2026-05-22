import React, { useMemo } from 'react';
import type { ToolCallInvocation } from '../../../shared/types';
import { InsightSection } from './InsightSection';
import { MiniBar } from './MiniBar';
import { ArrowUpRight } from '@phosphor-icons/react';

const MEMORY_SAVE_CHUNK_TOOL = 'mcp__agentos-memory__memory_save_chunk';
const MEMORY_SAVE_TOOL = 'mcp__agentos-memory__memory_save';

interface SavedEntry {
  kind: 'chunk' | 'file';
  label: string;
}

function parseMemorySaved(invocations: ToolCallInvocation[]): SavedEntry[] {
  const entries: SavedEntry[] = [];
  for (const inv of invocations) {
    if (inv.name === MEMORY_SAVE_CHUNK_TOOL) {
      const input = inv.input as Record<string, unknown> | null;
      if (!input || typeof input !== 'object') continue;
      const summary = typeof input.summary === 'string' ? input.summary.trim() : null;
      if (summary) entries.push({ kind: 'chunk', label: summary });
    } else if (inv.name === MEMORY_SAVE_TOOL) {
      const input = inv.input as Record<string, unknown> | null;
      if (!input || typeof input !== 'object') continue;
      const path = typeof input.path === 'string' ? input.path.trim() : null;
      if (path) entries.push({ kind: 'file', label: path.replace(/^memory\//, '') });
    }
  }
  return entries;
}

function MemorySavedContent({ invocations }: { invocations: ToolCallInvocation[] }) {
  const entries = useMemo(() => parseMemorySaved(invocations), [invocations]);

  let chunkCount = 0;
  let fileCount = 0;
  for (const e of entries) {
    if (e.kind === 'chunk') chunkCount++;
    else fileCount++;
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      {entries.length > 1 && (
        <div className="flex flex-col gap-1.5 rounded-md bg-muted/20 px-3 py-2.5">
          <MiniBar
            segments={[
              ...(chunkCount > 0
                ? [{ value: (chunkCount / entries.length) * 100, className: 'bg-emerald-500/70' }]
                : []),
              ...(fileCount > 0 ? [{ value: (fileCount / entries.length) * 100, className: 'bg-orange-400/70' }] : []),
            ]}
          />
          <div className="flex gap-3 text-[10px]">
            {chunkCount > 0 && (
              <span className="text-emerald-400">
                {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
              </span>
            )}
            {fileCount > 0 && (
              <span className="text-orange-400">
                {fileCount} file{fileCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {entries.map((entry, i) => (
          <div
            key={`${i}-${entry.label.slice(0, 30)}`}
            className="flex items-start gap-2.5 rounded-md px-3 py-2 bg-muted/20 text-xs"
          >
            <span
              className={`shrink-0 text-[10px] px-1 py-0.5 rounded border font-medium mt-0.5 ${
                entry.kind === 'chunk'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
              }`}
            >
              {entry.kind === 'chunk' ? 'chunk' : 'file'}
            </span>
            <span className="text-foreground/80 font-mono break-words min-w-0">{entry.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MemorySavedSection({
  invocations,
  onOpenInMemory,
}: {
  invocations: ToolCallInvocation[];
  onOpenInMemory?: () => void;
}) {
  const savedCount = useMemo(() => {
    let n = 0;
    for (const inv of invocations) {
      if (inv.name === MEMORY_SAVE_CHUNK_TOOL || inv.name === MEMORY_SAVE_TOOL) n++;
    }
    return n;
  }, [invocations]);

  if (savedCount === 0) return null;

  const countLabel = `${savedCount} ${savedCount === 1 ? 'entry' : 'entries'}`;

  return (
    <InsightSection
      title="Memory Saved"
      count={countLabel}
      headerAction={
        onOpenInMemory ? (
          <button
            onClick={onOpenInMemory}
            aria-label="Open in memory"
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          >
            <ArrowUpRight size={11} />
          </button>
        ) : undefined
      }
    >
      <MemorySavedContent invocations={invocations} />
    </InsightSection>
  );
}
