/**
 * Tests for renderer/hooks/useThreadPosts.ts — optimistic prompt insertion and reconciliation.
 * Uses renderHook + vitest mocks; the IPC layer is stubbed via window.electronAPI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThreadPosts, OPTIMISTIC_PREFIX } from '../../../src/renderer/hooks/useThreadPosts';
import type { ThreadPost, ThreadPostAppendedEvent } from '../../../src/shared/types';

type AppendedHandler = (event: ThreadPostAppendedEvent) => void;

let appendedHandler: AppendedHandler;

beforeEach(() => {
  Object.assign(window.electronAPI, {
    threadPosts: {
      list: vi.fn().mockResolvedValue([]),
    },
  });
  window.electronAPI.on = {
    ...window.electronAPI.on,
    threadPostAppended: vi.fn((cb: AppendedHandler) => {
      appendedHandler = cb;
      return () => {};
    }),
    threadPostUpdated: vi.fn().mockReturnValue(() => {}),
  };
});

function realPrompt(id: string, text: string): ThreadPost {
  return { id, threadId: 't1', kind: 'prompt', author: 'user', text, createdAt: 1 };
}

describe('useThreadPosts', () => {
  it('adds an optimistic prompt immediately, then reconciles it with the real broadcast', async () => {
    const { result } = renderHook(() => useThreadPosts('t1'));
    await waitFor(() => expect(window.electronAPI.threadPosts.list).toHaveBeenCalled());

    act(() => result.current.addOptimistic('hello'));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].id.startsWith(OPTIMISTIC_PREFIX)).toBe(true);
    expect(result.current.posts[0].text).toBe('hello');

    act(() => appendedHandler({ threadId: 't1', post: realPrompt('real-1', 'hello') }));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].id).toBe('real-1');
    expect(result.current.posts.some((p) => p.id.startsWith(OPTIMISTIC_PREFIX))).toBe(false);
  });

  it('appends a non-prompt post without consuming an optimistic placeholder', async () => {
    const { result } = renderHook(() => useThreadPosts('t1'));
    await waitFor(() => expect(window.electronAPI.threadPosts.list).toHaveBeenCalled());

    act(() => result.current.addOptimistic('hello'));
    const update: ThreadPost = {
      id: 'u1',
      threadId: 't1',
      kind: 'update',
      author: 'agent',
      text: 'working',
      createdAt: 2,
    };
    act(() => appendedHandler({ threadId: 't1', post: update }));

    expect(result.current.posts).toHaveLength(2);
    expect(result.current.posts[0].id.startsWith(OPTIMISTIC_PREFIX)).toBe(true);
    expect(result.current.posts[1].id).toBe('u1');
  });

  it('the remover returned by addOptimistic drops the placeholder on a failed send', async () => {
    const { result } = renderHook(() => useThreadPosts('t1'));
    await waitFor(() => expect(window.electronAPI.threadPosts.list).toHaveBeenCalled());

    let remove: () => void = () => {};
    act(() => {
      remove = result.current.addOptimistic('oops');
    });
    expect(result.current.posts).toHaveLength(1);

    act(() => remove());
    expect(result.current.posts).toHaveLength(0);
  });

  it('ignores events for other threads', async () => {
    const { result } = renderHook(() => useThreadPosts('t1'));
    await waitFor(() => expect(window.electronAPI.threadPosts.list).toHaveBeenCalled());

    act(() => appendedHandler({ threadId: 'other', post: realPrompt('x', 'nope') }));
    expect(result.current.posts).toHaveLength(0);
  });
});
