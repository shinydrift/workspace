import { useEffect, useState } from 'react';
import { getEffectiveRunOnHost } from '../../shared/effectiveProjectSettings';

/**
 * Effective project → app sandbox setting for a project path — what a thread runs as when it has no
 * per-thread pin of its own. `undefined` until the load resolves, so callers can hide the control
 * rather than render a guessed state.
 */
export function useInheritedRunOnHost(projectPath: string | undefined): boolean | undefined {
  const [inherited, setInherited] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.settings.get(),
      projectPath ? window.electronAPI.project.getConfig(projectPath).catch((): null => null) : Promise.resolve(null),
    ])
      .then(([settings, lookup]) => {
        if (!cancelled) setInherited(getEffectiveRunOnHost(settings, lookup?.config ?? null));
      })
      .catch((err) => {
        console.warn('Failed to load sandbox setting', err);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return inherited;
}
