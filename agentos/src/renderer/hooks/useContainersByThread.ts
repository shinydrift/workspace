import { useEffect, useState } from 'react';
import type { ContainerSummary } from '../../shared/types';

export function useContainersByThread(): Map<string, ContainerSummary> {
  const [containersByThread, setContainersByThread] = useState<Map<string, ContainerSummary>>(new Map());

  useEffect(() => {
    window.electronAPI.sandbox
      .listContainers()
      .then((containers) => {
        const map = new Map<string, ContainerSummary>();
        for (const c of containers) map.set(c.threadId, c);
        setContainersByThread(map);
      })
      .catch((err) => {
        console.warn('Failed to load containers', err);
      });
  }, []);

  return containersByThread;
}
