import React from 'react';
import type { SandboxSecuritySettings } from '../../../../shared/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleRow } from '@/components/ui/toggle-row';
import { cn } from '@/lib/utils';
import { NETWORK_OPTIONS } from '../../settings/SandboxSettings';
import { SectionHeader } from './SectionHeader';

interface Props {
  sb: SandboxSecuritySettings;
  savingKey: string | null;
  onPatch: (patch: Partial<SandboxSecuritySettings>) => void;
}

export function SandboxSection({ sb, onPatch }: Props) {
  return (
    <>
      <SectionHeader title="Sandbox" description="Per-project container security overrides." />
      <div className="space-y-3">
        <ToggleRow
          label="Read-only root filesystem"
          description="Prevents writes to the container's root — /tmp is still writable via tmpfs."
          checked={sb.readOnlyRoot}
          onCheckedChange={(v) => onPatch({ readOnlyRoot: v })}
        />
        <ToggleRow
          label="Drop all Linux capabilities"
          description="Strips kernel privileges like NET_ADMIN and SYS_PTRACE for a minimal attack surface."
          checked={sb.dropAllCapabilities}
          onCheckedChange={(v) => onPatch({ dropAllCapabilities: v })}
        />
        <ToggleRow
          label="Block privilege escalation"
          description="Prevents setuid/setgid binaries from gaining elevated privileges inside the container."
          checked={sb.noNewPrivileges}
          onCheckedChange={(v) => onPatch({ noNewPrivileges: v })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Network</Label>
        <div className="grid grid-cols-2 gap-2">
          {NETWORK_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant="outline"
              onClick={() => onPatch({ network: opt.value })}
              className={cn(
                'flex-1 h-auto flex-col items-start px-3 py-2 text-xs',
                sb.network === opt.value
                  ? 'border-primary bg-primary/5 text-primary font-medium hover:bg-primary/5 hover:text-primary'
                  : 'text-muted-foreground hover:border-foreground hover:bg-transparent'
              )}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="mt-0.5 text-muted-foreground">{opt.description}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="proj-sb-mem">Memory Limit</Label>
        <Input
          id="proj-sb-mem"
          placeholder="e.g. 2g, 512m — leave blank for no limit"
          value={sb.memory ?? ''}
          onChange={(e) => onPatch({ memory: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">Hard cap on container RAM. Blank means unlimited.</p>
      </div>
    </>
  );
}
