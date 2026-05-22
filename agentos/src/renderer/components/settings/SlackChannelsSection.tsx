import React, { useMemo } from 'react';
import { List } from '@/components/ui/list';
import { useSettings } from '../../contexts/SettingsContext';
import { ChannelListItem } from './ChannelListItem';

export function SlackChannelsSection() {
  const { slack } = useSettings();

  const channelMap = useMemo(() => new Map(slack.discoveredChannels.map((c) => [c.id, c])), [slack.discoveredChannels]);
  const projectMap = useMemo(() => new Map(slack.projects.map((p) => [p.id, p])), [slack.projects]);

  function setSlackChannelMapping(channelId: string, mappingValue: string) {
    slack.setChannelWorkspaceMap((prev) => {
      const next = { ...prev };
      if (!mappingValue) {
        delete next[channelId];
      } else {
        next[channelId] = mappingValue;
      }
      return next;
    });
  }

  function getMappingLabel(channelId: string): string {
    const val = slack.channelWorkspaceMap[channelId];
    if (!val) return 'No project';
    if (val.startsWith('project:')) {
      const id = val.slice('project:'.length);
      return projectMap.get(id)?.name ?? id;
    }
    return val.split('/').pop() || val;
  }

  async function browseForChannel(channelId: string) {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) setSlackChannelMapping(channelId, dir);
  }

  function removeSlackChannel(channelId: string) {
    slack.setChannels((prev) => prev.filter((id) => id !== channelId));
    slack.setChannelWorkspaceMap((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Channels</p>
        {slack.discoveryLoading && <span className="text-xs text-muted-foreground">Discovering…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Channels where the bot is a member are discovered automatically after saving when the bridge is enabled.
      </p>
      <List
        empty={slack.channels.length === 0}
        emptyText={slack.botToken && slack.appToken ? 'Save to discover channels.' : 'Provide both tokens, then save.'}
      >
        {slack.channels.map((channelId) => (
          <ChannelListItem
            key={channelId}
            channelId={channelId}
            channel={channelMap.get(channelId)}
            mappingLabel={getMappingLabel(channelId)}
            projects={slack.projects}
            onSetMapping={(value) => setSlackChannelMapping(channelId, value)}
            onBrowse={() => browseForChannel(channelId)}
            onRemove={() => removeSlackChannel(channelId)}
          />
        ))}
      </List>
    </div>
  );
}
