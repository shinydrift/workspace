import React from 'react';
import type { WikiPage } from '../../../shared/types';
import { renderMarkdown } from '../../lib/markdown';
import { Pencil } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  selectedPage: WikiPage | null;
  hasPages: boolean;
  editing: boolean;
  title: string;
  content: string;
  saving: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onToggleEdit: () => void;
}

export function WikiPageEditor({
  selectedPage,
  hasPages,
  editing,
  title,
  content,
  saving,
  onTitleChange,
  onContentChange,
  onToggleEdit,
}: Props) {
  if (!selectedPage) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {hasPages ? 'Select a page' : 'Create a page to get started'}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2">
        {editing ? (
          <Input
            className="min-w-0 flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 px-0 text-base font-semibold h-auto py-0"
            placeholder="Page title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        ) : (
          <span className="min-w-0 flex-1 text-base font-semibold truncate">{title}</span>
        )}
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleEdit}
          className="shrink-0 h-6 w-6"
          title={editing ? 'Done editing' : 'Edit page'}
          aria-label={editing ? 'Done editing' : 'Edit page'}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
      {editing ? (
        <Textarea
          className="flex-1 resize-none border-none bg-transparent shadow-none focus-visible:ring-0 rounded-none px-4 py-3 text-sm font-mono placeholder:text-muted-foreground"
          placeholder="Write markdown here…"
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
        />
      ) : (
        <div className="relative flex-1 min-h-0">
          <ScrollFade />
          <ScrollArea className="h-full">
            <div
              className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          </ScrollArea>
        </div>
      )}
    </>
  );
}
