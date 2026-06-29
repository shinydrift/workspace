import React, { memo, useEffect, useMemo, useRef } from 'react';
import type { ThreadPost } from '../../../shared/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { renderMarkdown } from '../../lib/markdown';
import { handleCodeCopy } from '../chat/messageUtils';
import { Robot, User, Paperclip } from '@phosphor-icons/react';

const KIND_LABEL: Record<Exclude<ThreadPost['kind'], 'prompt'>, string> = {
  update: 'Update',
  clarification: 'Question',
  file: 'File',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const PostRow = memo(function PostRow({ post }: { post: ThreadPost }) {
  const isUser = post.author === 'user';
  const html = useMemo(() => renderMarkdown(post.text), [post.text]);
  const badge = post.kind === 'prompt' ? null : KIND_LABEL[post.kind];

  return (
    <div className="flex gap-3">
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          isUser ? 'bg-muted text-foreground/70' : 'bg-primary/10 text-primary'
        }`}
      >
        {isUser ? <User className="h-4 w-4" weight="fill" /> : <Robot className="h-4 w-4" weight="fill" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? 'You' : 'Agent'}</span>
          {badge && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>
        </div>
        <div
          className="chat-markdown prose prose-sm dark:prose-invert mt-0.5 max-w-none [&_p]:m-0"
          onClick={handleCodeCopy}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {post.attachment && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="truncate">{post.attachment.filename}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export function ThreadPostsView({ posts }: { posts: ThreadPost[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
          posts.map((post) => <PostRow key={post.id} post={post} />)
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
