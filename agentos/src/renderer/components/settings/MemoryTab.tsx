import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ToggleRow } from '@/components/ui/toggle-row';
import { SettingSection } from '@/components/ui/setting-section';
import { useSettings } from '../../contexts/SettingsContext';
import { EmbeddingProviderSection } from './EmbeddingProviderSection';
import { SearchTuningSection } from './SearchTuningSection';

export function MemoryTab() {
  const { memory } = useSettings();

  return (
    <>
      <p className="text-xs text-muted-foreground mb-4">
        Memory files (MEMORY.md, BOOT.md) and indexes are stored at{' '}
        <code>~/.agentos/memory/projects/&lt;projectId&gt;/</code> by default.
      </p>

      <EmbeddingProviderSection />

      <SearchTuningSection />

      {/* ── Extra memory paths ── */}
      <div className="mt-4 space-y-2">
        <Label className="text-sm font-medium">Extra memory paths</Label>
        <p className="text-xs text-muted-foreground">
          Additional directories to index as read-only memory sources (one absolute path per line).
        </p>
        <Textarea
          className="text-xs font-mono min-h-[72px] resize-y"
          value={memory.extraMemoryPaths.join('\n')}
          onChange={(e) =>
            memory.setExtraMemoryPaths(
              e.target.value
                .split('\n')
                .map((p) => p.trim())
                .filter(Boolean)
            )
          }
          placeholder="/path/to/shared/notes&#10;/path/to/project/docs"
          spellCheck={false}
        />
      </div>

      {/* ── External session import ── */}
      <SettingSection title="External sessions" className="mt-6">
        <ToggleRow
          label="Import sessions run outside the app"
          description="Adopt Claude Code sessions started in a terminal (raw `claude`) as resumable threads and distill them into memory. Reconciles the last 24 hours on launch, then watches live. Only sessions whose directory is inside a known project are imported."
          checked={memory.importExternalSessions}
          onCheckedChange={memory.setImportExternalSessions}
        />
      </SettingSection>
    </>
  );
}
