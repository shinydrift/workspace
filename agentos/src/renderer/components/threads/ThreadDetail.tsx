import React, { useEffect, useState } from 'react';
import type { Thread, ThreadInjectionStatus } from '../../../shared/types';
import { useUIStore } from '../../store/uiStore';
import { useDomainStore } from '../../store/domainStore';
import { useInsightsStore } from '../../store/insightsStore';
import { TerminalPane } from '../terminal/TerminalPane';
import { PromptInput } from '../prompt/PromptInput';
import { MessageList } from '../chat/MessageList';
import { ThreadInsightsPanel } from '../insights/ThreadInsightsPanel';
import { useMessages } from '../../hooks/useMessages';
import { ThreadDetailHeader } from './ThreadDetailHeader';
import { CouncilRunPanel } from '../chat/CouncilRunPanel';
import { TaskSheetPanel } from '../board/TaskSheetPanel';
import { ContentCard } from '@/components/ui/content-card';
import { ScrollFade } from '@/components/ui/scroll-fade';

export type DetailView = 'chat' | 'terminal' | 'insights';

interface Props {
  thread: Thread;
  noCard?: boolean;
  initialView?: DetailView;
}

export function ThreadDetail({ thread, noCard, initialView }: Props) {
  const { threadView, setThreadView, devMode } = useUIStore();
  const { upsertThread } = useDomainStore();
  const hasInsightsData = useInsightsStore((s) => !!s.sessionMetrics[thread.id]);
  const [detailView, setDetailView] = useState<DetailView>(initialView ?? 'chat');
  const [injectionStatus, setInjectionStatus] = useState<ThreadInjectionStatus>({
    hasBoot: false,
    hasMemory: false,
    injected: false,
  });
  const { messages, streamingBlocks, isStreaming } = useMessages(thread);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      window.electronAPI.thread
        .getInjectionStatus(thread.id)
        .then((status) => {
          if (!cancelled)
            setInjectionStatus((prev) =>
              prev.hasBoot === status.hasBoot &&
              prev.hasMemory === status.hasMemory &&
              prev.injected === status.injected &&
              prev.error === status.error
                ? prev
                : status
            );
        })
        .catch((err) => {
          console.warn('Failed to get injection status', err);
        });
    };
    refresh();
    const intervalId = window.setInterval(refresh, thread.status === 'running' ? 1500 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [thread.id, thread.status]);

  useEffect(() => {
    setDetailView(threadView);
  }, [threadView]);

  useEffect(() => {
    if (detailView === 'insights' && !hasInsightsData && initialView !== 'insights') setDetailView('chat');
  }, [detailView, hasInsightsData, initialView]);

  const header = (
    <ThreadDetailHeader
      thread={thread}
      detailView={detailView}
      hasInsightsData={hasInsightsData}
      devMode={devMode}
      injectionStatus={injectionStatus}
      onViewChange={(view: DetailView) => {
        setDetailView(view);
        if (view === 'chat' || view === 'terminal') setThreadView(view);
      }}
    />
  );

  const body = (
    <>
      {detailView === 'terminal' && <TerminalPane threadId={thread.id} />}
      <div className={detailView === 'chat' ? 'relative flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ScrollFade />
        <MessageList messages={messages} isStreaming={isStreaming} streamingBlocks={streamingBlocks} />
      </div>
      <div className={detailView === 'insights' ? 'flex-1 min-h-0' : 'hidden'}>
        <ThreadInsightsPanel thread={thread} />
      </div>
      {detailView === 'chat' && <TaskSheetPanel threadId={thread.id} />}
      {detailView === 'chat' && <CouncilRunPanel threadId={thread.id} />}
      {detailView === 'chat' && (
        <div className="p-3 max-w-[1200px] w-full mx-auto">
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <PromptInput
              threadId={thread.id}
              isRunning={
                (thread.queueDepth ?? 0) > 0 || thread.autopilotState === 'thinking' || thread.autopilotState === 'sent'
              }
              onStop={() => window.electronAPI.thread.stop(thread.id)}
              autopilotEnabled={thread.autopilotEnabled}
              onToggleAutopilot={async () => {
                const updated = await window.electronAPI.thread.setAutopilot(thread.id, !thread.autopilotEnabled);
                upsertThread(updated);
              }}
            />
          </div>
        </div>
      )}
    </>
  );

  if (noCard)
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {header}
        {body}
      </div>
    );

  return (
    <ContentCard>
      {header}
      <div className="flex-1 min-h-0 flex flex-col">{body}</div>
    </ContentCard>
  );
}
