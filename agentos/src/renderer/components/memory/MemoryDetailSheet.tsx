import React from 'react';
import type { MemoryEntryRecord } from '../../../shared/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { useMemoryInspector } from '../../hooks/useMemoryInspector';
import { MemoryChunkDetail } from './MemoryChunkDetail';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';

type DetailSheet = 'search' | 'chunk' | null;

interface Props {
  detailSheet: DetailSheet;
  selectedEntry: MemoryEntryRecord | null;
  inspector: ReturnType<typeof useMemoryInspector>;
  onClose: () => void;
}

function SheetBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-6 pt-10">{children}</div>
    </ScrollArea>
  );
}

export function MemoryDetailSheet({ detailSheet, selectedEntry, inspector, onClose }: Props) {
  return (
    <Sheet open={detailSheet !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetBody>
          {detailSheet === 'search' && selectedEntry && (
            <>
              <SheetTitle>{selectedEntry.title}</SheetTitle>
              <div className="text-xs text-muted-foreground">{selectedEntry.path}</div>
              <pre className="overflow-auto rounded-lg border border-border/60 bg-muted/30 p-4 text-xs leading-5 whitespace-pre-wrap">
                {selectedEntry.text}
              </pre>
            </>
          )}
          {detailSheet === 'chunk' && inspector.selectedChunk && (
            <>
              <SheetTitle className="truncate">{inspector.selectedChunk.path}</SheetTitle>
              <MemoryChunkDetail
                chunk={inspector.selectedChunk}
                busy={inspector.busy}
                onPin={(id, pinned) => void inspector.pinChunk(id, pinned)}
                onDelete={(id) => {
                  void inspector.deleteChunk(id);
                  onClose();
                }}
                onUpdate={(id, text) => void inspector.updateChunk(id, text)}
              />
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
