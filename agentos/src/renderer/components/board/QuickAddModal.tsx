import React from 'react';
import { Plus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { KanbanClassOfService } from '../../../shared/types/kanban';

interface Props {
  status: string;
  title: string;
  classOfService: KanbanClassOfService;
  creating: boolean;
  onTitleChange: (v: string) => void;
  onClassChange: (v: KanbanClassOfService) => void;
  onCreate: () => void;
  onClose: () => void;
}

export function QuickAddModal({
  status,
  title,
  classOfService,
  creating,
  onTitleChange,
  onClassChange,
  onCreate,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-xl shadow-2xl p-5 w-[360px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3">
          Add task to <span className="text-primary">{status}</span>
        </h3>
        <Input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          placeholder="Task title…"
          className="mb-3"
        />
        <Select value={classOfService} onValueChange={(v) => onClassChange(v as KanbanClassOfService)}>
          <SelectTrigger className="mb-3 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="expedite">Expedite</SelectItem>
            <SelectItem value="intangible">Intangible</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onCreate} disabled={creating || !title.trim()}>
            <Plus size={12} weight="bold" />
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
