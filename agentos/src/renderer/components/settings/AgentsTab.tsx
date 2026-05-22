import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleRow } from '@/components/ui/toggle-row';
import { SettingSection } from '@/components/ui/setting-section';
import { useSettings } from '../../contexts/SettingsContext';
import { useUIStore } from '../../store/uiStore';
import { ProviderPriorityList } from './ProviderPriorityList';

export function AgentsTab() {
  const { agents } = useSettings();
  const devMode = useUIStore((s) => s.devMode);

  return (
    <>
      <SettingSection title="Command Queue" description="Controls silence fallback used to detect turn completion.">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="queue-silence-fallback">Silence Fallback (ms)</Label>
            <Input
              id="queue-silence-fallback"
              type="number"
              min={200}
              value={agents.queueSilenceFallbackMs}
              onChange={(e) => agents.setQueueSilenceFallbackMs(Number(e.target.value) || 1500)}
            />
          </div>
        </div>
      </SettingSection>

      <Separator />

      <SettingSection
        title="Provider Priority"
        description="Used whenever AgentOS needs to pick a provider automatically. First item wins."
      >
        <ProviderPriorityList order={agents.providerOrder} onChange={agents.setProviderOrder} />
      </SettingSection>

      {devMode && (
        <>
          <Separator />

          <div className="space-y-2">
            <ToggleRow
              label="Debug Logs"
              description="Enable debug logs (live panel + disk persistence)"
              checked={agents.persistDebugLogs}
              onCheckedChange={(v) => agents.setPersistDebugLogs(v)}
            />
          </div>
        </>
      )}

      <Separator />

      <div className="space-y-2">
        <ToggleRow
          label="Voice"
          description="Read agent responses aloud (macOS only, uses built-in say command)"
          checked={agents.ttsEnabled}
          onCheckedChange={(v) => agents.setTtsEnabled(v)}
        />
        <p className="text-xs text-muted-foreground">
          Use the mic button in the chat input to dictate messages. Transcription runs locally on-device.
        </p>
      </div>
    </>
  );
}
