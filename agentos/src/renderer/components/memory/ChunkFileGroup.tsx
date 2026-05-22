import React from 'react';
import type { ChunkRow } from '../../../shared/types';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';

interface Props {
  filePath: string;
  fileChunks: ChunkRow[];
  selectedChunkId: string | null;
  onSelectChunk: (id: string) => void;
  onDeleteFile: (path: string) => void;
}

export function ChunkFileGroup({ filePath, fileChunks, selectedChunkId, onSelectChunk, onDeleteFile }: Props) {
  return (
    <div className="rounded-lg border border-border/70">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-3 py-2">
        <div className="truncate text-xs font-medium" title={filePath}>
          {filePath}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{fileChunks.length} chunks</span>
          <Button
            type="button"
            variant="ghost"
            className="h-auto px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
            onClick={() => {
              if (!confirm(`Delete all indexed chunks for "${filePath}"?`)) return;
              onDeleteFile(filePath);
            }}
            title="Delete all chunks for this file"
          >
            Delete file
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {fileChunks.map((chunk) => (
          <button
            key={chunk.id}
            type="button"
            onClick={() => onSelectChunk(chunk.id)}
            className={cn(
              'w-full px-3 py-2 text-left text-xs transition-colors hover:bg-accent/40',
              selectedChunkId === chunk.id && 'bg-accent/60'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                L{chunk.startLine}–{chunk.endLine}
              </span>
              {chunk.pinned && (
                <span className={cn('rounded px-1 py-0.5 text-xs font-medium', statusColors.warning.badge)}>
                  pinned
                </span>
              )}
              {chunk.userEdited && (
                <span className="rounded bg-blue-100 px-1 py-0.5 text-xs font-medium text-blue-700">edited</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-muted-foreground">{chunk.text.slice(0, 120)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
