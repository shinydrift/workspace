import React from 'react';
import { Button } from '../ui/button';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  busy: boolean;
  onSetPage: (page: number) => void;
}

export function MemoryChunkListPagination({ page, totalPages, total, busy, onSetPage }: Props) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page + 1} of {totalPages} ({total} total)
      </span>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void onSetPage(page - 1)}
          disabled={page === 0 || busy}
        >
          Prev
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void onSetPage(page + 1)}
          disabled={page >= totalPages - 1 || busy}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
