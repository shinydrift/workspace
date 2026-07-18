import React, { memo, useEffect, useMemo, useRef } from 'react';
import type { ThreadPost, ThreadPostStatus } from '../../../shared/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { renderMarkdown } from '../../lib/markdown';
import { handleCodeCopy } from '../chat/messageUtils';
import { Sparkle, User, Paperclip } from '@phosphor-icons/react';
import { OPTIMISTIC_PREFIX } from '../../hooks/useThreadPosts';

const KIND_LABEL: Record<Exclude<ThreadPost['kind'], 'prompt'>, string> = {
  update: 'Update',
  clarification: 'Question',
  file: 'File',
};

// Mirrors the Slack reaction lifecycle the agent applies to inbound messages. The transient
// working/autopilot/council states arrive live; done/error are persisted on the post.
const STATUS_BADGE: Record<ThreadPostStatus, { emoji: string; label: string }> = {
  working: { emoji: '👀', label: 'Working' },
  autopilot: { emoji: '🤖', label: 'Autopilot running' },
  council: { emoji: '🏛️', label: 'Council running' },
  done: { emoji: '✅', label: 'Done' },
  error: { emoji: '❌', label: 'Error' },
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const PostRow = memo(function PostRow({ post, live }: { post: ThreadPost; live: ThreadPostStatus | null }) {
  const isUser = post.author === 'user';
  const pending = post.id.startsWith(OPTIMISTIC_PREFIX);
  const html = useMemo(() => renderMarkdown(post.text), [post.text]);
  const badge = post.kind === 'prompt' ? null : KIND_LABEL[post.kind];
  // Persisted terminal outcome wins; otherwise show the live transient badge (current prompt only).
  const effectiveStatus = post.status ?? live;
  const status = effectiveStatus ? STATUS_BADGE[effectiveStatus] : null;

  return (
    <div className={`flex gap-3${pending ? ' opacity-60' : ''}`}>
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          isUser ? 'bg-muted text-foreground/70' : 'bg-primary/10 text-primary'
        }`}
      >
        {isUser ? <User className="h-4 w-4" weight="fill" /> : <Sparkle className="h-4 w-4" weight="fill" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? 'You' : 'Agent'}</span>
          {badge && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
          {pending ? (
            <span className="text-xs italic text-muted-foreground">Sending…</span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>
              {status && (
                <span className="text-xs" title={status.label} aria-label={status.label}>
                  {status.emoji}
                </span>
              )}
            </>
          )}
        </div>
        <div
          className="chat-markdown prose prose-sm dark:prose-invert mt-0.5 max-w-none [&_p]:m-0"
          onClick={handleCodeCopy}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {post.attachment && (
          <button
            type="button"
            onClick={() => window.electronAPI.shell.openPath(post.attachment!.path)}
            title={`Open ${post.attachment.filename}`}
            className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{post.attachment.filename}</span>
          </button>
        )}
      </div>
    </div>
  );
});

export function ThreadPostsView({ posts, liveStatus }: { posts: ThreadPost[]; liveStatus: ThreadPostStatus | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The live transient badge attaches to the most recent prompt — the turn currently in flight.
  const latestPromptId = useMemo(() => {
    for (let i = posts.length - 1; i >= 0; i--) {
      if (posts[i].kind === 'prompt') return posts[i].id;
    }
    return null;
  }, [posts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [posts.length]);

  return (
    <ScrollArea viewportRef={containerRef} className="h-full">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-6 py-6">
        {posts.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No thread messages yet. Prompts and the agent&apos;s updates will appear here.
          </div>
        ) : (
          posts.map((post) => (
            <PostRow key={post.id} post={post} live={post.id === latestPromptId ? liveStatus : null} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
