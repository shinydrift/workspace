import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Message, MessageContentBlock } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import { StreamingMessageView } from './StreamingMessageView';
import { coalesceToolOnlyMessages } from './messageUtils';

type MessageGroup = {
  id: string;
  role: Message['role'];
  messages: Message[];
};

type Props = {
  messages: Message[];
  isStreaming: boolean;
  streamingBlocks: MessageContentBlock[];
};

// Pair each autopilot-decision with the autopilot message that follows it.
// If no autopilot message follows (stop case), emit the decision before the next human message.
function reorderWithDecisions(messages: Message[]): Message[] {
  const result: Message[] = [];
  let pending: Message | null = null;
  for (const msg of messages) {
    if (msg.source === 'autopilot-decision') {
      if (pending) result.push(pending);
      pending = msg;
    } else if (msg.source === 'autopilot' && pending) {
      result.push(msg);
      result.push(pending);
      pending = null;
    } else {
      if (pending) {
        result.push(pending);
        pending = null;
      }
      result.push(msg);
    }
  }
  if (pending) result.push(pending);
  return result;
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === msg.role) {
      last.messages.push(msg);
      continue;
    }
    groups.push({ id: msg.id, role: msg.role, messages: [msg] });
  }
  for (const group of groups) {
    group.messages = coalesceToolOnlyMessages(reorderWithDecisions(group.messages));
  }
  return groups;
}

const PAGE_SIZE = 100;

export function MessageList({ messages, isStreaming, streamingBlocks }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const [visibleStart, setVisibleStart] = useState(() => Math.max(0, messages.length - PAGE_SIZE));

  // When new messages arrive keep the window anchored to the end
  useEffect(() => {
    setVisibleStart((prev) => {
      const naturalStart = Math.max(0, messages.length - PAGE_SIZE);
      // Only advance if we were already showing the tail (not scrolled into history)
      return prev >= naturalStart ? naturalStart : prev;
    });
  }, [messages.length]);

  const visibleMessages = useMemo(
    () => (messages.length > PAGE_SIZE && visibleStart > 0 ? messages.slice(visibleStart) : messages),
    [messages, visibleStart]
  );
  const hiddenCount = visibleStart;

  const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
  };

  // New committed message — reset scroll lock and scroll into view
  useEffect(() => {
    userScrolledRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // Keep up with growing content while streaming, unless user has scrolled up
  useEffect(() => {
    if (!isStreaming || userScrolledRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [streamingBlocks, isStreaming]);

  return (
    <ScrollArea viewportRef={containerRef} onViewportScroll={handleScroll} className="h-full">
      <div className="flex w-full flex-col gap-6 px-6 py-6 max-w-[1200px] mx-auto">
        {hiddenCount > 0 && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setVisibleStart((prev) => Math.max(0, prev - PAGE_SIZE))}
            >
              Show {Math.min(hiddenCount, PAGE_SIZE)} older messages ({hiddenCount} hidden)
            </Button>
          </div>
        )}
        {groups.map((group, groupIdx) => (
          <div key={group.id} className="flex flex-col gap-1 items-start">
            {group.messages.map((message, msgIdx) => {
              const isLastGroup = groupIdx === groups.length - 1;
              const isLatest = isLastGroup && msgIdx === group.messages.length - 1 && !isStreaming;
              return <MessageBubble key={message.id} message={message} isLatest={isLatest} />;
            })}
          </div>
        ))}

        {isStreaming && <StreamingMessageView streamingBlocks={streamingBlocks} />}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
