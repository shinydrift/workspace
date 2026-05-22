import { useState, useEffect } from 'react';
import type { AppSettings, SavedProject, SlackChannelOption } from '../../../shared/types';
import { DEFAULT_SLACK_SETTINGS } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

function merged(s: AppSettings) {
  return { ...DEFAULT_SLACK_SETTINGS, ...(s.slack ?? {}) };
}

export function useSlackSettings(settings: AppSettings | null) {
  const [enabled, setEnabled] = useSettingsField(
    settings,
    (s) => Boolean(merged(s).enabled),
    DEFAULT_SLACK_SETTINGS.enabled
  );
  const [botToken, setBotToken] = useSettingsField(
    settings,
    (s) => merged(s).botToken ?? '',
    DEFAULT_SLACK_SETTINGS.botToken ?? ''
  );
  const [appToken, setAppToken] = useSettingsField(
    settings,
    (s) => merged(s).appToken ?? '',
    DEFAULT_SLACK_SETTINGS.appToken ?? ''
  );
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useSettingsField(
    settings,
    (s) => merged(s).defaultWorkingDirectory ?? '',
    DEFAULT_SLACK_SETTINGS.defaultWorkingDirectory ?? ''
  );
  const [channels, setChannels] = useSettingsField(settings, (s) => merged(s).watchedChannelIds, []);
  const [channelWorkspaceMap, setChannelWorkspaceMap] = useSettingsField(
    settings,
    (s) => merged(s).channelWorkspaceMap ?? {},
    {}
  );
  const [requireMention, setRequireMention] = useSettingsField(
    settings,
    (s) => Boolean(merged(s).requireMention),
    DEFAULT_SLACK_SETTINGS.requireMention
  );

  const [discoveredChannels, setDiscoveredChannels] = useState<SlackChannelOption[]>([]);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  async function discoverChannels() {
    setDiscoveryLoading(true);
    try {
      const found = await window.electronAPI.slack.listChannels();
      setDiscoveredChannels(found);
      setChannels((prev) => [...new Set([...prev, ...found.map((item) => item.id)])]);
    } finally {
      setDiscoveryLoading(false);
    }
  }

  // Trigger channel discovery once tokens are loaded (read from settings directly, not state, to avoid stale closure)
  useEffect(() => {
    if (!settings) return;
    const slack = merged(settings);
    if (slack.botToken?.trim() && slack.appToken?.trim()) {
      void discoverChannels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    window.electronAPI.project
      .list()
      .then((items) => setProjects(items))
      .catch((err) => {
        console.warn('Failed to load projects', err);
      });
  }, []);

  return {
    enabled,
    setEnabled,
    botToken,
    setBotToken,
    appToken,
    setAppToken,
    defaultWorkingDirectory,
    setDefaultWorkingDirectory,
    channels,
    setChannels,
    channelWorkspaceMap,
    setChannelWorkspaceMap,
    discoveredChannels,
    projects,
    discoveryLoading,
    requireMention,
    setRequireMention,
    discoverChannels,
  };
}
