import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
interface ContainersConfig {
  pruneIdleHours?: number;
  pruneMaxAgeDays?: number;
}

interface Props {
  containers: ContainersConfig;
  appPruneIdleHours: number;
  appPruneMaxAgeDays: number;
  saving: boolean;
  pruneRunning: boolean;
  containersLoading: boolean;
  pruneResult: string;
  onPatch: (patch: ContainersConfig) => void;
  onPruneNow: () => void;
}

export function AutoPruneSettings({
  containers,
  appPruneIdleHours,
  appPruneMaxAgeDays,
  saving,
  pruneRunning,
  containersLoading,
  pruneResult,
  onPatch,
  onPruneNow,
}: Props) {
  const idleHours = containers.pruneIdleHours ?? appPruneIdleHours;
  const maxAgeDays = containers.pruneMaxAgeDays ?? appPruneMaxAgeDays;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auto-Prune</p>
      <p className="text-xs text-muted-foreground">
        Force-removes this project's containers older than these thresholds.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="proj-prune-idle">Idle Hours (0 disables)</Label>
          <Input
            id="proj-prune-idle"
            type="number"
            min={0}
            value={idleHours}
            onChange={(e) => onPatch({ ...containers, pruneIdleHours: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="proj-prune-age">Max Age Days (0 disables)</Label>
          <Input
            id="proj-prune-age"
            type="number"
            min={0}
            value={maxAgeDays}
            onChange={(e) => onPatch({ ...containers, pruneMaxAgeDays: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
      {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onPruneNow} variant="outline" disabled={pruneRunning || containersLoading}>
          {pruneRunning ? 'Pruning…' : 'Prune Now'}
        </Button>
        {pruneResult && <span className="text-xs text-muted-foreground">{pruneResult}</span>}
      </div>
    </div>
  );
}
