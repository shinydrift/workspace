import React from 'react';
import { DragHandle } from '../../hooks/useDragResize';
import type { WikiPage } from '../../../shared/types';
import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface Props {
  pages: WikiPage[];
  selectedId: string | null;
  loading: boolean;
  width: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onDragHandleMouseDown: (e: React.MouseEvent) => void;
}

export function WikiPageList({
  pages,
  selectedId,
  loading,
  width,
  onSelect,
  onCreate,
  onDelete,
  onDragHandleMouseDown,
}: Props) {
  return (
    <div className="relative flex shrink-0 flex-col border-r border-border/60 bg-muted/20" style={{ width }}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Pages</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCreate}
          title="New page"
          aria-label="New page"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-muted/20 to-transparent" />
        <ScrollArea className="h-full">
          {loading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
          ) : pages.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No pages yet. Click + to create one.</p>
          ) : (
            pages.map((page) => (
              <div
                key={page.id}
                className={cn(
                  'group flex items-start transition-colors',
                  selectedId === page.id ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(page.id)}
                  className={cn(
                    'flex-1 text-left px-3 py-2 text-sm flex flex-col min-w-0',
                    selectedId === page.id ? 'text-foreground' : 'text-foreground/80'
                  )}
                >
                  <span className="truncate leading-snug">{page.title}</span>
                  <span className="text-xs text-muted-foreground">{relativeDate(page.updatedAt)}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 mt-1.5 mr-1 h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive transition-opacity"
                  title="Delete page"
                  aria-label="Delete page"
                  onClick={() => onDelete(page.id)}
                >
                  <Trash className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </ScrollArea>
      </div>
      <DragHandle onMouseDown={onDragHandleMouseDown} />
    </div>
  );
}
