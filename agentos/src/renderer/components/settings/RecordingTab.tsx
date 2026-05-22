import React, { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { MEETING_TEMPLATE } from '../../hooks/useMeetingRecorder';
import { RECORDING_DEFAULT_TEMPLATE_ID } from '../../../shared/types';
import type { RecordingTemplate } from '../../../shared/types';

export function RecordingTab() {
  const { recording } = useSettings();
  const { recording: rec, setRecording } = recording;

  const templates = rec.templates ?? [];
  const activeId = rec.activeTemplateId ?? RECORDING_DEFAULT_TEMPLATE_ID;

  const allTemplates: Array<RecordingTemplate & { builtIn?: boolean }> = [
    { id: RECORDING_DEFAULT_TEMPLATE_ID, name: 'Default', content: MEETING_TEMPLATE, builtIn: true },
    ...templates,
  ];

  const [selectedId, setSelectedId] = useState<string>(activeId);
  const selected = allTemplates.find((t) => t.id === selectedId) ?? allTemplates[0];

  function setActive(id: string) {
    setRecording({ ...rec, activeTemplateId: id === RECORDING_DEFAULT_TEMPLATE_ID ? undefined : id });
  }

  function updateTemplate(id: string, patch: Partial<RecordingTemplate>) {
    setRecording({
      ...rec,
      templates: templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  function addTemplate() {
    const id = `tpl-${Date.now()}`;
    const next: RecordingTemplate = { id, name: 'Custom template', content: MEETING_TEMPLATE };
    setRecording({ ...rec, templates: [...templates, next] });
    setSelectedId(id);
  }

  function deleteTemplate(id: string) {
    setRecording({
      ...rec,
      templates: templates.filter((t) => t.id !== id),
      activeTemplateId: rec.activeTemplateId === id ? undefined : rec.activeTemplateId,
    });
    if (selectedId === id) setSelectedId(RECORDING_DEFAULT_TEMPLATE_ID);
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Templates define the prompt sent to the AI after a meeting is transcribed. The active template is used for all
        new recordings. Available placeholders: <code>{'{date}'}</code>, <code>{'{duration}'}</code>,{' '}
        <code>{'{transcriptPath}'}</code>, <code>{'{transcript}'}</code>.
      </p>

      <RadioGroup
        value={activeId}
        onValueChange={setActive}
        className="border border-border rounded-md divide-y divide-border overflow-hidden gap-0"
      >
        {allTemplates.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors',
              selectedId === t.id && 'bg-accent/40'
            )}
            onClick={() => setSelectedId(t.id)}
          >
            <RadioGroupItem value={t.id} onClick={(e) => e.stopPropagation()} className="cursor-pointer shrink-0" />
            {t.builtIn ? (
              <span className="flex-1 text-sm truncate">{t.name}</span>
            ) : (
              <Input
                value={t.name}
                onChange={(e) => updateTemplate(t.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 text-sm border-none bg-transparent shadow-none focus-visible:ring-0 px-0 h-auto py-0"
              />
            )}
            {t.builtIn && <span className="text-xs text-muted-foreground shrink-0">Built-in</span>}
            {!t.builtIn && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTemplate(t.id);
                }}
                title="Delete template"
                aria-label="Delete template"
                className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash size={13} />
              </Button>
            )}
          </div>
        ))}
      </RadioGroup>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addTemplate}
        className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
      >
        + New template
      </Button>

      {selected && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {selected.builtIn ? 'Default template (read-only)' : 'Template content'}
          </p>
          <Textarea
            className="text-xs font-mono min-h-[240px] resize-y"
            value={selected.content}
            readOnly={!!selected.builtIn}
            onChange={(e) => !selected.builtIn && updateTemplate(selected.id, { content: e.target.value })}
            spellCheck={false}
          />
        </div>
      )}
    </>
  );
}
