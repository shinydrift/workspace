import React, { useCallback, useLayoutEffect, useState } from 'react';
import type { MemoryEntryRecord, ProjectConfigLookup, Thread } from '../../../shared/types';
import type { ViewId } from './ProjectDetail';
import { BoardView } from '../board/BoardView';
import { BoardEmptyState } from './BoardEmptyState';
import { ChunkSourcePanel } from '../memory/ChunkSourcePanel';
import { MemoryGraphView } from '../memory/MemoryGraphView';
import { MemoryPanel } from '../memory/MemoryPanel';
import { ProjectInsightsPanel } from '../insights/ProjectInsightsPanel';
import { WikiPanel } from '../wiki/WikiPanel';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  view: ViewId;
  projectPath: string;
  thread: Thread | null;
  configLookup: ProjectConfigLookup | null;
  enablingBoard: boolean;
  onEnableBoard: () => void;
  onConfigChange: (lookup: ProjectConfigLookup | null) => void;
}

export function ProjectDetailContent({
  view,
  projectPath,
  thread,
  configLookup,
  enablingBoard,
  onEnableBoard,
  onConfigChange,
}: Props) {
  const kanbanEnabled = configLookup?.config?.kanban?.enabled === true;
  const [seen, setSeen] = useState<ReadonlySet<ViewId>>(() => new Set([view]));
  const [sheetSource, setSheetSource] = useState<'memory' | 'sessions' | null>(null);
  const [chunkEntry, setChunkEntry] = useState<MemoryEntryRecord | null>(null);

  const openChunk = useCallback(
    async (chunkId: string) => {
      if (!thread) return;
      try {
        const entry = await window.electronAPI.memory.get({
          threadId: thread.id,
          entryId: chunkId,
          skipExpansion: true,
        });
        if (entry) setChunkEntry(entry);
      } catch (err) {
        console.error('[ProjectDetailContent] Failed to load chunk', err);
      }
    },
    [thread]
  );
  useLayoutEffect(() => {
    setSeen((prev) => (prev.has(view) ? prev : new Set([...prev, view])));
  }, [view]);

  return (
    <>
      {view === 'wiki' && <WikiPanel projectPath={projectPath} />}
      {view === 'graph' && thread && <MemoryGraphView threadId={thread.id} />}
      {view === 'insights' && thread?.projectId && (
        <div className="flex-1 min-h-0 flex flex-col">
          <ProjectInsightsPanel
            projectId={thread.projectId}
            onNavigateToView={(v) => setSheetSource(v)}
            onOpenChunk={(id) => void openChunk(id)}
          />
        </div>
      )}
      {view === 'board' &&
        thread?.projectId &&
        (kanbanEnabled ? (
          <BoardView projectId={thread.projectId} projectPath={projectPath} onConfigChange={onConfigChange} />
        ) : (
          <BoardEmptyState enabling={enablingBoard} onEnable={onEnableBoard} />
        ))}
      {seen.has('memory') && thread && (
        <div key={`memory-${thread.id}`} className={view === 'memory' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <MemoryPanel thread={thread} />
        </div>
      )}
      {seen.has('sessions') && thread && (
        <div key={`sessions-${thread.id}`} className={view === 'sessions' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <ChunkSourcePanel thread={thread} source="sessions" />
        </div>
      )}
      {seen.has('code') && thread && (
        <div key={`code-${thread.id}`} className={view === 'code' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <ChunkSourcePanel thread={thread} source="code" />
        </div>
      )}

      <Sheet
        open={!!sheetSource}
        onOpenChange={(open) => {
          if (!open) setSheetSource(null);
        }}
      >
        <SheetContent>
          <SheetTitle className="sr-only">{sheetSource === 'memory' ? 'Memory' : 'Sessions'}</SheetTitle>
          {sheetSource === 'memory' && thread && <MemoryPanel thread={thread} />}
          {sheetSource === 'sessions' && thread && <ChunkSourcePanel thread={thread} source="sessions" />}
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!chunkEntry}
        onOpenChange={(open) => {
          if (!open) setChunkEntry(null);
        }}
      >
        <SheetContent>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-6 pt-10">
              {chunkEntry && (
                <>
                  <SheetTitle>{chunkEntry.title}</SheetTitle>
                  <div className="text-xs text-muted-foreground">{chunkEntry.path}</div>
                  <pre className="overflow-auto rounded-lg border border-border/60 bg-muted/30 p-4 text-xs leading-5 whitespace-pre-wrap">
                    {chunkEntry.text}
                  </pre>
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
