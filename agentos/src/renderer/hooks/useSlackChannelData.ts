import { useEffect, useMemo, useState } from 'react';
import type { SlackChannelOption } from '../../shared/types';

export function useSlackChannelData(projectId: string) {
  const [allSlackChannels, setAllSlackChannels] = useState<SlackChannelOption[]>([]);
  const [channelWorkspaceMap, setChannelWorkspaceMap] = useState<Record<string, string>>({});

  useEffect(() => {
    window.electronAPI.slack
      .listChannels()
      .then(setAllSlackChannels)
      .catch(() => {});
    window.electronAPI.settings
      .get()
      .then((s) => setChannelWorkspaceMap(s?.slack?.channelWorkspaceMap ?? {}))
      .catch(() => {});
  }, []);

  const projectChannelIds = useMemo(
    () =>
      new Set(
        Object.entries(channelWorkspaceMap)
          .filter(([, mapping]) => mapping === `project:${projectId}`)
          .map(([channelId]) => channelId)
      ),
    [channelWorkspaceMap, projectId]
  );

  const slackChannels = useMemo(
    () => allSlackChannels.filter((c) => projectChannelIds.has(c.id)),
    [allSlackChannels, projectChannelIds]
  );

  return { slackChannels };
}
