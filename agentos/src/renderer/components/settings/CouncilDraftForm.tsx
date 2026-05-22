import React from 'react';
import { Plus, Trash, X } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { CouncilMember } from '../../../shared/types';
import { ProviderModelBadges } from '../threads/ProviderModelBadges';
import type { CouncilDraft } from './useCouncilConfigs';

interface Props {
  draft: CouncilDraft;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onSetName: (name: string) => void;
  onAddMember: () => void;
  onRemoveMember: (idx: number) => void;
  onUpdateMember: (idx: number, patch: Partial<CouncilMember>) => void;
}

export function CouncilDraftForm({
  draft,
  error,
  onSave,
  onCancel,
  onSetName,
  onAddMember,
  onRemoveMember,
  onUpdateMember,
}: Props) {
  return (
    <div className="space-y-4 rounded border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{draft.id ? 'Edit council' : 'New council'}</p>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel} aria-label="Cancel">
          <X size={14} />
        </Button>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="space-y-1">
        <Label htmlFor="council-name">Name</Label>
        <Input
          id="council-name"
          value={draft.name}
          onChange={(e) => onSetName(e.target.value)}
          placeholder="e.g. tradeoffs panel"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Members</Label>
          <Button size="sm" variant="outline" onClick={onAddMember}>
            <Plus size={12} className="mr-1" /> Add
          </Button>
        </div>
        {draft.members.map((m, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <ProviderModelBadges
              provider={m.provider}
              model={m.model || undefined}
              effort={m.effort}
              reasoning={m.reasoning}
              onProviderChange={(p) =>
                onUpdateMember(idx, { provider: p, model: '', effort: undefined, reasoning: undefined })
              }
              onModelChange={(v) => onUpdateMember(idx, { model: v ?? '' })}
              onEffortChange={(ef) => onUpdateMember(idx, { effort: ef })}
              onReasoningChange={(r) => onUpdateMember(idx, { reasoning: r })}
            />
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:text-destructive"
              onClick={() => onRemoveMember(idx)}
              aria-label="Remove member"
            >
              <Trash size={14} />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
