import React, { useMemo, useState } from 'react';
import {
  Brain,
  Code,
  Gear,
  GitBranch,
  Key,
  MagnifyingGlass,
  Microphone,
  Robot,
  Rocket,
  Shield,
  Smiley,
  SquaresFour,
  Terminal,
  Warning,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FEATURES } from '../../../shared/features';

export type SectionId =
  | 'general'
  | 'keys'
  | 'agents'
  | 'autopilot'
  | 'personality'
  | 'recording'
  | 'sandbox'
  | 'env'
  | 'containers'
  | 'memory'
  | 'code'
  | 'kanban'
  | 'danger';

interface NavItem {
  id: SectionId;
  label: string;
  Icon: Icon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'General',
    items: [{ id: 'general', label: 'General', Icon: Gear }],
  },
  {
    label: 'AI',
    items: [
      { id: 'keys', label: 'Keys', Icon: Key },
      { id: 'agents', label: 'Agents', Icon: Robot },
      { id: 'autopilot', label: 'Autopilot', Icon: Rocket },
      { id: 'personality', label: 'Personality', Icon: Smiley },
      ...(FEATURES.MEETINGS ? [{ id: 'recording' as const, label: 'Recording', Icon: Microphone }] : []),
    ],
  },
  {
    label: 'Storage',
    items: [
      { id: 'memory', label: 'Memory', Icon: Brain },
      { id: 'code', label: 'Code', Icon: Code },
      { id: 'env', label: 'Environment', Icon: Terminal },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'sandbox', label: 'Sandbox', Icon: Shield },
      { id: 'containers', label: 'Containers', Icon: GitBranch },
    ],
  },
  {
    label: 'Advanced',
    items: [
      ...(FEATURES.KANBAN ? [{ id: 'kanban' as const, label: 'Kanban', Icon: SquaresFour }] : []),
      { id: 'danger', label: 'Danger zone', Icon: Warning },
    ],
  },
];

interface Props {
  activeSection: SectionId;
  onSectionChange: (id: SectionId) => void;
}

export function ProjectSettingsNav({ activeSection, onSectionChange }: Props) {
  const [search, setSearch] = useState('');

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase();
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => item.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [search]);

  return (
    <div className="flex flex-col border-r border-border w-48 shrink-0 bg-muted/30">
      <div className="px-3 py-3 border-b border-border">
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
          <Input
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 py-2">
        {filteredGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <p className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  <item.Icon size={15} />
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
