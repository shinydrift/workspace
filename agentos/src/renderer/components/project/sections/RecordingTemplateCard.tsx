import React from 'react';
import { PencilSimple, Trash, Check, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { RecordingTemplate } from '../../../../shared/types';

interface Props {
  template: RecordingTemplate & { builtIn?: boolean };
  isActive: boolean;
  editingState: { name: string; content: string } | null;
  onSetActive: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (name: string) => void;
  onEditContentChange: (content: string) => void;
}

export function RecordingTemplateCard({
  template,
  isActive,
  editingState,
  onSetActive,
  onStartEdit,
  onDelete,
  onSaveEdit,
  onCancelEdit,
  onEditNameChange,
  onEditContentChange,
}: Props) {
  const isEditing = editingState !== null;

  return (
    <div className={`border rounded-lg p-3 space-y-2 ${isActive ? 'border-foreground/40' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSetActive}
          title={isActive ? 'Active template' : 'Set as active'}
          className={`w-3.5 h-3.5 rounded-full border shrink-0 transition-colors ${
            isActive ? 'bg-foreground border-foreground' : 'border-muted-foreground/40 hover:border-foreground/60'
          }`}
        />
        {isEditing ? (
          <Input
            className="flex-1 text-xs border-x-0 border-t-0 rounded-none shadow-none focus-visible:ring-0 px-0 h-auto py-0.5"
            value={editingState.name}
            onChange={(e) => onEditNameChange(e.target.value)}
            autoFocus
          />
        ) : (
          <span className="flex-1 text-xs font-medium truncate">{template.name}</span>
        )}
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onSaveEdit}
              aria-label="Save"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancelEdit}
              aria-label="Cancel"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          !template.builtIn && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onStartEdit}
                aria-label="Edit template"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
              >
                <PencilSimple className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onDelete}
                aria-label="Delete template"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        )}
      </div>

      {isEditing ? (
        <Textarea
          className="text-xs font-mono min-h-[160px] resize-y"
          value={editingState.content}
          onChange={(e) => onEditContentChange(e.target.value)}
        />
      ) : (
        <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap line-clamp-4 leading-relaxed">
          {template.content}
        </pre>
      )}
    </div>
  );
}
