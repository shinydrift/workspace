import React, { useEffect, useMemo, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { SectionHeader } from './SectionHeader';
import { WorktreeSettings } from './WorktreeSettings';
import { AutoPruneSettings } from './AutoPruneSettings';
import { ManagedContainerList } from './ManagedContainerList';
import { useDomainStore } from '../../../store/domainStore';
import type { ContainerSummary } from '../../../../shared/types';

interface WorktreeConfig {
  autoCreate?: boolean;
  pruneOnStop?: boolean;
}

interface ContainersConfig {
  pruneIdleHours?: number;
  pruneMaxAgeDays?: number;
}

interface Props {
  worktree: WorktreeConfig;
  containers: ContainersConfig;
  appAutoCreate: boolean;
  appPruneOnStop: boolean;
  appPruneIdleHours: number;
  appPruneMaxAgeDays: number;
  projectPath: string;
  savingKey: string | null;
  onWorktreePatch: (patch: WorktreeConfig) => void;
  onContainersPatch: (patch: ContainersConfig) => void;
}

export function ContainersSection({
  worktree,
  containers,
  appAutoCreate,
  appPruneOnStop,
  appPruneIdleHours,
  appPruneMaxAgeDays,
  projectPath,
  savingKey,
  onWorktreePatch,
  onContainersPatch,
}: Props) {
  const threads = useDomainStore((s) => s.threads);
  const [allContainers, setAllContainers] = useState<ContainerSummary[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [pruneRunning, setPruneRunning] = useState(false);
  const [pruneResult, setPruneResult] = useState('');

  async function refreshContainers() {
    setContainersLoading(true);
    try {
      const data = await window.electronAPI.sandbox.listContainers();
      setAllContainers(data);
    } finally {
      setContainersLoading(false);
    }
  }

  useEffect(() => {
    void refreshContainers();
  }, []);

  const projectContainers = useMemo(() => {
    const projectThreadIds = new Set(
      Object.values(threads)
        .filter((t) => (t.projectPath ?? t.workingDirectory) === projectPath)
        .map((t) => t.id)
    );
    return allContainers.filter((c) => projectThreadIds.has(c.threadId));
  }, [threads, projectPath, allContainers]);

  async function handlePruneNow() {
    setPruneRunning(true);
    setPruneResult('');
    try {
      const toRemove = projectContainers.filter((c) => !c.running);
      await Promise.all(toRemove.map((c) => window.electronAPI.sandbox.removeContainer(c.containerName)));
      setPruneResult(`Pruned ${toRemove.length} container(s)`);
      await refreshContainers();
    } finally {
      setPruneRunning(false);
    }
  }

  async function handleRemove(containerName: string) {
    await window.electronAPI.sandbox.removeContainer(containerName);
    await refreshContainers();
  }

  return (
    <>
      <SectionHeader title="Per-project worktree and container settings." description="Containers" />

      <WorktreeSettings
        worktree={worktree}
        appAutoCreate={appAutoCreate}
        appPruneOnStop={appPruneOnStop}
        saving={savingKey === 'worktree'}
        onPatch={onWorktreePatch}
      />

      <Separator />

      <AutoPruneSettings
        containers={containers}
        appPruneIdleHours={appPruneIdleHours}
        appPruneMaxAgeDays={appPruneMaxAgeDays}
        saving={savingKey === 'containers'}
        pruneRunning={pruneRunning}
        containersLoading={containersLoading}
        pruneResult={pruneResult}
        onPatch={onContainersPatch}
        onPruneNow={() => void handlePruneNow()}
      />

      <Separator />

      <ManagedContainerList
        containers={projectContainers}
        threads={threads}
        loading={containersLoading}
        onRemove={(name) => void handleRemove(name)}
      />
    </>
  );
}
