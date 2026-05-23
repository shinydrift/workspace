import React, { useState, useEffect } from 'react';
import type { ChunkRow } from '../../../shared/types';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';
import { displayPath } from './displayPath';

interface Props {
  chunk: ChunkRow;
  busy: boolean;
  onPin: (chunkId: string, pinned: boolean) => void;
  onDelete: (chunkId: string) => void;
  onUpdate: (chunkId: string, text: string) => void;
}

export function MemoryChunkDetail({ chunk, busy, onPin, onDelete, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(chunk.text);

  useEffect(() => {
    setEditText(chunk.text);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk.id]); // intentionally omit chunk.text: resetting only on identity change prevents discarding in-progress edits

  const handleSaveEdit = () => {
    onUpdate(chunk.id, editText);
    setEditing(false);
  };

  const updatedAt = chunk.updatedAt > 0 ? new Date(chunk.updatedAt).toLocaleString() : 'unknown';

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={displayPath(chunk.path)}>
            {displayPath(chunk.path)}
          </div>
          <div className="text-xs text-muted-foreground">
            Lines {chunk.startLine}–{chunk.endLine} · {chunk.source} · {chunk.model} · {updatedAt}
          </div>
          <div className="mt-1 flex gap-1">
            {chunk.pinned && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', statusColors.warning.badge)}>
                pinned
              </span>
            )}
            {chunk.userEdited && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">edited</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onPin(chunk.id, !chunk.pinned)}
            disabled={busy}
          >
            {chunk.pinned ? 'Unpin' : 'Pin'}
          </Button>
          {!editing && (
            <Button
              type="button"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
              Edit
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-7 text-xs text-red-500 hover:text-red-700"
            onClick={() => {
              if (!confirm('Delete this chunk?')) return;
              onDelete(chunk.id);
            }}
            disabled={busy}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            className="min-h-[200px] font-mono text-xs"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="flex gap-1">
            <Button type="button" className="h-7 text-xs" onClick={handleSaveEdit} disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                setEditText(chunk.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">Note: edits persist until next reindex of this file.</div>
        </div>
      ) : (
        <pre className="overflow-auto rounded-lg border border-border/70 bg-muted/30 p-4 text-xs leading-5 whitespace-pre-wrap">
          {chunk.text}
        </pre>
      )}
    </div>
  );
}
