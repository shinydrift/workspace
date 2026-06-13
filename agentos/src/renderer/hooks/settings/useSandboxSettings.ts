import { useState, useEffect } from 'react';
import type {
  AppSettings,
  ContainerPruneSettings,
  ContainerSummary,
  SandboxSecuritySettings,
  WorktreeSettings,
} from '../../../shared/types';
import { DEFAULT_CONTAINER_PRUNE_SETTINGS, DEFAULT_WORKTREE_SETTINGS } from '../../../shared/types';

export function useSandboxSettings(settings: AppSettings | null) {
  const [security, setSecurity] = useState<Partial<SandboxSecuritySettings>>({});
  const [runOnHost, setRunOnHost] = useState(false);
  const [containerPrune, setContainerPrune] = useState<ContainerPruneSettings>(DEFAULT_CONTAINER_PRUNE_SETTINGS);
  const [worktreeSettings, setWorktreeSettings] = useState<WorktreeSettings>(DEFAULT_WORKTREE_SETTINGS);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [pruneRunning, setPruneRunning] = useState(false);
  const [pruneResult, setPruneResult] = useState('');

  async function refreshContainers() {
    setContainersLoading(true);
    try {
      const data = await window.electronAPI.sandbox.listContainers();
      setContainers(data);
    } finally {
      setContainersLoading(false);
    }
  }

  async function runPruneNow() {
    setPruneRunning(true);
    setPruneResult('');
    try {
      const result = await window.electronAPI.sandbox.pruneContainers();
      const msg =
        `Pruned ${result.pruned.length} container(s)` +
        (result.errors.length ? `, ${result.errors.length} error(s)` : '');
      setPruneResult(msg);
      await refreshContainers();
    } finally {
      setPruneRunning(false);
    }
  }

  async function removeOneContainer(containerName: string) {
    await window.electronAPI.sandbox.removeContainer(containerName);
    await refreshContainers();
  }

  useEffect(() => {
    if (!settings) return;
    setSecurity(settings.sandbox ?? {});
    setRunOnHost(settings.runOnHost ?? false);
    setContainerPrune(settings.containerPrune ?? DEFAULT_CONTAINER_PRUNE_SETTINGS);
    setWorktreeSettings(settings.worktrees ?? DEFAULT_WORKTREE_SETTINGS);
  }, [settings]);

  useEffect(() => {
    refreshContainers().catch((err) => {
      console.warn('Failed to refresh containers', err);
    });
  }, []);

  return {
    security,
    setSecurity,
    runOnHost,
    setRunOnHost,
    containerPrune,
    setContainerPrune,
    worktreeSettings,
    setWorktreeSettings,
    containers,
    containersLoading,
    pruneRunning,
    pruneResult,
    refreshContainers,
    runPruneNow,
    removeOneContainer,
  };
}
