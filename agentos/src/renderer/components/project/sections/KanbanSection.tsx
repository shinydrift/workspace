import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash, ArrowUp, ArrowDown, X } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SectionHeader } from './SectionHeader';
import type { KanbanStage } from '../../../../shared/types/kanban';
import type { ClaudeEffort, CodexReasoning, Provider } from '../../../../shared/types/provider';
import { ProviderModelBadges } from '../../threads/ProviderModelBadges';

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueSlug(base: string, existingIds: string[]): string {
  const slug = toSlug(base) || 'stage';
  if (!existingIds.includes(slug)) return slug;
  let n = 2;
  while (existingIds.includes(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

interface KanbanConfig {
  enabled?: boolean;
}

interface Props {
  projectId: string;
  kanban: KanbanConfig;
  savingKey: string | null;
  onPatch: (patch: KanbanConfig) => void;
}

function AutoTextarea({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  // useLayoutEffect runs synchronously after DOM mutations, before paint —
  // covers both initial load and programmatic value changes without a visible jump.
  useLayoutEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={
        'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden' +
        (className ? ` ${className}` : '')
      }
    />
  );
}

export function KanbanSection({ projectId, kanban, savingKey, onPatch }: Props) {
  const [stages, setStages] = useState<KanbanStage[]>([]);
  const pendingSaves = useRef<Record<number, KanbanStage>>({});
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingIdChanges = useRef<Map<string, string>>(new Map());
  const stagesRef = useRef<KanbanStage[]>([]);

  useEffect(() => {
    stagesRef.current = stages;
  }, [stages]);

  useEffect(() => {
    if (!projectId) return;
    pendingIdChanges.current = new Map();
    void window.electronAPI.kanban.listStages(projectId).then(setStages);
  }, [projectId]);

  async function saveStage(stage: KanbanStage) {
    const oldId = pendingIdChanges.current.get(stage.id);
    if (oldId) {
      pendingIdChanges.current.delete(stage.id);
      await window.electronAPI.kanban.deleteStage(projectId, oldId);
    }
    await window.electronAPI.kanban.updateStage(projectId, stage);
  }

  function updateStage(index: number, patch: Partial<KanbanStage>) {
    const merged = { ...stages[index], ...patch };
    setStages(stages.map((s, i) => (i === index ? merged : s)));
    pendingSaves.current[index] = merged;
    clearTimeout(saveTimers.current[index]);
    saveTimers.current[index] = setTimeout(() => {
      const pending = pendingSaves.current[index];
      if (pending) {
        delete pendingSaves.current[index];
        const hasDupe = stagesRef.current.some((s, j) => j !== index && s.id === pending.id);
        if (!hasDupe) void saveStage(pending);
      }
    }, 300);
  }

  function removeStage(index: number) {
    const stage = stages[index];
    setStages(stages.filter((_, i) => i !== index));
    void window.electronAPI.kanban.deleteStage(projectId, stage.id);
  }

  function moveStage(index: number, direction: -1 | 1) {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    if (next[target].terminal) return;
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((s, i) => ({ ...s, order: i }));
    setStages(reordered);
    void saveStage(reordered[index]);
    void saveStage(reordered[target]);
  }

  function addStage() {
    const existingIds = stages.map((s) => s.id);
    const id = uniqueSlug('New Stage', existingIds);
    const label = id
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const insertAt = stages.findIndex((s) => s.terminal);
    const at = insertAt === -1 ? stages.length : insertAt;
    const newStage: KanbanStage = {
      id,
      label,
      order: at,
    };
    const updated = [...stages.slice(0, at), newStage, ...stages.slice(at).map((s) => ({ ...s, order: s.order + 1 }))];
    setStages(updated);
    void saveStage(newStage);
    for (const s of updated.slice(at + 1)) void saveStage(s);
  }

  return (
    <>
      <SectionHeader title="Kanban" description="Configure board stages." />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Switch checked={kanban.enabled ?? false} onCheckedChange={(v) => onPatch({ ...kanban, enabled: v })} />
          <Label className="font-normal">Enable Kanban board</Label>
        </div>

        {(kanban.enabled ?? false) && (
          <div className="space-y-4 pl-6 pt-1">
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stages</p>
              {stages.map((stage, i) => {
                const isDupe = !stage.terminal && stages.some((s, j) => j !== i && s.id === stage.id);
                return (
                  <div key={`${stage.id}-${i}`} className="space-y-1.5 rounded border border-border p-2">
                    <div className="flex items-center gap-1">
                      <Input
                        value={stage.label}
                        placeholder="Stage name"
                        onChange={(e) => {
                          const newLabel = e.target.value;
                          if (stage.id === toSlug(stage.label)) {
                            const newSlug = toSlug(newLabel) || 'stage';
                            const originalId = pendingIdChanges.current.get(stage.id) ?? stage.id;
                            pendingIdChanges.current.delete(stage.id);
                            if (newSlug !== originalId) pendingIdChanges.current.set(newSlug, originalId);
                            updateStage(i, { label: newLabel, id: newSlug });
                          } else {
                            updateStage(i, { label: newLabel });
                          }
                        }}
                        className={`font-mono text-xs h-7 flex-1${isDupe ? ' border-destructive' : ''}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveStage(i, -1)}
                        disabled={i === 0 || !!stage.terminal}
                        title="Move up"
                        aria-label="Move stage up"
                      >
                        <ArrowUp size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveStage(i, 1)}
                        disabled={i === stages.length - 1 || !!stage.terminal || !!stages[i + 1]?.terminal}
                        title="Move down"
                        aria-label="Move stage down"
                      >
                        <ArrowDown size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => removeStage(i)}
                        disabled={!!stage.terminal}
                        title="Remove stage"
                        aria-label="Remove stage"
                      >
                        <Trash size={12} />
                      </Button>
                    </div>
                    {isDupe && <p className="text-destructive text-xs">Stage key already in use</p>}
                    {!stage.terminal && (
                      <>
                        <AutoTextarea
                          value={stage.prompt ?? ''}
                          placeholder="What should happen in this stage…"
                          onChange={(v) => updateStage(i, { prompt: v || undefined })}
                          className="text-muted-foreground"
                        />
                        <div className="flex items-center gap-1 pt-0.5">
                          {stage.provider ? (
                            <>
                              <ProviderModelBadges
                                provider={stage.provider}
                                model={stage.model}
                                effort={stage.effort}
                                reasoning={stage.reasoning}
                                onProviderChange={(p: Provider) =>
                                  updateStage(i, { provider: p, model: undefined, effort: undefined, reasoning: undefined })
                                }
                                onModelChange={(m: string | undefined) => updateStage(i, { model: m })}
                                onEffortChange={(e: ClaudeEffort | undefined) => updateStage(i, { effort: e })}
                                onReasoningChange={(r: CodexReasoning | undefined) => updateStage(i, { reasoning: r })}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                                onClick={() =>
                                  updateStage(i, { provider: undefined, model: undefined, effort: undefined, reasoning: undefined })
                                }
                                title="Inherit from project"
                                aria-label="Clear provider override"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => updateStage(i, { provider: 'claude' })}
                            >
                              + Provider
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={addStage}>
                <Plus size={12} />
                Add stage
              </Button>
            </div>
          </div>
        )}

        {savingKey === 'kanban' && <p className="text-xs text-muted-foreground">Saving…</p>}
      </div>
    </>
  );
}
