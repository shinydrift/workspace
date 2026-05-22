import React from 'react';
import { type SavedProject } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Props {
  filteredProjects: SavedProject[];
  pendingProjectPath: string;
  projectSearch: string;
  onSearchChange: (q: string) => void;
  onSelectPath: (path: string) => void;
  onStartNew: () => void;
  onContinue: () => void;
  onClose: () => void;
}

export function ProjectPickerStep({
  filteredProjects,
  pendingProjectPath,
  projectSearch,
  onSearchChange,
  onSelectPath,
  onStartNew,
  onContinue,
  onClose,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-search">Saved projects</Label>
        <Input
          id="project-search"
          value={projectSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects by name or path"
          autoFocus
        />
        <div className="overflow-y-auto max-h-56 rounded-md border border-border bg-muted/20">
          <div>
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No projects found</div>
            ) : (
              filteredProjects.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectPath(project.path)}
                  className={cn(
                    'w-full h-auto flex-col items-start rounded-none px-3 py-2 border-b border-border/50 last:border-b-0',
                    pendingProjectPath === project.path
                      ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
                      : 'hover:bg-accent/40'
                  )}
                >
                  <span className="text-sm font-medium truncate">{project.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{project.path}</span>
                </Button>
              ))
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Select a project to continue, or create a new project.</p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button onClick={onStartNew} variant="outline" type="button">
          New project
        </Button>
        <Button onClick={onContinue} type="button" disabled={!pendingProjectPath}>
          Continue
        </Button>
      </div>
    </>
  );
}
