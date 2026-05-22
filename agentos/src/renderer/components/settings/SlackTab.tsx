import React from 'react';
import { Separator } from '@/components/ui/separator';
import { ToggleRow } from '@/components/ui/toggle-row';
import { useSettings } from '../../contexts/SettingsContext';
import { SlackConnectionSection } from './SlackConnectionSection';
import { SlackWorkspaceRootSection } from './SlackWorkspaceRootSection';
import { SlackChannelsSection } from './SlackChannelsSection';
import { SlackAdvancedSection } from './SlackAdvancedSection';

export function SlackTab() {
  const { slack } = useSettings();

  return (
    <>
      <ToggleRow
        label="Slack bridge"
        description="Listens for Slack thread messages over Socket Mode and posts AgentOS updates back into the same thread."
        checked={slack.enabled}
        onCheckedChange={(v) => slack.setEnabled(v)}
      />

      <SlackConnectionSection />

      {slack.enabled && (
        <>
          <Separator />
          <SlackWorkspaceRootSection />

          <Separator />
          <SlackChannelsSection />

          <Separator />
          <SlackAdvancedSection />
        </>
      )}
    </>
  );
}
