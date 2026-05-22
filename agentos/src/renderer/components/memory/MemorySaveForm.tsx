import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

interface Props {
  savePath: string;
  onSavePathChange: (v: string) => void;
  saveContent: string;
  onSaveContentChange: (v: string) => void;
  saveMode: 'append' | 'overwrite';
  onSaveModeChange: (v: 'append' | 'overwrite') => void;
  busy: string | null;
  onSave: () => void;
}

export function MemorySaveForm({
  savePath,
  onSavePathChange,
  saveContent,
  onSaveContentChange,
  saveMode,
  onSaveModeChange,
  busy,
  onSave,
}: Props) {
  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Save Memory</div>
      <Input value={savePath} onChange={(e) => onSavePathChange(e.target.value)} placeholder="memory/notes.md" />
      <div className="mt-2 flex gap-1">
        {(['append', 'overwrite'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            onClick={() => onSaveModeChange(value)}
            className={
              saveMode === value
                ? 'h-auto px-3 py-2 text-xs border-primary bg-primary/5 text-primary font-medium hover:bg-primary/5 hover:text-primary'
                : 'h-auto px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:bg-transparent'
            }
          >
            {value}
          </Button>
        ))}
      </div>
      <Textarea
        className="mt-2 min-h-[150px]"
        value={saveContent}
        onChange={(e) => onSaveContentChange(e.target.value)}
        placeholder="Write a durable project note or summary"
      />
      <Button type="button" className="mt-2 h-8" onClick={onSave} disabled={busy !== null || !saveContent.trim()}>
        Save
      </Button>
    </div>
  );
}
