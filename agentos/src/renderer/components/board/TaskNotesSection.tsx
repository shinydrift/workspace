import React, { useState } from 'react';
import { Note } from '@phosphor-icons/react';
import { useBoardStore } from '../../store/boardStore';
import type { KanbanTask, KanbanTaskNote } from '../../../shared/types/kanban';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  task: KanbanTask;
  projectId: string;
}

export function TaskNotesSection({ task, projectId }: Props) {
  const { notes, setNotes } = useBoardStore();
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const taskNotes: KanbanTaskNote[] = notes[task.id] ?? [];

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const note = await window.electronAPI.kanban.addNote(projectId, task.id, noteText.trim());
      setNotes(task.id, [...taskNotes, note]);
      setNoteText('');
    } finally {
      setAddingNote(false);
    }
  }

  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <Note size={14} />
        Notes
      </h3>
      <div className="space-y-3">
        {taskNotes.map((note) => (
          <div key={note.id} className="flex gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
            <div>
              <p className="text-xs text-foreground/80 leading-relaxed">{note.content}</p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">{new Date(note.createdAt).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {taskNotes.length === 0 && <p className="text-xs text-muted-foreground/40 italic">no notes yet</p>}
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleAddNote()}
          placeholder="Add a note..."
          className="flex-1 h-8 text-xs"
        />
        <Button size="sm" onClick={() => void handleAddNote()} disabled={addingNote || !noteText.trim()}>
          Add
        </Button>
      </div>
    </section>
  );
}
