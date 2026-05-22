import React from 'react';
import type { Thread } from '../../../shared/types';

import { cn } from '@/lib/utils';
import { FolderOpen } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ThreadItem } from './ThreadItem';
import { useThreadListContext } from './ThreadListContext';

interface Props {
  group: { key: string; name: string; path: string; threads: Thread[] };
}

export function ProjectGroup({ group }: Props) {
  const { selectedProjectPath, onSelectProject } = useThreadListContext();

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onSelectProject(group.path, group.name)}
        className={cn(
          'w-full h-auto px-2.5 py-2 justify-start gap-1.5 hover:bg-accent/60 active:scale-100',
          selectedProjectPath === group.path ? 'text-foreground' : 'text-muted-foreground hover:text-muted-foreground'
        )}
        title="Open project wiki"
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-none truncate">{group.name}</span>
      </Button>

      <div className="mt-0.5 space-y-px">
        {group.threads.map((t) => (
          <ThreadItem key={t.id} thread={t} />
        ))}
      </div>
    </div>
  );
}
