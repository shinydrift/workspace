import React from 'react';
import { FolderOpen, CaretDown, Microphone } from '@phosphor-icons/react';
import { CommandPalette } from '@/components/ui/command-palette';
import { cn, focusRing } from '@/lib/utils';
import type { SavedProject } from '../../../shared/types';

interface Props {
  projects: SavedProject[];
  projectLabel: string | null;
  showPicker: boolean;
  onSetShowPicker: (v: boolean) => void;
  onSelectProject: (p: SavedProject) => void;
  onPickDir: () => void;
}

export function MeetingsPanelHeader({
  projects,
  projectLabel,
  showPicker,
  onSetShowPicker,
  onSelectProject,
  onPickDir,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 shrink-0">
      <Microphone className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground">Meetings</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSetShowPicker(true)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors',
            focusRing
          )}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[180px]">{projectLabel ?? 'Select project'}</span>
          <CaretDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
        <CommandPalette<SavedProject>
          open={showPicker}
          onOpenChange={onSetShowPicker}
          items={projects}
          onSelect={onSelectProject}
          getKey={(p) => p.id}
          renderItem={(p) => (
            <div className="px-3 py-2">
              <div className="text-xs font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">{p.path}</div>
            </div>
          )}
          filterItem={(p, q) => {
            const lq = q.toLowerCase();
            return p.name.toLowerCase().includes(lq) || p.path.toLowerCase().includes(lq);
          }}
          placeholder="Search projects…"
          footer={
            <button
              type="button"
              onClick={() => {
                onSetShowPicker(false);
                onPickDir();
              }}
              className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
            >
              Browse directory…
            </button>
          }
        />
      </div>
    </div>
  );
}
