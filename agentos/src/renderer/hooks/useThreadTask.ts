import { useEffect, useState } from 'react';
import { useDomainStore } from '../store/domainStore';
import type { KanbanStage, KanbanTask } from '../../shared/types/kanban';

export interface ThreadTaskData {
  task: KanbanTask;
  projectId: string;
  columns: KanbanStage[];
  allTasks: KanbanTask[];
}

/** Loads the kanban task a thread belongs to (via thread.taskId) and keeps it live. */
export function useThreadTask(threadId: string): ThreadTaskData | null {
  const thread = useDomainStore((s) => s.threads[threadId]);
  const taskId = thread?.taskId ?? null;
  const projectId = thread?.projectId ?? null;

  const [task, setTask] = useState<KanbanTask | null>(null);
  const [columns, setColumns] = useState<KanbanStage[]>([]);
  const [allTasks, setAllTasks] = useState<KanbanTask[]>([]);

  useEffect(() => {
    if (!projectId || !taskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    window.electronAPI.kanban.get(projectId, taskId).then((t) => {
      if (!cancelled) setTask(t);
    });
    window.electronAPI.kanban.listStages(projectId).then((s) => {
      if (!cancelled) setColumns(s);
    });
    window.electronAPI.kanban.list(projectId).then((list) => {
      if (!cancelled) setAllTasks(list);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId]);

  useEffect(() => {
    if (!projectId || !taskId) return;
    const upsertInList = (t: KanbanTask) => {
      if (t.projectId !== projectId) return;
      setAllTasks((prev) => {
        const idx = prev.findIndex((x) => x.id === t.id);
        if (idx === -1) return [...prev, t];
        const next = [...prev];
        next[idx] = t;
        return next;
      });
    };
    const offUpdated = window.electronAPI.on.kanbanTaskUpdated((t) => {
      if (t.id === taskId) setTask(t);
      upsertInList(t);
    });
    const offMoved = window.electronAPI.on.kanbanTaskMoved((e) => {
      if (e.task.id === taskId) setTask(e.task);
      upsertInList(e.task);
    });
    const offCreated = window.electronAPI.on.kanbanTaskCreated((t) => upsertInList(t));
    const offDeleted = window.electronAPI.on.kanbanTaskDeleted((e) => {
      if (e.taskId === taskId) setTask(null);
      if (e.projectId === projectId) setAllTasks((prev) => prev.filter((x) => x.id !== e.taskId));
    });
    return () => {
      offUpdated();
      offMoved();
      offCreated();
      offDeleted();
    };
  }, [projectId, taskId]);

  if (!task || !projectId) return null;
  return { task, projectId, columns, allTasks };
}
