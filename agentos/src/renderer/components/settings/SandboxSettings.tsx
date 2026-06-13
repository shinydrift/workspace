import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleRow } from '@/components/ui/toggle-row';
import { cn } from '@/lib/utils';
import type { SandboxSecuritySettings } from '../../../shared/types';
import { DEFAULT_SANDBOX_SETTINGS } from '../../../shared/types';
import { useSettings } from '../../contexts/SettingsContext';

export const NETWORK_OPTIONS: { value: SandboxSecuritySettings['network']; label: string; description: string }[] = [
  { value: 'bridge', label: 'Bridge', description: 'Full internet access via Docker bridge network' },
  { value: 'none', label: 'None', description: 'Fully air-gapped — no outbound connections' },
  { value: 'host', label: 'Host', description: 'Shares the host network stack directly' },
];

export function SandboxSettings() {
  const { sandbox } = useSettings();
  const s = { ...DEFAULT_SANDBOX_SETTINGS, ...sandbox.security };
  const onChange = (patch: Partial<SandboxSecuritySettings>) =>
    sandbox.setSecurity((prev: Partial<SandboxSecuritySettings>) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-5">
      {/* Run on host (no sandbox) */}
      <div className="space-y-2">
        <ToggleRow
          label="Run threads on host (no sandbox)"
          description="Runs the provider CLI directly on this machine instead of in a Docker container. Requires the CLI on your PATH. A project's .agentos config can override this."
          checked={sandbox.runOnHost}
          onCheckedChange={sandbox.setRunOnHost}
        />
        {sandbox.runOnHost && (
          <p className="text-xs rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            ⚠ No isolation: agents run with full read/write access to your machine and
            <code className="mx-1">--dangerously-skip-permissions</code>. Only enable for directories you fully trust.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sandbox Security</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Applied to every container on next thread start. Ignored when running on host.
        </p>
      </div>

      {/* Security toggles */}
      <div className="space-y-3">
        <ToggleRow
          label="Read-only root filesystem"
          description="Prevents writes to the container's root — /tmp is still writable via tmpfs."
          checked={s.readOnlyRoot}
          onCheckedChange={(v) => onChange({ readOnlyRoot: v })}
        />
        <ToggleRow
          label="Drop all Linux capabilities"
          description="Strips kernel privileges like NET_ADMIN and SYS_PTRACE for a minimal attack surface."
          checked={s.dropAllCapabilities}
          onCheckedChange={(v) => onChange({ dropAllCapabilities: v })}
        />
        <ToggleRow
          label="Block privilege escalation"
          description="Prevents setuid/setgid binaries from gaining elevated privileges inside the container."
          checked={s.noNewPrivileges}
          onCheckedChange={(v) => onChange({ noNewPrivileges: v })}
        />
      </div>

      {/* Network tiles */}
      <div className="flex flex-col gap-2">
        <Label>Network</Label>
        <div className="grid grid-cols-2 gap-2">
          {NETWORK_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant="outline"
              onClick={() => onChange({ network: opt.value })}
              className={cn(
                'flex-1 h-auto flex-col items-start px-3 py-2 text-xs',
                s.network === opt.value
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

      {/* Memory limit */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-mem">Memory Limit</Label>
        <Input
          id="sb-mem"
          placeholder="e.g. 2g, 512m — leave blank for no limit"
          value={s.memory ?? ''}
          onChange={(e) => onChange({ memory: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">Hard cap on container RAM. Blank means unlimited.</p>
      </div>
    </div>
  );
}
