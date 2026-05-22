import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface WorktreeConfig {
  autoCreate?: boolean;
  pruneOnStop?: boolean;
}

interface Props {
  worktree: WorktreeConfig;
  appAutoCreate: boolean;
  appPruneOnStop: boolean;
  saving: boolean;
  onPatch: (patch: WorktreeConfig) => void;
}

export function WorktreeSettings({ worktree, appAutoCreate, appPruneOnStop, saving, onPatch }: Props) {
  const autoCreate = worktree.autoCreate ?? appAutoCreate;
  const pruneOnStop = worktree.pruneOnStop ?? appPruneOnStop;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Worktrees</p>
      <p className="text-xs text-muted-foreground">
        Isolate each thread in its own git branch. Clean worktrees are deleted when the thread stops and recreated on
        next start.
      </p>
      <div className="flex items-center gap-2">
        <Switch checked={autoCreate} onCheckedChange={(v) => onPatch({ ...worktree, autoCreate: v })} />
        <Label className="font-normal">Auto-create worktree for new threads</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={pruneOnStop} onCheckedChange={(v) => onPatch({ ...worktree, pruneOnStop: v })} />
        <Label className="font-normal">Auto-delete clean worktrees when thread stops</Label>
      </div>
      {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
    </div>
  );
}
