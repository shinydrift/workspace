import React, { useEffect, useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CustomVarRow({
  varKey,
  value,
  isOverride,
  onChange,
  onRename,
  onRemove,
}: {
  varKey: string;
  value: string;
  isOverride?: boolean;
  onChange: (key: string, value: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
  onRemove: (key: string) => void;
}) {
  const [editKey, setEditKey] = useState(varKey);

  useEffect(() => {
    setEditKey(varKey);
  }, [varKey]);

  function commitKey() {
    const trimmed = editKey.trim();
    if (!trimmed) {
      setEditKey(varKey);
      return;
    }
    onRename(varKey, trimmed);
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Input
        className="h-6 text-xs font-mono w-36 shrink-0"
        value={editKey}
        onChange={(e) => setEditKey(e.target.value)}
        onBlur={commitKey}
        onKeyDown={(e) => e.key === 'Enter' && commitKey()}
        placeholder="KEY"
        spellCheck={false}
      />
      <span className="text-muted-foreground text-xs">=</span>
      <Input
        className="h-6 text-xs font-mono flex-1"
        value={value}
        onChange={(e) => onChange(varKey, e.target.value)}
        placeholder="value"
        spellCheck={false}
      />
      {isOverride && <span className="text-xs text-muted-foreground shrink-0">override</span>}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(varKey)}
        title="Remove"
      >
        <Trash size={12} />
      </Button>
    </div>
  );
}
