import { useEffect, useState } from 'react';
import type { ThreadPost } from '../../shared/types';

/** Subscribes to the persisted Slack-style thread view conversation for a thread. */
export function useThreadPosts(threadId: string | null): ThreadPost[] {
  const [posts, setPosts] = useState<ThreadPost[]>([]);

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

    const unsub = window.electronAPI.on.threadPostAppended((event) => {
      if (event.threadId !== threadId) return;
      setPosts((prev) => (prev.some((p) => p.id === event.post.id) ? prev : [...prev, event.post]));
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [threadId]);

  return posts;
}
