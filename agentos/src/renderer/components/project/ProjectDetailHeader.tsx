import React from 'react';
import { Gear } from '@phosphor-icons/react';
import { cn, getBaseName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ViewId } from './ProjectDetail';

interface Tab {
  id: ViewId;
  label: string;
  disabled: boolean;
}

interface Props {
  projectName: string;
  projectPath: string;
  view: ViewId;
  tabs: readonly Tab[];
  onSetView: (v: ViewId) => void;
  onOpenSettings: () => void;
}

export function ProjectDetailHeader({ projectName, projectPath, view, tabs, onSetView, onOpenSettings }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 shrink-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{projectName || getBaseName(projectPath)}</div>
        <div className="truncate text-xs text-muted-foreground">{projectPath}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center rounded-lg bg-muted p-0.5 text-xs">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant="ghost"
              onClick={() => onSetView(tab.id)}
              disabled={tab.disabled}
              title={tab.disabled ? 'No threads found for this project' : undefined}
              className={cn(
                'h-auto px-2 py-1 text-xs capitalize',
                view === tab.id
                  ? 'bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground'
                  : 'text-muted-foreground hover:bg-transparent hover:text-muted-foreground'
              )}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onOpenSettings}
          title="Project settings"
          aria-label="Project settings"
        >
          <Gear size={15} />
        </Button>
      </div>
    </div>
  );
}
