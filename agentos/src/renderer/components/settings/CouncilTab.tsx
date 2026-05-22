import React from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useCouncilConfigs } from './useCouncilConfigs';
import { CouncilDraftForm } from './CouncilDraftForm';

export function CouncilTab() {
  const {
    configs,
    draft,
    loading,
    error,
    startNew,
    startEdit,
    cancelDraft,
    save,
    remove,
    setDraftName,
    addMember,
    removeMember,
    updateMember,
  } = useCouncilConfigs();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Councils</p>
          <p className="text-xs text-muted-foreground">
            A council runs the same prompt across multiple models in parallel and synthesizes the results.
          </p>
        </div>
        {!draft && (
          <Button size="sm" onClick={startNew}>
            <Plus size={14} className="mr-1" /> New council
          </Button>
        )}
      </div>

      {error && !draft && <div className="text-xs text-destructive">{error}</div>}

      {!draft && (
        <div className="space-y-2">
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && configs.length === 0 && (
            <p className="text-xs text-muted-foreground">No councils yet. Create one to get started.</p>
          )}
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center justify-between rounded border border-border px-3 py-2 hover:bg-accent/30"
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => startEdit(cfg)}
                className="flex-1 h-auto flex-col items-start justify-start px-0 py-0 text-left font-normal hover:bg-transparent"
              >
                <div className="text-sm font-medium">{cfg.name}</div>
                <div className="text-xs text-muted-foreground">{cfg.members.length} members</div>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:text-destructive"
                onClick={() => void remove(cfg.id)}
                aria-label={`Delete ${cfg.name}`}
              >
                <Trash size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <CouncilDraftForm
          draft={draft}
          error={error}
          onSave={() => void save()}
          onCancel={cancelDraft}
          onSetName={setDraftName}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onUpdateMember={updateMember}
        />
      )}
    </div>
  );
}
