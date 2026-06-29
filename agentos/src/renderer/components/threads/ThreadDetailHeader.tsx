import React, { useState } from 'react';
import type { Thread, ThreadInjectionStatus, SlackChannelOption } from '../../../shared/types';
import { MODEL_LABEL, PROVIDER_LABEL } from '../../../shared/types/provider';
import { CheckCircle, HourglassSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import { Tooltip } from '../ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { DetailView } from './ThreadDetail';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  thread: Thread;
  detailView: DetailView;
  hasInsightsData: boolean;
  devMode: boolean;
  injectionStatus: ThreadInjectionStatus;
  onViewChange: (view: DetailView) => void;
}

export function ThreadDetailHeader({
  thread,
  detailView,
  hasInsightsData,
  devMode,
  injectionStatus,
  onViewChange,
}: Props) {
  const isTaskMainThread = thread.agentRole === 'task-main' && !!thread.taskId;

  const [shareOpen, setShareOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);
  const [taskMeta, setTaskMeta] = useState<{ slackShareChannelId?: string; slackShareThreadTs?: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openShareDialog() {
    setError(null);
    setMessage('');
    setSharing(false);

    const [task, fetchedChannels] = await Promise.all([
      window.electronAPI.kanban.get(thread.projectId, thread.taskId!),
      channels.length === 0 ? window.electronAPI.slack.listChannels() : Promise.resolve(channels),
    ]);

    if (fetchedChannels.length !== channels.length) setChannels(fetchedChannels);

    const meta = task?.metadata as { slackShareChannelId?: string; slackShareThreadTs?: string } | undefined;
    setTaskMeta(meta ?? {});

    if (!meta?.slackShareChannelId && fetchedChannels.length > 0) {
      setChannelId(fetchedChannels[0].id);
    }

    setShareOpen(true);
  }

  async function handleShare() {
    if (!message.trim() || !thread.taskId) return;
    const targetChannelId = taskMeta?.slackShareChannelId ?? channelId;
    if (!targetChannelId) {
      setError('Select a Slack channel');
      return;
    }
    setSharing(true);
    setError(null);
    try {
      await window.electronAPI.kanban.shareSlackUpdate(
        thread.projectId,
        thread.taskId,
        message.trim(),
        targetChannelId
      );
      setShareOpen(false);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share update');
    } finally {
      setSharing(false);
    }
  }

  const existingChannelId = taskMeta?.slackShareChannelId;
  const existingChannel = channels.find((c) => c.id === existingChannelId);
  const isFirstShare = !existingChannelId;

  return (
    <div className="flex items-center justify-between px-4 h-14">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{thread.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{thread.workingDirectory}</span>
          {thread.provider || thread.model ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-foreground/60">
              {thread.model
                ? (MODEL_LABEL[thread.model] ?? thread.model)
                : (PROVIDER_LABEL[thread.provider as keyof typeof PROVIDER_LABEL] ?? thread.provider)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <ToggleGroup
          type="single"
          value={detailView}
          onValueChange={(v) => {
            if (v) onViewChange(v as DetailView);
          }}
          className="mr-2 rounded-lg bg-muted p-0.5"
        >
          {(['thread', 'chat', 'terminal', 'insights'] as const)
            .filter((v) => v !== 'insights' || hasInsightsData)
            .filter((v) => v !== 'terminal' || devMode)
            .map((view) => (
              <ToggleGroupItem
                key={view}
                value={view}
                className="h-auto px-2 py-1 text-xs capitalize rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=off]:text-muted-foreground hover:bg-transparent hover:text-muted-foreground data-[state=on]:hover:bg-background data-[state=on]:hover:text-foreground"
              >
                {view}
              </ToggleGroupItem>
            ))}
        </ToggleGroup>
        {injectionStatus.hasMemory && (
          <Tooltip content="Persistent project memory was injected for this thread">
            <span className="rounded bg-muted px-2 py-0.5 text-foreground/80 cursor-default">MEM</span>
          </Tooltip>
        )}
        {injectionStatus.hasBoot && (
          <Tooltip content="BOOT instructions were injected for this thread">
            <span className="rounded bg-muted px-2 py-0.5 text-foreground/80 cursor-default">BOOT</span>
          </Tooltip>
        )}
        <Tooltip content={injectionStatus.injected ? 'Startup loaded' : 'Startup pending'}>
          <span className="flex items-center text-muted-foreground">
            {injectionStatus.injected ? (
              <CheckCircle weight="fill" className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <HourglassSimple weight="fill" className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
          </span>
        </Tooltip>
        {isTaskMainThread && (
          <>
            <Tooltip content="Share update to Slack">
              <button
                onClick={() => void openShareDialog()}
                className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <PaperPlaneTilt className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Dialog open={shareOpen} onOpenChange={setShareOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Share Update to Slack</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {isFirstShare ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Post to channel</p>
                      <Select value={channelId} onValueChange={setChannelId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select a channel…" />
                        </SelectTrigger>
                        <SelectContent>
                          {channels.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              #{c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Reply to Slack thread in{' '}
                      <span className="font-medium text-foreground">#{existingChannel?.name ?? existingChannelId}</span>
                    </p>
                  )}
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What's the update?"
                    className="min-h-[100px] resize-none text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleShare();
                    }}
                  />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setShareOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void handleShare()} disabled={sharing || !message.trim()}>
                    {sharing ? 'Sharing…' : 'Share'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
