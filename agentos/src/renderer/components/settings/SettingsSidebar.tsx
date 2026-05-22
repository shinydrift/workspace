import React, { useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useAppVersion } from '../../hooks/useAppVersion';
import type { Tab, SettingsSection } from './settingsTypes';

interface Props {
  sections: SettingsSection[];
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function SettingsSidebar({ sections, activeTab, onTabChange }: Props) {
  const [search, setSearch] = useState('');
  const appVersion = useAppVersion();
  const s = useSettings();

  function getTabStatus(tabId: Tab): 'warn' | null {
    if (tabId === 'keys' && !s.keys.anthropic) return 'warn';
    if (tabId === 'slack' && s.slack.enabled && (!s.slack.botToken || !s.slack.appToken)) return 'warn';
    return null;
  }

  const filteredSections = useMemo(() => {
    const searchLower = search.toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        tabs: section.tabs.filter((t) => t.label.toLowerCase().includes(searchLower)),
      }))
      .filter((section) => section.tabs.length > 0);
  }, [search, sections]);

  return (
    <div className="flex flex-col border-r border-border w-52 shrink-0 bg-muted/30">
      <div className="px-3 py-3 border-b border-border">
        <div className="relative">
          <MagnifyingGlass
            size={14}
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

      <ScrollArea className="flex-1">
        <div role="tablist" aria-orientation="vertical" className="py-2">
          {filteredSections.map((section) => (
            <div key={section.label} className="mb-1">
              <p className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
                {section.label}
              </p>
              {section.tabs.map((t) => {
                const status = getTabStatus(t.id);
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`tabpanel-${t.id}`}
                    onClick={() => onTabChange(t.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    )}
                  >
                    <t.Icon className="w-[1em] h-[1em] shrink-0" />
                    <span className="flex-1 truncate">{t.label}</span>
                    {status === 'warn' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-status-warning shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>Version {appVersion ?? '...'}</span>
      </div>
    </div>
  );
}
