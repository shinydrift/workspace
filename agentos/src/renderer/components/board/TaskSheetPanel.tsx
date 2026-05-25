import React, { useState } from 'react';
import { useThreadTask } from '../../hooks/useThreadTask';
import { TaskSlideOver } from './TaskSlideOver';

interface Props {
  threadId: string;
}

export function TaskSheetPanel({ threadId }: Props) {
  const data = useThreadTask(threadId);
  const [open, setOpen] = useState(false);

  if (!data) return null;
  const { task, projectId, columns, allTasks } = data;
  const statusLabel = columns.find((c) => c.id === task.status)?.label ?? task.status;

  return (
    <div className="max-w-[1200px] w-full mx-auto">
      <div className="mx-6 mb-3 rounded-lg border border-border bg-muted/30">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60"
          onClick={() => setOpen(true)}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500/70" />
          <span className="font-medium text-foreground">Task</span>
          <span className="truncate text-muted-foreground">{task.title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            {statusLabel}
            <span>›</span>
          </span>
        </button>
      </div>

      <TaskSlideOver
        task={open ? task : null}
        projectId={projectId}
        columns={columns}
        allTasks={allTasks}
        onClose={() => setOpen(false)}
        onMove={(taskId, status) => {
          window.electronAPI.kanban
            .move(projectId, taskId, status)
            .catch((e) => console.error('Failed to move task', e));
        }}
      />
    </div>
  );
}
