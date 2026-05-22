import React from 'react';
import type { ModelStat } from '../../../shared/types/analytics';
import { MODEL_LABEL } from '../../../shared/types/provider';
import { formatCost, formatTokens } from '../../lib/analyticsFormatters';

interface Props {
  models: ModelStat[];
  max: number;
}

export function ModelBreakdownSection({ models, max }: Props) {
  if (models.length === 0) return null;
  return (
    <section className="border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By model</p>
      <div className="flex flex-col gap-2.5">
        {models.map((m) => (
          <div key={m.model} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-foreground/80 truncate max-w-[160px]">
                {MODEL_LABEL[m.model] ?? m.model}
              </span>
              <span className="text-xs tabular-nums text-foreground shrink-0 ml-2">{formatCost(m.costUsdMicro)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/70 transition-all"
                style={{ width: `${Math.max(2, (m.costUsdMicro / max) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground/60">
              {formatTokens(m.inputTokens)} in · {formatTokens(m.outputTokens)} out
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
