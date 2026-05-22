import React from 'react';
import { cn } from '@/lib/utils';
import type { Thread } from '../../../../shared/types/thread';
import { ThreadStatusDot } from '../../threads/ThreadStatusDot';

const SEGMENT_COLORS: Record<string, string> = {
  dev: 'bg-blue-500',
  research: 'bg-purple-500',
  review: 'bg-green-500',
  refine: 'bg-orange-500',
  main: 'bg-primary',
};

interface AgentAvatarProps {
  thread: Thread;
}

export function AgentAvatar({ thread }: AgentAvatarProps) {
  // Extract last segment: 'stage-dev' → 'dev', 'task-main' → 'main'
  const role = thread.agentRole ?? 'task-main';
  const segment = role.split('-').pop() ?? role;
  const letter = segment.charAt(0).toUpperCase();
  const bgColor = SEGMENT_COLORS[segment] ?? 'bg-muted-foreground';

  return (
    <span
      className="relative inline-flex items-center justify-center w-5 h-5 shrink-0"
      title={`${thread.name ?? 'Agent'} · ${role}`}
    >
      <span
        className={cn(
          'w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold text-white',
          bgColor
        )}
      >
        {letter}
      </span>
      <ThreadStatusDot status={thread.status} animated className="absolute bottom-0 right-0 border border-card" />
    </span>
  );
}
