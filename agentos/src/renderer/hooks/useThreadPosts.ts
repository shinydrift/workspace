import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadPost } from '../../shared/types';

/** Prefix marking a renderer-only optimistic prompt awaiting its real broadcast from main. */
export const OPTIMISTIC_PREFIX = 'optimistic:';

export interface UseThreadPosts {
  posts: ThreadPost[];
  /**
   * Insert a placeholder prompt shown immediately on send, before the main process round-trips.
   * Returns a remover the caller invokes if the send fails — otherwise the real broadcast reconciles it.
   */
  addOptimistic: (text: string) => () => void;
}

/** Subscribes to the persisted Slack-style thread view conversation for a thread. */
export function useThreadPosts(threadId: string | null): UseThreadPosts {
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const optimisticSeq = useRef(0);

  const addOptimistic = useCallback(
    (text: string) => {
      if (!threadId) return () => {};
      const id = `${OPTIMISTIC_PREFIX}${optimisticSeq.current++}`;
      const post: ThreadPost = { id, threadId, kind: 'prompt', author: 'user', text, createdAt: Date.now() };
      setPosts((prev) => [...prev, post]);
      // Remover for a failed send. No-op once reconciled (the id is gone), so it's race-safe.
      return () => setPosts((prev) => prev.filter((p) => p.id !== id));
    },
    [threadId]
  );

  useEffect(() => {
    if (!threadId) {
      setPosts([]);
      return;
    }

    let cancelled = false;
    window.electronAPI.threadPosts.list(threadId).then((list) => {
      if (cancelled) return;
      // Merge rather than overwrite: a post may have arrived via the subscription below while this
      // list() was in flight — appended posts are newer, so keep them after the persisted list.
      setPosts((prev) => {
        if (prev.length === 0) return list;
        const seen = new Set(list.map((p) => p.id));
        return [...list, ...prev.filter((p) => !seen.has(p.id))];
      });
    });

    const unsubAppended = window.electronAPI.on.threadPostAppended((event) => {
      if (event.threadId !== threadId) return;
      setPosts((prev) => {
        if (prev.some((p) => p.id === event.post.id)) return prev;
        // Reconcile the real prompt with the optimistic placeholder added on send (FIFO — posts
        // broadcast in send order), so the message swaps in place rather than briefly duplicating.
        if (event.post.kind === 'prompt' && event.post.author === 'user') {
          const idx = prev.findIndex((p) => p.id.startsWith(OPTIMISTIC_PREFIX));
          if (idx !== -1) {
            const next = prev.slice();
            next[idx] = event.post;
            return next;
          }
        }
        return [...prev, event.post];
      });
    });

    const unsubUpdated = window.electronAPI.on.threadPostUpdated((event) => {
      if (event.threadId !== threadId) return;
      setPosts((prev) => prev.map((p) => (p.id === event.post.id ? event.post : p)));
    });

    return () => {
      cancelled = true;
      unsubAppended();
      unsubUpdated();
    };
  }, [threadId]);

  return { posts, addOptimistic };
}
