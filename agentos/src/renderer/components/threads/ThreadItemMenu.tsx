import React from 'react';
import type { Thread } from '../../../shared/types';
import { useUIStore } from '../../store/uiStore';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  thread: Thread;
  onOpenChange?: (open: boolean) => void;
  onStop: () => void;
  onStartRename: () => void;
  onArchive: () => void;
}

export function ThreadItemMenu({ thread, onOpenChange, onStop, onStartRename, onArchive }: Props) {
  const { threadView, setThreadView } = useUIStore();

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" aria-label="Thread options">
          <DotsThreeVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => setThreadView('thread')}>
          <span className="w-3 text-xs">{threadView === 'thread' ? '✓' : ''}</span>
          Thread
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setThreadView('chat')}>
          <span className="w-3 text-xs">{threadView === 'chat' ? '✓' : ''}</span>
          Chat
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setThreadView('terminal')}>
          <span className="w-3 text-xs">{threadView === 'terminal' ? '✓' : ''}</span>
          Terminal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {thread.status === 'running' && <DropdownMenuItem onSelect={onStop}>Stop</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onArchive} className="text-destructive focus:text-destructive">
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
