import React, { useRef, useState } from 'react';
import type { SavedProject } from '../../../../shared/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionHeader } from './SectionHeader';

type DataTarget = 'memory' | 'sessions' | 'code' | 'graph';
type ActionKind = 'reset' | 'delete';

interface ActiveAction {
  target: DataTarget;
  kind: ActionKind;
}

interface Props {
  savedProject: SavedProject | null;
  deleting: boolean;
  onDeleteClick: () => void;
}

const TARGET_LABELS: Record<DataTarget, string> = {
  memory: 'Memory',
  sessions: 'Session',
  code: 'Code',
  graph: 'Graph',
};

const RESET_DESCRIPTIONS: Record<DataTarget, string> = {
  memory: 'Clears vector embeddings for memory chunks. Content is preserved; embeddings are recomputed on next search.',
  sessions:
    'Clears vector embeddings for session chunks. Content is preserved; embeddings are recomputed on next search.',
  code: 'Clears vector embeddings for the code index and triggers a full re-index. Source files are not affected.',
  graph: 'Clears the knowledge graph and triggers a rebuild from existing chunks on the next sync.',
};

const DELETE_DESCRIPTIONS: Record<DataTarget, string> = {
  memory: 'Permanently removes all memory chunks. This cannot be undone.',
  sessions: 'Permanently removes all session history chunks. This cannot be undone.',
  code: 'Permanently removes the code index. Source files are not affected.',
  graph: 'Permanently removes all entities, edges, and observations from the knowledge graph.',
};

const RESET_CONFIRM_DESCRIPTIONS: Record<DataTarget, string> = {
  memory:
    'Vector embeddings for memory chunks will be cleared. The text content is preserved and embeddings will be recomputed on the next search.',
  sessions:
    'Vector embeddings for session chunks will be cleared. The text content is preserved and embeddings will be recomputed on the next search.',
  code: 'Vector embeddings for the code index will be cleared and a full re-index will be triggered. Your source files are not affected.',
  graph: 'The knowledge graph will be cleared and rebuilt from existing chunks on the next memory sync.',
};

const DELETE_CONFIRM_DESCRIPTIONS: Record<DataTarget, string> = {
  memory: 'All memory chunks will be permanently deleted. This cannot be undone.',
  sessions: 'All session history chunks will be permanently deleted. This cannot be undone.',
  code: 'The entire code index will be permanently deleted. Your source files are not affected, but the index will not be rebuilt automatically.',
  graph:
    'All entities, edges, and observations will be permanently deleted from the knowledge graph. This cannot be undone.',
};

const DATA_GROUPS: Array<{ target: DataTarget; title: string }> = [
  { target: 'memory', title: 'Memory embeddings' },
  { target: 'sessions', title: 'Session embeddings' },
  { target: 'code', title: 'Code embeddings' },
  { target: 'graph', title: 'Knowledge graph' },
];

export function DangerSection({ savedProject, deleting, onDeleteClick }: Props) {
  const [confirmAction, setConfirmAction] = useState<ActiveAction | null>(null);
  const pendingActionRef = useRef<ActiveAction>({ target: 'code', kind: 'reset' });
  const [inProgress, setInProgress] = useState<ActiveAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openConfirm(target: DataTarget, kind: ActionKind) {
    pendingActionRef.current = { target, kind };
    setConfirmAction({ target, kind });
  }

  function isInProgress(target: DataTarget, kind: ActionKind) {
    return inProgress?.target === target && inProgress?.kind === kind;
  }

  async function handleAction(target: DataTarget, kind: ActionKind) {
    if (!savedProject) return;
    setInProgress({ target, kind });
    setActionError(null);
    try {
      if (kind === 'reset') {
        await window.electronAPI.memory.resetEmbeddings(savedProject.id, target);
      } else {
        await window.electronAPI.memory.deleteData(savedProject.id, target);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setInProgress(null);
    }
  }

  const pending = pendingActionRef.current;
  const busy = inProgress !== null;
  const disabled = !savedProject || busy;

  const confirmTitle =
    pending.kind === 'reset'
      ? pending.target === 'graph'
        ? 'Reset knowledge graph?'
        : `Reset ${TARGET_LABELS[pending.target].toLowerCase()} embeddings?`
      : `Delete ${TARGET_LABELS[pending.target].toLowerCase()} data?`;

  const confirmDescription =
    pending.kind === 'reset' ? RESET_CONFIRM_DESCRIPTIONS[pending.target] : DELETE_CONFIRM_DESCRIPTIONS[pending.target];

  return (
    <>
      <SectionHeader title="Danger zone" />
      <div className="space-y-4">
        {DATA_GROUPS.map(({ target, title }) => (
          <div key={target} className="rounded-lg border border-destructive/30 p-3 space-y-2">
            <p className="text-xs font-medium">{title}</p>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">{RESET_DESCRIPTIONS[target]}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => openConfirm(target, 'reset')}
                className="shrink-0 text-xs border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isInProgress(target, 'reset') ? 'Resetting…' : 'Reset'}
              </Button>
            </div>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">{DELETE_DESCRIPTIONS[target]}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => openConfirm(target, 'delete')}
                className="shrink-0 text-xs border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isInProgress(target, 'delete') ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-destructive/30 p-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium">Delete project</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Removes this project from AgentOS. Files on disk are not affected.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!savedProject || deleting}
            onClick={onDeleteClick}
            className="shrink-0 text-xs border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>

        {actionError && <p className="text-xs text-destructive px-1">{actionError}</p>}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={pending.kind === 'reset' ? 'Reset' : 'Delete'}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void handleAction(a.target, a.kind);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}
