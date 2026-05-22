import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSettings } from '../../contexts/SettingsContext';

export function SlackWorkspaceRootSection() {
  const { slack } = useSettings();

  async function pickSlackRootDirectory() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) slack.setDefaultWorkingDirectory(dir);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Workspace Root</p>
      <p className="text-xs text-muted-foreground">
        Unmapped channels will automatically create and use a folder inside this root.
      </p>
      <div className="flex gap-2">
        <Input
          value={slack.defaultWorkingDirectory}
          onChange={(e) => slack.setDefaultWorkingDirectory(e.target.value)}
          placeholder="/Users/you/slack-workspaces"
          className="flex-1"
        />
        <Button onClick={pickSlackRootDirectory} variant="outline" type="button">
          Browse
        </Button>
        <Button onClick={() => slack.setDefaultWorkingDirectory('')} variant="outline" type="button">
          Clear
        </Button>
      </div>
    </div>
  );
}
