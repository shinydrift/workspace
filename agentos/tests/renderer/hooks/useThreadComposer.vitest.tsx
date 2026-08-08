/**
 * The composer resolves the sandbox/worktree defaults the same way the main process does at thread
 * start — from the working directory's own `.agentos/config.json`, whether or not that directory is
 * a saved project — and re-resolves when either level changes underneath an open composer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useThreadComposer } from '../../../src/renderer/hooks/useThreadComposer';
import type { SavedProject } from '../../../src/shared/types';

const UNSAVED_DIR = '/tmp/not-a-saved-project';

function api() {
  return window.electronAPI as unknown as {
    settings: { get: ReturnType<typeof vi.fn> };
    project: { getConfig: ReturnType<typeof vi.fn> };
    on: { settingsChanged: ReturnType<typeof vi.fn>; projectConfigUpdated: ReturnType<typeof vi.fn> };
  };
}

describe('useThreadComposer sandbox resolution', () => {
  beforeEach(() => {
    api().settings.get.mockResolvedValue({ runOnHost: false });
    api().project.getConfig.mockResolvedValue(null);
  });

  it('defaults to sandboxed when neither level opts out', async () => {
    const { result } = renderHook(() => useThreadComposer([]));
    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(false));
  });

  it('reads project config for a directory that is not a saved project', async () => {
    api().project.getConfig.mockResolvedValue({ config: { runOnHost: true } });

    const { result } = renderHook(() => useThreadComposer([] as SavedProject[]));
    act(() => result.current.setWorkingDir(UNSAVED_DIR));

    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(true));
    expect(api().project.getConfig).toHaveBeenCalledWith(UNSAVED_DIR);
  });

  it('lets a project opt back into the sandbox over an app-level host default', async () => {
    api().settings.get.mockResolvedValue({ runOnHost: true });
    api().project.getConfig.mockResolvedValue({ config: { runOnHost: false } });

    const { result } = renderHook(() => useThreadComposer([]));
    act(() => result.current.setWorkingDir(UNSAVED_DIR));

    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(false));
  });

  it('re-resolves when app settings change while the composer is open', async () => {
    let fire: (() => void) | undefined;
    api().on.settingsChanged.mockImplementation((cb: () => void) => {
      fire = cb;
      return () => {};
    });

    const { result } = renderHook(() => useThreadComposer([]));
    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(false));

    api().settings.get.mockResolvedValue({ runOnHost: true });
    await act(async () => {
      fire?.();
    });

    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(true));
  });

  it('re-resolves when this project’s config changes while the composer is open', async () => {
    let fire: ((e: { projectPath: string; key: string }) => void) | undefined;
    api().on.projectConfigUpdated.mockImplementation((cb: (e: { projectPath: string; key: string }) => void) => {
      fire = cb;
      return () => {};
    });

    const { result } = renderHook(() => useThreadComposer([]));
    act(() => result.current.setWorkingDir(UNSAVED_DIR));
    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(false));

    api().project.getConfig.mockResolvedValue({ config: { runOnHost: true } });
    await act(async () => {
      fire?.({ projectPath: '/tmp/some-other-project', key: 'runOnHost' });
    });
    expect(result.current.inheritedRunOnHost).toBe(false);

    await act(async () => {
      fire?.({ projectPath: UNSAVED_DIR, key: 'runOnHost' });
    });
    await waitFor(() => expect(result.current.inheritedRunOnHost).toBe(true));
  });
});
