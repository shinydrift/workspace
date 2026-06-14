import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SectionHeader } from './SectionHeader';
import { InheritHint } from './InheritHint';
import { ProviderPriorityList } from '../../settings/ProviderPriorityList';
import { DEFAULT_PROVIDER_ORDER, normalizeProviderOrder } from '../../../../shared/types';
import type { AppSettings, ProviderEntry } from '../../../../shared/types';

interface AgentsConfig {
  providerOrder?: ProviderEntry[];
  queueSilenceFallbackMs?: number;
}

interface Props {
  agents: AgentsConfig;
  appSettings: AppSettings | null;
  savingKey: string | null;
  onAgentsPatch: (patch: AgentsConfig) => void;
}

export function AgentsSection({ agents, appSettings, savingKey, onAgentsPatch }: Props) {
  const normalizedAppOrder = normalizeProviderOrder(appSettings?.agents?.providerOrder);
  const appProviderOrder: ProviderEntry[] = normalizedAppOrder.length > 0 ? normalizedAppOrder : DEFAULT_PROVIDER_ORDER;
  const appSilence = appSettings?.agents?.queueSilenceFallbackMs ?? 1500;
  const effectiveOrder = agents.providerOrder ?? appProviderOrder;
  const orderOverridden = agents.providerOrder !== undefined;
  const silenceOverridden = agents.queueSilenceFallbackMs !== undefined;

  return (
    <>
      <SectionHeader title="Agents" description="Per-project agent and provider overrides." />

      {/* Command Queue */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Command Queue</p>
        <p className="text-xs text-muted-foreground">Controls silence fallback used to detect turn completion.</p>
        <div className="flex items-center justify-between">
          <Label htmlFor="proj-silence-fallback">Silence fallback (ms)</Label>
          {silenceOverridden && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={() => onAgentsPatch({ ...agents, queueSilenceFallbackMs: undefined })}
            >
              reset to app
            </Button>
          )}
        </div>
        <Input
          id="proj-silence-fallback"
          type="number"
          min={200}
          value={agents.queueSilenceFallbackMs ?? appSilence}
          onChange={(e) => onAgentsPatch({ ...agents, queueSilenceFallbackMs: Number(e.target.value) || appSilence })}
          className="w-32"
        />
        <InheritHint show={!silenceOverridden} />
      </div>

      <Separator />

      {/* Provider Priority */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provider Priority</p>
          {orderOverridden && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={() => onAgentsPatch({ ...agents, providerOrder: undefined })}
            >
              reset to app
            </Button>
          )}
        </div>
        <InheritHint show={!orderOverridden} />
        <ProviderPriorityList
          order={effectiveOrder}
          onChange={(updater) => onAgentsPatch({ ...agents, providerOrder: updater(effectiveOrder) })}
        />
        {!orderOverridden && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
            onClick={() => onAgentsPatch({ ...agents, providerOrder: [...effectiveOrder] })}
          >
            customize for this project
          </Button>
        )}
      </div>

      {savingKey === 'agents' && <p className="text-xs text-muted-foreground">Saving…</p>}
    </>
  );
}
