import React from 'react';
import { cn } from '@/lib/utils';
import { PlusIcon, ClockIcon, ChartBarIcon, FunnelIcon, MicrophoneIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { NavButton } from '@/components/ui/nav-button';
import { DragHandle } from '../../hooks/useDragResize';
import { ThreadList } from '../threads/ThreadList';
import type { Thread } from '../../../shared/types';

const BASE_NAV_ITEMS = [
  { key: 'new-thread' as const, label: 'New thread', Icon: PlusIcon },
  { key: 'automations' as const, label: 'Automations', Icon: ClockIcon },
  { key: 'usage' as const, label: 'Usage', Icon: ChartBarIcon },
  { key: 'meetings' as const, label: 'Meetings', Icon: MicrophoneIcon },
];

interface Props {
  threads: Thread[];
  selectedId: string | null;
  selectedProjectPath: string | null;
  activePanel: 'new-thread' | 'automations' | 'usage' | 'meetings' | null;
  meetingEnabled: boolean;
  showThreadFilters: boolean;
  searchFocusSeq: number;
  sandboxBuildProgress: string | null;
  memoryIndexProgress: string | null;
  hasActiveThreadFilter: boolean;
  sidebarMouseDown: (e: React.MouseEvent) => void;
  onSetActivePanel: (panel: 'new-thread' | 'automations' | 'usage' | 'meetings') => void;
  onToggleFilters: () => void;
  onSelectProject: (path: string, name: string) => void;
}

export function AppSidebar({
  threads,
  selectedId,
  selectedProjectPath,
  activePanel,
  meetingEnabled,
  showThreadFilters,
  searchFocusSeq,
  sandboxBuildProgress,
  memoryIndexProgress,
  hasActiveThreadFilter,
  sidebarMouseDown,
  onSetActivePanel,
  onToggleFilters,
  onSelectProject,
}: Props) {
  const navItems = meetingEnabled ? BASE_NAV_ITEMS : BASE_NAV_ITEMS.filter((i) => i.key !== 'meetings');
  return (
    <>
      <div className="px-2 pt-1 pb-1 shrink-0">
        <div className="mt-0.5 space-y-px">
          {navItems.map(({ key, label, Icon }) => (
            <NavButton key={key} onClick={() => onSetActivePanel(key)} active={activePanel === key}>
              <Icon className={cn('h-5 w-5', activePanel === key ? 'text-foreground' : 'text-muted-foreground')} />
              <span>{label}</span>
            </NavButton>
          ))}
        </div>
      </div>

      <div className="pb-0.5 pt-2 px-3 flex items-center justify-between shrink-0">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">Threads</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleFilters}
            title="Filter"
            aria-label="Filter"
          >
            <FunnelIcon className={cn('h-4 w-4', hasActiveThreadFilter ? 'text-foreground' : '')} />
          </Button>
        </div>
      </div>

      <ThreadList
        threads={threads}
        selectedId={selectedId}
        selectedProjectPath={selectedProjectPath}
        showFilters={showThreadFilters}
        requestSearchFocus={searchFocusSeq}
        onSelectProject={onSelectProject}
      />

      {sandboxBuildProgress && (
        <div className="mx-2.5 mb-1.5 mt-0.5 rounded-xl bg-muted/60 text-xs text-muted-foreground overflow-hidden shrink-0 p-1.5">
          <div className="font-medium mb-1 text-foreground">Building Docker image…</div>
          <div className="truncate text-muted-foreground">{sandboxBuildProgress}</div>
        </div>
      )}
      {memoryIndexProgress && (
        <div className="mx-2.5 mb-1.5 mt-0.5 rounded-xl bg-muted/60 text-xs text-muted-foreground overflow-hidden shrink-0 p-1.5">
          <div className="font-medium text-foreground">{memoryIndexProgress}</div>
        </div>
      )}
      <DragHandle onMouseDown={sidebarMouseDown} />
    </>
  );
}
