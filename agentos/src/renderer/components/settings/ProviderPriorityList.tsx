import React from 'react';
import { ArrowUp, ArrowDown, Plus, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  PROVIDER_LABEL,
  type Provider,
  type ProviderBackend,
  type ProviderEntry,
} from '../../../shared/types/provider';
import { ProviderModelBadges } from '../threads/ProviderModelBadges';

interface Props {
  order: ProviderEntry[];
  onChange: (updater: (prev: ProviderEntry[]) => ProviderEntry[]) => void;
}

const ALL_PROVIDERS: Provider[] = ['claude', 'codex', 'gemini'];

export function ProviderPriorityList({ order, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {order.map((entry, i) => {
        // React key must be stable per row but allow duplicate providers — encode index.
        const rowKey = `${entry.provider}-${i}`;
        return (
          <div key={rowKey} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <div className="flex flex-row gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={i === 0}
                onClick={() =>
                  onChange((prev) => {
                    const next = [...prev];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    return next;
                  })
                }
                className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-20"
                aria-label="Move up"
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={i === order.length - 1}
                onClick={() =>
                  onChange((prev) => {
                    const next = [...prev];
                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                    return next;
                  })
                }
                className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-20"
                aria-label="Move down"
              >
                <ArrowDown size={16} />
              </Button>
            </div>
            <div className="flex-1">
              <ProviderModelBadges
                provider={entry.provider}
                backend={entry.backend}
                model={entry.model}
                baseUrl={entry.baseUrl}
                effort={entry.effort}
                reasoning={entry.reasoning}
                onProviderChange={(p) => onChange((prev) => prev.map((e, idx) => (idx === i ? { provider: p } : e)))}
                onBackendChange={(b: ProviderBackend | undefined) =>
                  onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, backend: b } : e)))
                }
                onModelChange={(m) => onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, model: m } : e)))}
                onBaseUrlChange={(url) =>
                  onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, baseUrl: url } : e)))
                }
                onEffortChange={(ef) =>
                  onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, effort: ef } : e)))
                }
                onReasoningChange={(r) =>
                  onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, reasoning: r } : e)))
                }
              />
            </div>
            {i === 0 && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Default</span>}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={order.length <= 1}
              onClick={() => onChange((prev) => prev.filter((_, idx) => idx !== i))}
              className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-20"
              aria-label="Remove"
            >
              <X size={16} />
            </Button>
          </div>
        );
      })}
      <div className="flex flex-row gap-1 pt-1">
        {ALL_PROVIDERS.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange((prev) => [...prev, { provider: p }])}
            className="h-7 text-xs gap-1"
          >
            <Plus size={12} /> {PROVIDER_LABEL[p]}
          </Button>
        ))}
      </div>
    </div>
  );
}
