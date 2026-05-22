import { useEffect, useMemo, useState } from 'react';
import type { SavedProject, Thread } from '../../shared/types';
import { getBaseName } from '@/lib/utils';

export interface ProjectGroup {
  key: string;
  name: string;
  path: string;
  threads: Thread[];
}

export function useProjectGrouping(filteredThreads: Thread[]): ProjectGroup[] {
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.project
      .list()
      .then((projects) => {
        if (!cancelled) setSavedProjects(projects);
      })
      .catch((err) => {
        console.warn('Failed to load saved projects', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const savedByPath = new Map(savedProjects.map((p) => [p.path, p]));
    const groups: ProjectGroup[] = [];
    for (const thread of filteredThreads) {
      const saved = savedByPath.get(thread.projectPath ?? '') ?? savedByPath.get(thread.workingDirectory);
      const canonicalPath = saved?.path ?? thread.projectPath ?? thread.workingDirectory;
      const last = groups[groups.length - 1];
      if (last && last.path === canonicalPath) {
        last.threads.push(thread);
      } else {
        const name = saved?.name || getBaseName(thread.projectPath) || getBaseName(thread.workingDirectory) || 'project';
        const key = `${canonicalPath || `project-${thread.id}`}::${groups.length}`;
        groups.push({ key, name, path: canonicalPath, threads: [thread] });
      }
    }
    return groups;
  }, [filteredThreads, savedProjects]);
}
