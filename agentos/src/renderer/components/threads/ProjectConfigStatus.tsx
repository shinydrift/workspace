import React from 'react';
import type { ProjectConfigLookup } from '../../../shared/types';
import { Button } from '@/components/ui/button';

interface Props {
  projectConfigLookup: ProjectConfigLookup | null;
  projectConfigBusy: boolean;
  onCreateConfig: () => void;
  onOpenConfig: () => void;
}

export function ProjectConfigStatus({ projectConfigLookup, projectConfigBusy, onCreateConfig, onOpenConfig }: Props) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate">
          {projectConfigLookup?.exists
            ? '.agentos/config.json defaults loaded'
            : '.agentos/config.json not found for this project'}
          {typeof projectConfigLookup?.config?.worktree?.autoCreate === 'boolean'
            ? ` (worktree: ${projectConfigLookup.config.worktree.autoCreate ? 'auto-create' : 'no auto-create'})`
            : ''}
        </div>
        <div className="flex items-center gap-1">
          {!projectConfigLookup?.exists && (
            <Button type="button" size="sm" variant="outline" onClick={onCreateConfig} disabled={projectConfigBusy}>
              Create config
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onOpenConfig} disabled={projectConfigBusy}>
            Open config
          </Button>
        </div>
      </div>
      {(projectConfigLookup?.warnings?.length ?? 0) > 0 && (
        <div className="mt-1 text-amber-500">Config warnings: {projectConfigLookup.warnings.join('; ')}</div>
      )}
    </div>
  );
}
