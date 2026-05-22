import { useCallback, useEffect, useRef, useState } from 'react';
import type { KanbanTask, KanbanTaskEvent, KanbanTaskGitSummary } from '../../../shared/types/kanban';

interface UseTaskSheetDetailsArgs {
  task: KanbanTask | null;
  projectId: string;
}

export function useTaskSheetDetails({ task, projectId }: UseTaskSheetDetailsArgs) {
  const [subtasks, setSubtasks] = useState<KanbanTask[]>([]);
  const [events, setEvents] = useState<KanbanTaskEvent[]>([]);
  const [gitSummary, setGitSummary] = useState<KanbanTaskGitSummary | null>(null);
  const loadVersionRef = useRef(0);

  const loadTaskDetails = useCallback(
    (taskId: string) => {
      const version = ++loadVersionRef.current;
      setEvents([]);
      setSubtasks([]);
      setGitSummary(null);
      void (async () => {
        const [eventsResult, subtasksResult, gitSummaryResult] = await Promise.allSettled([
          window.electronAPI.kanban.listEvents(projectId, taskId),
          window.electronAPI.kanban.listSubtasks(projectId, taskId),
          window.electronAPI.kanban.getGitSummary(projectId, taskId),
        ]);
        if (loadVersionRef.current !== version) return;
        if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value);
        if (subtasksResult.status === 'fulfilled') setSubtasks(subtasksResult.value);
        if (gitSummaryResult.status === 'fulfilled') setGitSummary(gitSummaryResult.value);
      })();
    },
    [projectId]
  );

  useEffect(() => {
    if (!task) return;
    loadTaskDetails(task.id);
    const offMoved = window.electronAPI.on.kanbanTaskMoved((event) => {
      if (event.taskId === task.id) loadTaskDetails(task.id);
    });
    const offUpdated = window.electronAPI.on.kanbanTaskUpdated((updatedTask) => {
      if (updatedTask.id === task.id) loadTaskDetails(task.id);
    });
    return () => {
      offMoved();
      offUpdated();
    };
  }, [task, loadTaskDetails]);

  return {
    events,
    subtasks,
    gitSummary,
    reloadTaskDetails: loadTaskDetails,
  };
}
