import React from 'react';
import type { Thread } from '../../../shared/types';
import { useUIStore } from '../../store/uiStore';
import {
  Archive,
  ChatCircleText,
  Check,
  DotsThreeVertical,
  PencilSimple,
  StopCircle,
  Terminal,
  TextAlignLeft,
} from '@phosphor-icons/react';
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
  const activeIcon = <Check className="h-3.5 w-3.5 text-emerald-500" weight="bold" />;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" aria-label="Thread options">
          <DotsThreeVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => setThreadView('thread')}>
          <span className="flex w-4 items-center justify-center">{threadView === 'thread' ? activeIcon : null}</span>
          <TextAlignLeft className="text-muted-foreground" />
          Thread
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setThreadView('chat')}>
          <span className="flex w-4 items-center justify-center">{threadView === 'chat' ? activeIcon : null}</span>
          <ChatCircleText className="text-muted-foreground" />
          Chat
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setThreadView('terminal')}>
          <span className="flex w-4 items-center justify-center">{threadView === 'terminal' ? activeIcon : null}</span>
          <Terminal className="text-muted-foreground" />
          Terminal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {thread.status === 'running' && (
          <DropdownMenuItem onSelect={onStop}>
            <StopCircle className="text-muted-foreground" />
            Stop
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onStartRename}>
          <PencilSimple className="text-muted-foreground" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onArchive} className="text-destructive focus:text-destructive">
          <Archive />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
