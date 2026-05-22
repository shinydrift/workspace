import { Paperclip, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

export type AttachedFile = { name: string; data: ArrayBuffer };

interface Props {
  files: AttachedFile[];
  onRemove: (index: number) => void;
}

export function AttachedFileList({ files, onRemove }: Props) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-3 pt-2">
      {files.map((file, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="max-w-[160px] truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-0.5 h-4 w-4 hover:bg-transparent hover:text-foreground"
            onClick={() => onRemove(i)}
            aria-label={`Remove ${file.name}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </span>
      ))}
    </div>
  );
}
