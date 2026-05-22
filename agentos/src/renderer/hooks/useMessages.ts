import { useEffect, useMemo, useState } from 'react';
import stripAnsi from 'strip-ansi';
import type { Message, MessageContentBlock, Thread } from '../../shared/types';
import { extractCodexStreamBlocks, extractGeminiStreamBlocks, extractStreamBlocks } from '../lib/streamParsers';

type MessagesState = {
  messages: Message[];
  streamingBlocks: MessageContentBlock[];
  isStreaming: boolean;
};

export function useMessages(thread: Thread | null): MessagesState {
  const threadId = thread?.id ?? null;
  const isRunning = thread?.status === 'running';
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingRaw, setStreamingRaw] = useState('');

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setStreamingRaw('');
      return;
    }

    let cancelled = false;

    // Load persisted messages
    window.electronAPI.messages.list(threadId).then((list) => {
      if (!cancelled) setMessages(list);
    });

    // Seed streaming view with only the current in-progress turn (not persisted history)
    if (isRunning) {
      window.electronAPI.messages.pending(threadId).then((raw) => {
        if (!cancelled && raw) setStreamingRaw(raw);
      });
    } else {
      setStreamingRaw('');
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;

    const unsubMessage = window.electronAPI.on.messageAppended((event) => {
      if (event.threadId !== threadId) return;
      setMessages((prev) => {
        if (prev.some((msg) => msg.id === event.message.id)) return prev;
        return [...prev, event.message];
      });
      if (event.message.role === 'assistant') {
        setStreamingRaw('');
      }
    });

    const unsubTerminal = window.electronAPI.on.terminalData((event) => {
      if (event.threadId !== threadId || !isRunning) return;
      setStreamingRaw((prev) => `${prev}${event.data}`);
    });

    const unsubStatus = window.electronAPI.on.threadStatus((event) => {
      if (event.threadId !== threadId) return;
      if (event.status !== 'running') {
        setStreamingRaw('');
      }
    });

    return () => {
      unsubMessage();
      unsubTerminal();
      unsubStatus();
    };
  }, [threadId, isRunning]);

  const streamingBlocks = useMemo(() => {
    const cleaned = stripAnsi(streamingRaw).trim();
    if (!cleaned) return [];
    if (thread?.provider === 'codex') return extractCodexStreamBlocks(cleaned);
    if (thread?.provider === 'gemini') return extractGeminiStreamBlocks(cleaned);
    return extractStreamBlocks(cleaned);
  }, [streamingRaw, thread?.provider]);

  return {
    messages,
    streamingBlocks,
    isStreaming: Boolean(threadId && isRunning),
  };
}
