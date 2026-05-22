import React from 'react';
import type { ToolCallInvocation, ToolCallStats } from '../../../shared/types';
import { FilterPill } from './FilterPill';
import type { FilterMode } from './FilterPill';
import { ToolGroup } from './ToolGroup';

interface Props {
  regular: ToolCallStats[];
  memory: ToolCallStats[];
  invocationsByTool: Map<string, ToolCallInvocation[]>;
  filter: FilterMode;
  onFilterChange: (f: FilterMode) => void;
  totalAll: number;
  totalSuccess: number;
  totalError: number;
}

export function InsightsToolsSection({
  regular,
  memory,
  invocationsByTool,
  filter,
  onFilterChange,
  totalAll,
  totalSuccess,
  totalError,
}: Props) {
  return (
    <>
      {(regular.length > 0 || memory.length > 0) && (
        <section className="flex flex-col gap-1 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tools{' '}
              <span className="normal-case font-normal">
                ({[...regular, ...memory].reduce((s, t) => s + t.count, 0)})
              </span>
            </p>
            {totalAll > 0 && (
              <div className="flex gap-1">
                <FilterPill
                  active={filter === 'all'}
                  onClick={() => onFilterChange('all')}
                  label="All"
                  count={totalAll}
                />
                <FilterPill
                  active={filter === 'success'}
                  onClick={() => onFilterChange('success')}
                  label=""
                  count={totalSuccess}
                  variant="success"
                />
                <FilterPill
                  active={filter === 'error'}
                  onClick={() => onFilterChange('error')}
                  label=""
                  count={totalError}
                  variant="error"
                />
              </div>
            )}
          </div>
          {regular.map((t) => (
            <ToolGroup key={t.name} stat={t} invocations={invocationsByTool.get(t.name) ?? []} filter={filter} />
          ))}
          {memory.map((t) => (
            <ToolGroup key={t.name} stat={t} invocations={invocationsByTool.get(t.name) ?? []} filter={filter} />
          ))}
        </section>
      )}
    </>
  );
}
