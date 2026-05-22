import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Thread } from '../../../shared/types';
import type { ThreadFilter } from '../../store/uiStore';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import { FilterBar } from './FilterBar';
import { ThreadListSkeleton } from './ThreadListSkeleton';
import { ProjectGroup } from './ProjectGroup';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useThreadActions } from '../../hooks/useThreadActions';
import { useContainersByThread } from '../../hooks/useContainersByThread';
import { useProjectGrouping } from '../../hooks/useProjectGrouping';
import { ThreadListProvider } from './ThreadListContext';

interface Props {
  threads: Thread[];
  selectedId: string | null;
  selectedProjectPath: string | null;
  showFilters: boolean;
  requestSearchFocus: number;
  onSelectProject: (projectPath: string, projectName: string) => void;
}

function filterAndSortThreads(threads: Thread[], filter: ThreadFilter): Thread[] {
  let result = threads.filter((t) => !t.parentThreadId);

  if (filter.query.trim()) {
    const query = filter.query.trim().toLowerCase();
    result = result.filter((t) => t.name.toLowerCase().includes(query));
  }

  if (filter.status !== 'all') {
    result = result.filter((t) => t.status === filter.status);
  }

  switch (filter.sortBy) {
    case 'newest':
      result.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'last-active':
      result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      break;
    case 'name':
      result.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return result;
}

export function ThreadList({
  threads,
  selectedId,
  selectedProjectPath,
  showFilters,
  requestSearchFocus,
  onSelectProject,
}: Props) {
  const { threadsLoaded } = useDomainStore();
  const { setSelectedThread } = useUIStore();
  const threadFilter = useUIStore((s) => s.threadFilter);
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);

  const containersByThread = useContainersByThread();
  const {
    menuId,
    setMenuId,
    renamingId,
    renameInput,
    setRenameInput,
    confirmArchiveThread,
    setConfirmArchiveThread,
    stopThread,
    startRename,
    commitRename,
    cancelRename,
    archiveThread,
    doArchive,
  } = useThreadActions();

  const [visibleCount, setVisibleCount] = useState(50);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const filteredThreads = useMemo(() => filterAndSortThreads(threads, threadFilter), [threads, threadFilter]);

  useEffect(() => {
    setVisibleCount(50);
  }, [threadFilter]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    []
  );

  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;

    const setup = () => {
      const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) setVisibleCount((c) => c + 50);
        },
        { root: viewport ?? null, threshold: 0 }
      );
      observer.observe(el);
      observerRef.current = observer;
    };

    if (scrollAreaRef.current) {
      setup();
    } else {
      requestAnimationFrame(() => {
        if (el.isConnected) setup();
      });
    }
  }, []);

  const visibleThreads = useMemo(() => filteredThreads.slice(0, visibleCount), [filteredThreads, visibleCount]);

  const topLevelCount = useMemo(() => threads.filter((t) => !t.parentThreadId).length, [threads]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      if (!t.parentThreadId) continue;
      const arr = map.get(t.parentThreadId) ?? [];
      arr.push(t);
      map.set(t.parentThreadId, arr);
    }
    return map;
  }, [threads]);

  const projectGroups = useProjectGrouping(visibleThreads);

  const contextValue = useMemo(
    () => ({
      selectedId,
      selectedProjectPath,
      menuId,
      renamingId,
      renameInput,
      containersByThread,
      childrenByParentId,
      setMenuId,
      setSelectedThread,
      setRenameInput,
      startRename,
      commitRename,
      cancelRename,
      stopThread,
      archiveThread,
      onSelectProject,
    }),
    [
      selectedId,
      selectedProjectPath,
      menuId,
      renamingId,
      renameInput,
      containersByThread,
      childrenByParentId,
      setMenuId,
      setSelectedThread,
      setRenameInput,
      startRename,
      commitRename,
      cancelRename,
      stopThread,
      archiveThread,
      onSelectProject,
    ]
  );

  useEffect(() => {
    if (!showFilters) return;
    if (requestSearchFocus === 0) return;
    searchInput?.focus();
    searchInput?.select();
  }, [requestSearchFocus, showFilters, searchInput]);

  if (!threadsLoaded) {
    return <ThreadListSkeleton />;
  }

  if (topLevelCount === 0) {
    return (
      <div className="px-2.5 py-1.5">
        <div className="text-muted-foreground mt-0.5 px-2.5 py-1.5 text-xs">No threads yet</div>
      </div>
    );
  }

  return (
    <ThreadListProvider value={contextValue}>
      <ScrollArea ref={scrollAreaRef} className="thread-list-scroll flex-1 px-2 pb-1.5">
        {showFilters && (
          <FilterBar
            totalCount={topLevelCount}
            filteredCount={filteredThreads.length}
            setSearchInputRef={setSearchInput}
          />
        )}

        <div className="mt-0.5 space-y-2 w-full">
          {filteredThreads.length === 0 && (
            <div className="text-muted-foreground mt-0.5 px-2.5 py-2 text-xs">No threads match current filters</div>
          )}
          {projectGroups.map((group) => (
            <ProjectGroup key={group.key} group={group} />
          ))}
          {visibleCount < filteredThreads.length && <div ref={sentinelRef} className="h-1" />}
        </div>

        <ConfirmDialog
          open={confirmArchiveThread !== null}
          title={`Archive "${confirmArchiveThread?.name ?? ''}"`}
          description="The worktree will be removed. This cannot be undone."
          confirmLabel="Archive"
          onConfirm={() => confirmArchiveThread && void doArchive(confirmArchiveThread)}
          onCancel={() => setConfirmArchiveThread(null)}
        />
      </ScrollArea>
    </ThreadListProvider>
  );
}
