import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from './SectionHeader';

interface Props {
  name: string;
  setName: (v: string) => void;
  subdir: string;
  setSubdir: (v: string) => void;
  onSubdirSave: () => void;
  projectPath: string;
  onSave: () => void;
}

export function GeneralSection({ name, setName, subdir, setSubdir, onSubdirSave, projectPath, onSave }: Props) {
  return (
    <>
      <SectionHeader title="General" />
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="proj-name">Project name</Label>
          <Input
            id="proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
            }}
            onBlur={() => onSave()}
            placeholder="Project name"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label className="text-muted-foreground">Path</Label>
          <p className="text-xs text-muted-foreground font-mono truncate">{projectPath}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="proj-subdir">Subdirectory</Label>
          <Input
            id="proj-subdir"
            value={subdir}
            onChange={(e) => setSubdir(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubdirSave();
            }}
            onBlur={() => onSubdirSave()}
            placeholder="e.g. apps/backend (leave blank for the repo root)"
          />
          <p className="text-xs text-muted-foreground">
            For monorepos: the agent runs in this folder while the whole repo stays mounted. Relative to the path above.
          </p>
        </div>
      </div>
    </>
  );
}
