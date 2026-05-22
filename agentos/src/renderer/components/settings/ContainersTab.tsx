import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '../../contexts/SettingsContext';
import { formatTimestamp } from '../../lib/analyticsFormatters';
import { List, ListItem } from '@/components/ui/list';
import { useDomainStore } from '../../store/domainStore';

export function ContainersTab() {
  const { sandbox } = useSettings();
  const threads = useDomainStore((s) => s.threads);

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Worktrees</p>
        <p className="text-xs text-muted-foreground">
          Isolate each thread in its own git branch. Clean worktrees are deleted when the thread stops and recreated on
          next start.
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="wt-auto-create"
              checked={sandbox.worktreeSettings.autoCreate}
              onCheckedChange={(v) => sandbox.setWorktreeSettings((prev) => ({ ...prev, autoCreate: Boolean(v) }))}
            />
            <Label htmlFor="wt-auto-create" className="font-normal">
              Auto-create worktree for new threads
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="wt-prune-on-stop"
              checked={sandbox.worktreeSettings.pruneOnStop}
              onCheckedChange={(v) => sandbox.setWorktreeSettings((prev) => ({ ...prev, pruneOnStop: Boolean(v) }))}
            />
            <Label htmlFor="wt-prune-on-stop" className="font-normal">
              Auto-delete clean worktrees when thread stops
            </Label>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auto-Prune</p>
        <p className="text-xs text-muted-foreground">Force-removes containers older than these thresholds.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cleanup-idle-hours">Idle Hours (0 disables)</Label>
            <Input
              id="cleanup-idle-hours"
              type="number"
              min={0}
              value={sandbox.containerPrune.idleHours}
              onChange={(e) =>
                sandbox.setContainerPrune((prev) => ({ ...prev, idleHours: Number(e.target.value) || 0 }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cleanup-max-age">Max Age Days (0 disables)</Label>
            <Input
              id="cleanup-max-age"
              type="number"
              min={0}
              value={sandbox.containerPrune.maxAgeDays}
              onChange={(e) =>
                sandbox.setContainerPrune((prev) => ({ ...prev, maxAgeDays: Number(e.target.value) || 0 }))
              }
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={sandbox.refreshContainers}
            variant="outline"
            disabled={sandbox.containersLoading}
          >
            {sandbox.containersLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button type="button" onClick={sandbox.runPruneNow} variant="outline" disabled={sandbox.pruneRunning}>
            {sandbox.pruneRunning ? 'Pruning…' : 'Prune Now'}
          </Button>
          {sandbox.pruneResult && <span className="text-xs text-muted-foreground">{sandbox.pruneResult}</span>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Managed Containers</p>
        <div className="overflow-y-auto max-h-56">
          <List empty={sandbox.containers.length === 0} emptyText="No managed containers in registry.">
            {sandbox.containers.map((container) => {
              const state = !container.exists ? 'not found' : container.running ? 'running' : 'stopped';
              const stateColor = container.running ? 'text-status-success' : 'text-muted-foreground';
              return (
                <ListItem key={container.containerName}>
                  <div
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${container.running ? 'bg-status-success' : 'bg-muted-foreground/40'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{container.containerName}</p>
                    <p className="truncate text-muted-foreground">
                      {threads[container.threadId]?.name ?? container.threadId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={stateColor}>
                      {state}
                      {container.orphaned ? ' · orphan' : ''}
                    </span>
                    {container.drift && <span className="text-status-warning">drift</span>}
                    <span className="text-muted-foreground">{formatTimestamp(container.lastUsedAtMs)}</span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => sandbox.removeOneContainer(container.containerName)}
                    >
                      Remove
                    </Button>
                  </div>
                </ListItem>
              );
            })}
          </List>
        </div>
      </div>
    </>
  );
}
