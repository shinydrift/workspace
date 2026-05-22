import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingSection } from '@/components/ui/setting-section';
import { useSettings } from '../../contexts/SettingsContext';

export function SlackConnectionSection() {
  const { slack } = useSettings();
  return (
    <SettingSection title="Connection" className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slack-token">Bot Token</Label>
        <Input
          id="slack-token"
          type="password"
          value={slack.botToken}
          onChange={(e) => slack.setBotToken(e.target.value)}
          placeholder="xoxb-..."
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slack-app-token">App Token (Socket Mode)</Label>
        <Input
          id="slack-app-token"
          type="password"
          value={slack.appToken}
          onChange={(e) => slack.setAppToken(e.target.value)}
          placeholder="xapp-..."
          autoComplete="off"
        />
      </div>
    </SettingSection>
  );
}
