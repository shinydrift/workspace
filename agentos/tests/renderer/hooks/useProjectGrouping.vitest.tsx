import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProjectGrouping } from '../../../src/renderer/hooks/useProjectGrouping';
import type { Thread } from '../../../src/shared/types';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    name: 'Thread',
    status: 'idle',
    workingDirectory: '/home/user/project-a',
    projectId: 'proj-1',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    autopilot: false,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    autopilotEnabled: false,
    ...overrides,
  } as Thread;
}

describe('useProjectGrouping', () => {
  it('groups threads by workingDirectory when no saved projects', async () => {
    window.electronAPI.project.list = vi.fn().mockResolvedValue([]);
    const threads = [
      makeThread({ id: 'a', workingDirectory: '/proj/foo' }),
      makeThread({ id: 'b', workingDirectory: '/proj/foo' }),
      makeThread({ id: 'c', workingDirectory: '/proj/bar' }),
    ];

    const { result } = renderHook(() => useProjectGrouping(threads));

    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
  });

  it('returns empty array for empty threads', async () => {
    window.electronAPI.project.list = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useProjectGrouping([]));

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });

  it('uses saved project name when path matches workingDirectory', async () => {
    window.electronAPI.project.list = vi.fn().mockResolvedValue([
      { id: 'sp1', name: 'My Project', path: '/proj/foo' },
    ]);

    const threads = [makeThread({ id: 't1', workingDirectory: '/proj/foo' })];
    const { result } = renderHook(() => useProjectGrouping(threads));

    await waitFor(() => {
      expect(result.current[0]?.name).toBe('My Project');
    });
  });

  it('uses basename of workingDirectory as fallback name', async () => {
    window.electronAPI.project.list = vi.fn().mockResolvedValue([]);
    const threads = [makeThread({ id: 't1', workingDirectory: '/home/user/my-app' })];
    const { result } = renderHook(() => useProjectGrouping(threads));

    await waitFor(() => {
      expect(result.current[0]?.name).toBe('my-app');
    });
  });

  it('handles project.list() rejection gracefully', async () => {
    window.electronAPI.project.list = vi.fn().mockRejectedValue(new Error('network error'));
    const threads = [makeThread({ id: 't1', workingDirectory: '/proj/x' })];

    const { result } = renderHook(() => useProjectGrouping(threads));

    // Still renders with threads (no saved project names)
    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
  });
});
