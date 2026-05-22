import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from './SectionHeader';

interface Props {
  name: string;
  setName: (v: string) => void;
  projectPath: string;
  onSave: () => void;
}

export function GeneralSection({ name, setName, projectPath, onSave }: Props) {
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
      </div>
    </>
  );
}
