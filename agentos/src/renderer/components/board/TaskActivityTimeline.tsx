import React, { useState } from 'react';
import {
  ArrowRight,
  ChartBar,
  ChatText,
  CheckCircle,
  ClockCounterClockwise,
  PlusCircle,
  UserCircle,
  Warning,
  XCircle,
  Pencil,
  Trash,
} from '@phosphor-icons/react';
import { cn, timeAgo } from '@/lib/utils';
import { renderMarkdown } from '../../lib/markdown';
import type { Thread } from '../../../shared/types';
import type { KanbanTaskEvent } from '../../../shared/types/kanban';
import { getTaskActorLabel } from './taskSheetUtils';

interface Props {
  events: KanbanTaskEvent[];
  threads: Record<string, Thread>;
  projectId: string;
  onEventsChanged: () => void;
}

interface EventMeta {
  icon: React.ReactNode;
  label: string;
  body?: string;
  iconColor: string;
  isNote: boolean;
}

function getEventMeta(event: KanbanTaskEvent): EventMeta {
  switch (event.kind) {
    case 'created':
      return {
        icon: <PlusCircle size={14} weight="fill" />,
        label: 'Task created',
        iconColor: 'text-muted-foreground',
        isNote: false,
      };
    case 'moved': {
      const from = String(event.data.fromStatus ?? 'unknown');
      const to = String(event.data.toStatus ?? 'unknown');
      const reason = typeof event.data.reason === 'string' ? event.data.reason : undefined;
      return {
        icon: <ArrowRight size={14} weight="bold" />,
        label: `${from} → ${to}`,
        body: reason,
        iconColor: 'text-sky-500',
        isNote: false,
      };
    }
    case 'progress': {
      const pct = typeof event.data.progress === 'number' ? `${event.data.progress}%` : 'updated';
      const note = typeof event.data.note === 'string' ? event.data.note : undefined;
      return {
        icon: <ChartBar size={14} weight="fill" />,
        label: `Progress ${pct}`,
        body: note,
        iconColor: 'text-emerald-500',
        isNote: false,
      };
    }
    case 'assigned':
      return {
        icon: <UserCircle size={14} weight="fill" />,
        label: 'Assigned',
        iconColor: 'text-amber-500',
        isNote: false,
      };
    case 'review': {
      const approved = event.data.verdict === 'approved';
      const summary = typeof event.data.summary === 'string' ? event.data.summary : undefined;
      return {
        icon: approved ? <CheckCircle size={14} weight="fill" /> : <XCircle size={14} weight="fill" />,
        label: approved ? 'Review approved' : 'Changes requested',
        body: summary,
        iconColor: approved ? 'text-emerald-500' : 'text-rose-500',
        isNote: false,
      };
    }
    case 'blocker': {
      const blocked = event.data.blocked !== false;
      const summary = typeof event.data.summary === 'string' ? event.data.summary : undefined;
      return {
        icon: blocked ? <Warning size={14} weight="fill" /> : <CheckCircle size={14} weight="fill" />,
        label: blocked ? 'Blocked' : 'Blocker cleared',
        body: summary,
        iconColor: blocked ? 'text-rose-500' : 'text-emerald-500',
        isNote: false,
      };
    }
    case 'note': {
      const content = typeof event.data.content === 'string' ? event.data.content : '';
      return {
        icon: <ChatText size={14} weight="fill" />,
        label: '',
        body: content,
        iconColor: 'text-foreground/60',
        isNote: true,
      };
    }
    default:
      return {
        icon: <ChatText size={14} weight="fill" />,
        label: event.kind,
        iconColor: 'text-muted-foreground',
        isNote: false,
      };
  }
}

interface NoteCardProps {
  event: KanbanTaskEvent;
  actor: string;
  body: string;
  projectId: string;
  onEventsChanged: () => void;
}

function NoteCard({ event, actor, body, projectId, onEventsChanged }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(body);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await window.electronAPI.kanban.editNote(projectId, event.id, editText.trim());
      setEditing(false);
      onEventsChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await window.electronAPI.kanban.deleteNote(projectId, event.id);
      onEventsChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group relative rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {actor && <span className="font-medium">{actor}</span>}
          <span title={new Date(event.createdAt).toLocaleString()}>{timeAgo(event.createdAt)}</span>
        </div>
        {!editing && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEditText(body);
                setEditing(true);
              }}
              title="Edit note"
            >
              <Pencil size={12} />
            </button>
            <button
              className="rounded p-0.5 text-muted-foreground hover:text-rose-500"
              onClick={() => void handleDelete()}
              disabled={deleting}
              title="Delete note"
            >
              <Trash size={12} />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              onClick={() => void handleSave()}
              disabled={saving || !editText.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className="chat-markdown prose prose-sm dark:prose-invert max-w-none text-sm text-foreground/85"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
        />
      )}
    </div>
  );
}

export function TaskActivityTimeline({ events, threads, projectId, onEventsChanged }: Props) {
  if (events.length === 0) {
    return (
      <section className="mb-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ClockCounterClockwise size={14} />
          Activity
        </h3>
        <p className="text-sm italic text-muted-foreground">No activity yet.</p>
      </section>
    );
  }

  return (
    <section className="mb-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ClockCounterClockwise size={14} />
        Activity
      </h3>

      <div className="space-y-0">
        {events.map((event, idx) => {
          const meta = getEventMeta(event);
          const actor = getTaskActorLabel(event, threads);
          const isLast = idx === events.length - 1;

          if (meta.isNote) {
            return (
              <div key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn('mt-1 shrink-0', meta.iconColor)}>{meta.icon}</span>
                  {!isLast && <span className="mt-1 w-px flex-1 bg-border/60" />}
                </div>
                <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
                  <NoteCard
                    event={event}
                    actor={actor}
                    body={meta.body ?? ''}
                    projectId={projectId}
                    onEventsChanged={onEventsChanged}
                  />
                </div>
              </div>
            );
          }

          return (
            <div key={event.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn('mt-0.5 shrink-0', meta.iconColor)}>{meta.icon}</span>
                {!isLast && <span className="mt-1 w-px flex-1 bg-border/60" />}
              </div>
              <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-2.5')}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm text-foreground/80">{meta.label}</span>
                  {actor && <span className="text-[11px] text-muted-foreground">{actor}</span>}
                  <span
                    className="text-[11px] text-muted-foreground/60"
                    title={new Date(event.createdAt).toLocaleString()}
                  >
                    {timeAgo(event.createdAt)}
                  </span>
                </div>
                {meta.body && (
                  <div
                    className="chat-markdown prose prose-sm dark:prose-invert mt-0.5 max-w-none text-foreground/60"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(meta.body) }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
