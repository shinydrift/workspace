import React from 'react';
import { Check, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MEETING_TEMPLATE } from '../../../hooks/useMeetingRecorder';

interface Props {
  name: string;
  content: string;
  onNameChange: (name: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function NewTemplateForm({ name, content, onNameChange, onContentChange, onSave, onCancel }: Props) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1 text-xs border-x-0 border-t-0 rounded-none shadow-none focus-visible:ring-0 px-0 h-auto py-0.5"
          placeholder="Template name…"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onSave}
            disabled={!name.trim()}
            aria-label="Save template"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="Cancel"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        className="text-xs font-mono min-h-[160px] resize-y"
        placeholder={MEETING_TEMPLATE}
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Placeholders: <code>{'{date}'}</code>, <code>{'{duration}'}</code>, <code>{'{transcriptPath}'}</code>,{' '}
        <code>{'{transcript}'}</code>
      </p>
    </div>
  );
}
