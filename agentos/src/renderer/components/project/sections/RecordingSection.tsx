import React, { useMemo, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SectionHeader } from './SectionHeader';
import { RecordingTemplateCard } from './RecordingTemplateCard';
import { NewTemplateForm } from './NewTemplateForm';
import { MEETING_TEMPLATE } from '../../../hooks/useMeetingRecorder';
import { RECORDING_DEFAULT_TEMPLATE_ID } from '../../../../shared/types';
import type { ProjectConfig, RecordingTemplate } from '../../../../shared/types';

interface Props {
  recording: ProjectConfig['recording'];
  savingKey: string | null;
  onPatch: (patch: ProjectConfig['recording'] | undefined) => void;
}

export function RecordingSection({ recording, savingKey, onPatch }: Props) {
  const templates = useMemo<RecordingTemplate[]>(() => recording?.templates ?? [], [recording?.templates]);
  const activeTemplateId = recording?.activeTemplateId ?? RECORDING_DEFAULT_TEMPLATE_ID;

  const [editing, setEditing] = useState<{ id: string; name: string; content: string } | null>(null);
  const [newTpl, setNewTpl] = useState<{ name: string; content: string } | null>(null);

  function setActive(id: string) {
    onPatch({ ...recording, activeTemplateId: id === RECORDING_DEFAULT_TEMPLATE_ID ? undefined : id });
  }

  function saveEdit() {
    if (!editing) return;
    const updated = templates.map((t) =>
      t.id === editing.id ? { id: t.id, name: editing.name.trim() || t.name, content: editing.content } : t
    );
    onPatch({ ...recording, templates: updated });
    setEditing(null);
  }

  function deleteTemplate(id: string) {
    const updated = templates.filter((t) => t.id !== id);
    onPatch({
      ...recording,
      templates: updated.length > 0 ? updated : undefined,
      activeTemplateId: activeTemplateId === id ? undefined : recording?.activeTemplateId,
    });
  }

  function saveNew() {
    if (!newTpl) return;
    const name = newTpl.name.trim();
    if (!name) return;
    const id = `tpl-${Date.now()}`;
    onPatch({ ...recording, templates: [...templates, { id, name, content: newTpl.content }] });
    setNewTpl(null);
  }

  const allTemplates = useMemo<Array<RecordingTemplate & { builtIn?: boolean }>>(
    () => [
      { id: RECORDING_DEFAULT_TEMPLATE_ID, name: 'Default', content: MEETING_TEMPLATE, builtIn: true },
      ...templates,
    ],
    [templates]
  );

  return (
    <>
      <SectionHeader title="Recording" description="Manage note templates used when generating meeting notes." />

      <div className="space-y-3">
        {allTemplates.map((t) => (
          <RecordingTemplateCard
            key={t.id}
            template={t}
            isActive={activeTemplateId === t.id}
            editingState={editing?.id === t.id ? { name: editing.name, content: editing.content } : null}
            onSetActive={() => setActive(t.id)}
            onStartEdit={() => {
              setEditing({ id: t.id, name: t.name, content: t.content });
              setNewTpl(null);
            }}
            onDelete={() => deleteTemplate(t.id)}
            onSaveEdit={saveEdit}
            onCancelEdit={() => setEditing(null)}
            onEditNameChange={(name) => setEditing((e) => (e ? { ...e, name } : e))}
            onEditContentChange={(content) => setEditing((e) => (e ? { ...e, content } : e))}
          />
        ))}

        {newTpl !== null && (
          <NewTemplateForm
            name={newTpl.name}
            content={newTpl.content}
            onNameChange={(name) => setNewTpl((t) => (t ? { ...t, name } : t))}
            onContentChange={(content) => setNewTpl((t) => (t ? { ...t, content } : t))}
            onSave={saveNew}
            onCancel={() => setNewTpl(null)}
          />
        )}

        {newTpl === null && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent gap-1.5"
            onClick={() => {
              setNewTpl({ name: '', content: '' });
              setEditing(null);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add template
          </Button>
        )}
      </div>

      {savingKey === 'recording' && <p className="text-xs text-muted-foreground mt-2">Saving…</p>}
    </>
  );
}
