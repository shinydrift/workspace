import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useSettings } from '../../contexts/SettingsContext';

export function SlackAdvancedSection() {
  const { slack } = useSettings();
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Advanced</p>
      <div className="flex items-center gap-2">
        <Switch
          id="slack-require-mention"
          checked={slack.requireMention}
          onCheckedChange={(v) => slack.setRequireMention(Boolean(v))}
        />
        <Label htmlFor="slack-require-mention" className="font-normal">
          Require @ mention to start a new task
        </Label>
      </div>
      <p className="text-xs text-muted-foreground pl-9">
        When on, AgentOS ignores new channel messages unless the bot is @ mentioned. Replies in existing threads always
        pass through.
      </p>
    </div>
  );
}
