import { useEffect, useMemo, useRef, useState } from 'react';
import { type Provider, type SavedProject } from '../../shared/types';
import type { ClaudeEffort, CodexReasoning } from '../../shared/types/provider';
import {
  getEffectivePrimaryProviderEntry,
  getEffectiveRunOnHost,
  getEffectiveWorktreeSettings,
} from '../../shared/effectiveProjectSettings';

/**
 * Shared state and logic for ThreadCreateModal and NewThreadComposer.
 * Both components manage `projects` themselves (different loading side-effects),
 * but share the settings load and provider sync/selection logic.
 */
export function useThreadComposer(projects: SavedProject[]) {
  const [workingDir, setWorkingDir] = useState('');
  const [projectName, setProjectName] = useState('');
  const [provider, setProvider] = useState<Provider>('claude');
  const [model, setModel] = useState<string | undefined>(undefined);
  const [effort, setEffort] = useState<ClaudeEffort | undefined>(undefined);
  const [reasoning, setReasoning] = useState<CodexReasoning | undefined>(undefined);
  const providerTouchedRef = useRef(false);
  // Per-thread sandbox override. `undefined` means "inherit the project/app setting" — the main
  // process resolves it fresh at thread start (matching model/effort/reasoning). We only send an
  // explicit boolean once the user toggles. sandboxEnabled drives whether the toggle shows at all —
  // hidden when the project already runs on host (sandbox off), per product decision.
  const [runOnHost, setRunOnHost] = useState<boolean | undefined>(undefined);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  // Per-thread worktree override. `undefined` means "inherit the project/app auto-create setting"
  // (resolved in the main process at thread creation). worktreeDefault mirrors that effective
  // setting so the composer chip can show the inherited on/off state before any toggle; it stays
  // `undefined` until the async settings load resolves so the chip is hidden rather than guessing.
  const [createWorktree, setCreateWorktree] = useState<boolean | undefined>(undefined);
  const [worktreeDefault, setWorktreeDefault] = useState<boolean | undefined>(undefined);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const matchedProject = useMemo(() => projects.find((p) => p.path === workingDir), [projects, workingDir]);

  // Load effective provider order from app settings plus project config.
  useEffect(() => {
    let cancelled = false;
    const projectPath = matchedProject?.path;

    async function loadEffectiveProvider() {
      try {
        const [settings, lookup] = await Promise.all([
          window.electronAPI.settings.get(),
          projectPath
            ? window.electronAPI.project.getConfig(projectPath).catch((): null => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setSandboxEnabled(!getEffectiveRunOnHost(settings, lookup?.config ?? null));
        setWorktreeDefault(getEffectiveWorktreeSettings(settings, lookup?.config ?? null).autoCreate);
        if (providerTouchedRef.current) return;
        const primary = getEffectivePrimaryProviderEntry(settings, lookup?.config ?? null);
        setProvider(primary.provider);
        setModel(primary.model);
        setEffort(primary.effort);
        setReasoning(primary.reasoning);
        setAutopilotEnabled(settings.agents?.autopilot?.enabled ?? false);
      } catch (err) {
        console.warn('Failed to load provider settings', err);
      }
    }

    void loadEffectiveProvider();

    return () => {
      cancelled = true;
    };
  }, [matchedProject?.path]);

  function setProviderSelection(nextProvider: Provider) {
    providerTouchedRef.current = true;
    setProvider(nextProvider);
    setModel(undefined);
    setEffort(undefined);
    setReasoning(undefined);
  }

  function setModelSelection(nextModel: string | undefined) {
    setModel(nextModel);
  }

  function clearProviderTouch() {
    providerTouchedRef.current = false;
    // Reset the per-thread overrides back to "inherit" when the project changes.
    setRunOnHost(undefined);
    setCreateWorktree(undefined);
  }

  function setRunOnHostSelection(next: boolean) {
    setRunOnHost(next);
  }

  function setCreateWorktreeSelection(next: boolean) {
    setCreateWorktree(next);
  }

  return {
    workingDir,
    setWorkingDir,
    projectName,
    setProjectName,
    provider,
    setProviderSelection,
    model,
    setModelSelection,
    effort,
    setEffort,
    reasoning,
    setReasoning,
    clearProviderTouch,
    runOnHost,
    setRunOnHostSelection,
    sandboxEnabled,
    createWorktree,
    setCreateWorktreeSelection,
    worktreeDefault,
    autopilotEnabled,
    setAutopilotEnabled,
    creating,
    setCreating,
    error,
    setError,
    matchedProject,
  };
}
