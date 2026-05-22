import React, { useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Brain,
  Check,
  CircleNotch,
  Code,
  Cube,
  Gear,
  Heart,
  Info,
  Key,
  Microphone,
  Palette,
  Robot,
  Scroll,
  UsersThree,
  Shield,
  SlackLogo,
  Terminal,
  Rocket,
  X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SandboxSettings } from './SandboxSettings';
import type { Tab, SettingsSection } from './settingsTypes';
import { KeysTab } from './KeysTab';
import { AgentsTab } from './AgentsTab';
import { AutopilotTab } from './AutopilotTab';
import { SlackTab } from './SlackTab';
import { MemoryTab } from './MemoryTab';
import { CodeTab } from './CodeTab';
import { ContainersTab } from './ContainersTab';
import { HealthPanel } from '../health/HealthPanel';
import { EnvTab } from './EnvTab';
import { LogsTab } from './LogsTab';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
import { AppearanceTab } from './AppearanceTab';
import { RecordingTab } from './RecordingTab';
import { CouncilTab } from './CouncilTab';
import { AboutTab } from './AboutTab';
import { SettingsSidebar } from './SettingsSidebar';
import { FEATURES } from '../../../shared/features';

const SECTIONS: SettingsSection[] = [
  {
    label: 'General',
    tabs: [
      { id: 'appearance', label: 'Appearance', Icon: Palette },
      ...(FEATURES.MEETINGS ? [{ id: 'recording' as const, label: 'Recording', Icon: Microphone }] : []),
    ],
  },
  {
    label: 'AI',
    tabs: [
      { id: 'keys', label: 'Keys', Icon: Key },
      { id: 'agents', label: 'Agents', Icon: Robot },
      { id: 'autopilot', label: 'Autopilot', Icon: Rocket },
      { id: 'council', label: 'Council', Icon: UsersThree },
    ],
  },
  {
    label: 'Integrations',
    tabs: [{ id: 'slack', label: 'Slack', Icon: SlackLogo }],
  },
  {
    label: 'Storage',
    tabs: [
      { id: 'memory', label: 'Memory', Icon: Brain },
      { id: 'code', label: 'Code', Icon: Code },
      { id: 'env', label: 'Environment', Icon: Terminal },
    ],
  },
  {
    label: 'System',
    tabs: [
      { id: 'sandbox', label: 'Sandbox', Icon: Shield },
      { id: 'containers', label: 'Containers', Icon: Cube },
      { id: 'health', label: 'Health', Icon: Heart },
      { id: 'logs', label: 'Event Logs', Icon: Scroll },
    ],
  },
  {
    label: 'About',
    tabs: [{ id: 'about', label: 'About', Icon: Info }],
  },
];

interface Props {
  onClose: () => void;
}

function SettingsModalContent({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('appearance');
  const s = useSettings();

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent hideClose className="w-[820px] max-w-[95vw] gap-0 p-0">
        {/* Header */}
        <div className="flex items-center justify-between py-3.5 px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Gear size={16} className="text-muted-foreground" />
            <SheetTitle>Application Settings</SheetTitle>
            {s.saving && <CircleNotch className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
            {s.saved && !s.saving && <Check className="h-3.5 w-3.5 text-status-success" />}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={16} />
          </Button>
        </div>

        <div className="flex flex-row flex-1 overflow-hidden">
          {/* Sidebar */}
          <SettingsSidebar sections={SECTIONS} activeTab={tab} onTabChange={setTab} />

          {/* Tab content */}
          <div
            key={tab}
            id={`tabpanel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="flex-1 animate-in fade-in-0 duration-150 overflow-hidden"
          >
            {tab === 'logs' ? (
              <LogsTab />
            ) : (
              <ScrollArea className="h-full">
                <div className="px-8 py-6 space-y-4">
                  {tab === 'appearance' && <AppearanceTab />}
                  {FEATURES.MEETINGS && tab === 'recording' && <RecordingTab />}
                  {tab === 'keys' && <KeysTab />}
                  {tab === 'agents' && <AgentsTab />}
                  {tab === 'autopilot' && <AutopilotTab />}
                  {tab === 'slack' && <SlackTab />}
                  {tab === 'sandbox' && <SandboxSettings />}
                  {tab === 'memory' && <MemoryTab />}
                  {tab === 'code' && <CodeTab />}
                  {tab === 'env' && <EnvTab />}
                  {tab === 'health' && <HealthPanel />}
                  {tab === 'containers' && <ContainersTab />}
                  {tab === 'council' && <CouncilTab />}
                  {tab === 'about' && <AboutTab />}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SettingsModal({ onClose }: Props) {
  return (
    <SettingsProvider>
      <SettingsModalContent onClose={onClose} />
    </SettingsProvider>
  );
}
