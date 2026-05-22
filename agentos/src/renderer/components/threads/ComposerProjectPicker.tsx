import { FolderOpen } from '@phosphor-icons/react';
import { useState } from 'react';
import type { SavedProject } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/ui/command-palette';

interface Props {
  projects: SavedProject[];
  projectName: string;
  workingDir: string;
  onSelect: (project: SavedProject) => void;
}

export function ComposerProjectPicker({ projects, projectName, workingDir, onSelect }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  const displayLabel = projectName || workingDir || null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setShowPicker(true)}
        className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[220px]">{displayLabel ?? 'Select project'}</span>
      </Button>
      <CommandPalette<SavedProject>
        open={showPicker}
        onOpenChange={setShowPicker}
        items={projects}
        onSelect={onSelect}
        getKey={(p) => p.path}
        renderItem={(p) => (
          <div className={`px-3 py-2${p.path === workingDir ? ' font-medium' : ''}`}>
            <div className="text-xs font-medium truncate">{p.name || p.path}</div>
            <div className="text-xs text-muted-foreground truncate">{p.path}</div>
          </div>
        )}
        filterItem={(p, q) => {
          const lq = q.toLowerCase();
          return p.name.toLowerCase().includes(lq) || p.path.toLowerCase().includes(lq);
        }}
        placeholder="Search projects…"
      />
    </>
  );
}
