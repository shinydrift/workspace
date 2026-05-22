import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBoardStore } from '../../store/boardStore';
import { useDomainStore } from '../../store/domainStore';
import type { KanbanClassOfService, KanbanStage, KanbanTask, KanbanTaskPriority } from '../../../shared/types/kanban';
import type { ProjectConfigLookup } from '../../../shared/types';

export const BLOCKED_COLUMN_ID = '__blocked__';

function buildColumnOrder(stages: KanbanStage[]): string[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const inProgressIdx = sorted.findIndex(
    (s) => s.id.toLowerCase().includes('progress') || s.label.toLowerCase().includes('progress')
  );
  const result = sorted.map((s) => s.id);
  if (inProgressIdx >= 0) {
    result.splice(inProgressIdx + 1, 0, BLOCKED_COLUMN_ID);
  }
  return result;
}

interface UseBoardDataOptions {
  projectId: string;
  projectPath?: string;
  onConfigChange?: (lookup: ProjectConfigLookup) => void;
}

export function useBoardData({ projectId }: UseBoardDataOptions) {
  const { tasks, wipLimits, loading, error, setTasks, setWipLimits, setLoading, setError, upsertTask, removeTask } =
    useBoardStore();
  const threads = useDomainStore((s) => s.threads);

  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const selectedTaskRef = useRef(selectedTask);
  const tasksRef = useRef<KanbanTask[]>(tasks);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskClassOfService, setNewTaskClassOfService] = useState<KanbanClassOfService>('standard');
  const [creating, setCreating] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [columns, setColumns] = useState<KanbanStage[]>([]);

  // --- Batch selection ---
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastClickedTaskId, setLastClickedTaskId] = useState<string | null>(null);
  const [batchNotification, setBatchNotification] = useState<{ message: string; kind: 'success' | 'warning' } | null>(
    null
  );

  const showBatchNotification = useCallback((message: string, kind: 'success' | 'warning') => {
    setBatchNotification({ message, kind });
    setTimeout(() => setBatchNotification(null), 4000);
  }, []);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const rangeSelect = useCallback(
    (taskId: string, orderedIds: string[]) => {
      setLastClickedTaskId(taskId);
      if (!lastClickedTaskId) {
        setSelectedTaskIds((prev) => {
          const n = new Set(prev);
          n.add(taskId);
          return n;
        });
        return;
      }
      const fromIdx = orderedIds.indexOf(lastClickedTaskId);
      const toIdx = orderedIds.indexOf(taskId);
      if (fromIdx === -1 || toIdx === -1) {
        setSelectedTaskIds((prev) => {
          const n = new Set(prev);
          n.add(taskId);
          return n;
        });
        return;
      }
      const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        orderedIds.slice(lo, hi + 1).forEach((id) => next.add(id));
        return next;
      });
    },
    [lastClickedTaskId]
  );

  const selectAll = useCallback(() => {
    setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  }, [tasks]);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
    setLastClickedTaskId(null);
  }, []);

  // --- Error display ---
  const showError = useCallback((msg: string) => {
    setMoveError(msg);
    setTimeout(() => setMoveError(null), 4000);
  }, []);

  // --- Stages ---
  // Load stages from DB
  useEffect(() => {
    if (!projectId) return;
    void window.electronAPI.kanban.listStages(projectId).then(setColumns);
  }, [projectId]);

  // --- Kanban tasks ---
  // Initial load
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([window.electronAPI.kanban.list(projectId), window.electronAPI.kanban.getWipLimits(projectId)])
      .then(([t, w]) => {
        setTasks(t);
        setWipLimits(w);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId, setTasks, setWipLimits, setLoading, setError]);

  // Keep refs in sync
  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // --- Live event subscriptions ---
  useEffect(() => {
    const off = window.electronAPI.on.kanbanStagesUpdated((event) => {
      if (event.projectId === projectId) {
        void window.electronAPI.kanban.listStages(projectId).then(setColumns);
      }
    });
    return off;
  }, [projectId]);

  // Live task updates
  useEffect(() => {
    const offMoved = window.electronAPI.on.kanbanTaskMoved((event) => {
      if (event.projectId === projectId) {
        upsertTask(event.task);
        if (selectedTaskRef.current?.id === event.task.id) setSelectedTask(event.task);
      }
    });
    const offCreated = window.electronAPI.on.kanbanTaskCreated((task) => {
      if (task.projectId === projectId) upsertTask(task);
    });
    const offUpdated = window.electronAPI.on.kanbanTaskUpdated((task) => {
      if (task.projectId === projectId) {
        upsertTask(task);
        if (selectedTaskRef.current?.id === task.id) setSelectedTask(task);
      }
    });
    const offDeleted = window.electronAPI.on.kanbanTaskDeleted((event) => {
      if (event.projectId === projectId) {
        removeTask(event.taskId);
        if (selectedTaskRef.current?.id === event.taskId) setSelectedTask(null);
      }
    });
    return () => {
      offMoved();
      offCreated();
      offUpdated();
      offDeleted();
    };
  }, [projectId, upsertTask, removeTask]);

  // --- Handlers ---
  const updateTaskLocally = useCallback(
    (taskId: string, patch: Partial<KanbanTask>) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (task) upsertTask({ ...task, ...patch });
      setSelectedTask((prev) => (prev?.id === taskId ? { ...prev, ...patch } : prev));
    },
    [upsertTask]
  );

  const handleDrop = useCallback(
    async (taskId: string, newStatus: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      setMoveError(null);
      try {
        if (newStatus === BLOCKED_COLUMN_ID) {
          // Drag TO blocked — add a manual sentinel dep if not already blocked
          if (task.blockedBy.length > 0) return;
          await window.electronAPI.kanban.addDependency(projectId, taskId, '__manual__');
          updateTaskLocally(taskId, { blockedBy: ['__manual__'] });
        } else if (task.blockedBy.length > 0 && task.status === 'in_progress') {
          // Drag OUT OF blocked — clear all blockers concurrently then move
          await Promise.all(
            task.blockedBy.map((blockerId) => window.electronAPI.kanban.removeDependency(projectId, taskId, blockerId))
          );
          const updated = await window.electronAPI.kanban.move(projectId, taskId, newStatus);
          upsertTask(updated);
          if (selectedTaskRef.current?.id === taskId) setSelectedTask(updated);
        } else {
          if (task.status === newStatus) return;
          const updated = await window.electronAPI.kanban.move(projectId, taskId, newStatus);
          upsertTask(updated);
          if (selectedTaskRef.current?.id === taskId) setSelectedTask(updated);
        }
      } catch (e: unknown) {
        showError(String(e));
      }
    },
    [projectId, upsertTask, showError, updateTaskLocally]
  );

  const bulkMove = useCallback(
    async (status: string) => {
      const ids = Array.from(selectedTaskIds);
      if (ids.length === 0) return;
      const originals: Record<string, string> = {};
      for (const t of tasksRef.current) {
        if (selectedTaskIds.has(t.id)) originals[t.id] = t.status;
      }
      ids.forEach((id) => updateTaskLocally(id, { status }));
      const failed: string[] = [];
      for (const taskId of ids) {
        try {
          await window.electronAPI.kanban.move(projectId, taskId, status);
        } catch {
          updateTaskLocally(taskId, { status: originals[taskId] ?? status });
          failed.push(taskId);
        }
      }
      const succeeded = ids.length - failed.length;
      if (failed.length === 0) {
        clearSelection();
        showBatchNotification(`${succeeded} task${succeeded !== 1 ? 's' : ''} moved`, 'success');
      } else {
        setSelectedTaskIds(new Set(failed));
        showBatchNotification(
          `${succeeded} of ${ids.length} tasks moved (${failed.length} blocked by WIP limit)`,
          'warning'
        );
      }
    },
    [selectedTaskIds, projectId, updateTaskLocally, clearSelection, showBatchNotification]
  );

  const bulkPriority = useCallback(
    async (priority: KanbanTaskPriority) => {
      const ids = Array.from(selectedTaskIds);
      if (ids.length === 0) return;
      const originals: Record<string, KanbanTaskPriority> = {};
      for (const t of tasksRef.current) {
        if (selectedTaskIds.has(t.id)) originals[t.id] = t.priority;
      }
      ids.forEach((id) => updateTaskLocally(id, { priority }));
      for (const taskId of ids) {
        try {
          await window.electronAPI.kanban.updatePriority(projectId, taskId, priority);
        } catch {
          updateTaskLocally(taskId, { priority: originals[taskId] ?? priority });
        }
      }
      clearSelection();
      showBatchNotification(`${ids.length} task${ids.length !== 1 ? 's' : ''} updated`, 'success');
    },
    [selectedTaskIds, projectId, updateTaskLocally, clearSelection, showBatchNotification]
  );

  const bulkAssign = useCallback(
    async (threadId: string | null) => {
      const ids = Array.from(selectedTaskIds);
      if (ids.length === 0) return;
      const originals: Record<string, string | null> = {};
      for (const t of tasksRef.current) {
        if (selectedTaskIds.has(t.id)) originals[t.id] = t.assignedThreadId ?? null;
      }
      ids.forEach((id) => updateTaskLocally(id, { assignedThreadId: threadId ?? undefined }));
      for (const taskId of ids) {
        try {
          await window.electronAPI.kanban.assignThread(projectId, taskId, threadId);
        } catch {
          updateTaskLocally(taskId, { assignedThreadId: originals[taskId] ?? undefined });
        }
      }
      clearSelection();
      showBatchNotification(`${ids.length} task${ids.length !== 1 ? 's' : ''} updated`, 'success');
    },
    [selectedTaskIds, projectId, updateTaskLocally, clearSelection, showBatchNotification]
  );

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    let deleted = 0;
    for (const taskId of ids) {
      try {
        await window.electronAPI.kanban.delete(projectId, taskId);
        removeTask(taskId);
        if (selectedTaskRef.current?.id === taskId) setSelectedTask(null);
        deleted++;
      } catch {
        // skip failed deletes
      }
    }
    clearSelection();
    showBatchNotification(`${deleted} task${deleted !== 1 ? 's' : ''} deleted`, 'success');
  }, [selectedTaskIds, projectId, removeTask, clearSelection, showBatchNotification]);

  const bulkArchive = useCallback(async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    const originals: Record<string, string> = {};
    for (const t of tasksRef.current) {
      if (selectedTaskIds.has(t.id)) originals[t.id] = t.status;
    }
    ids.forEach((id) => updateTaskLocally(id, { status: 'archived' }));
    const failed: string[] = [];
    for (const taskId of ids) {
      try {
        await window.electronAPI.kanban.move(projectId, taskId, 'archived');
      } catch {
        updateTaskLocally(taskId, { status: originals[taskId] ?? 'archived' });
        failed.push(taskId);
      }
    }
    const succeeded = ids.length - failed.length;
    clearSelection();
    showBatchNotification(`${succeeded} task${succeeded !== 1 ? 's' : ''} archived`, 'success');
  }, [selectedTaskIds, projectId, updateTaskLocally, clearSelection, showBatchNotification]);

  async function handleCreateTask() {
    if (!newTaskTitle.trim() || !createStatus) return;
    setCreating(true);
    try {
      await window.electronAPI.kanban.create({
        projectId,
        title: newTaskTitle.trim(),
        status: createStatus,
        classOfService: newTaskClassOfService,
      });
      setNewTaskTitle('');
      setNewTaskClassOfService('standard');
      setCreateStatus(null);
    } finally {
      setCreating(false);
    }
  }

  async function handleWipLimitChange(status: string, newLimit: number) {
    try {
      await window.electronAPI.kanban.setWipLimit(projectId, status, newLimit);
      setWipLimits(await window.electronAPI.kanban.getWipLimits(projectId));
    } catch (e: unknown) {
      showError(String(e));
    }
  }

  const archivedTasks = useMemo(() => tasks.filter((t) => t.status === 'archived'), [tasks]);

  const tasksByStatus = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    const blocked: KanbanTask[] = [];
    for (const task of tasks) {
      if (task.status === 'archived') continue;
      if (task.status === 'in_progress' && task.blockedBy.length > 0) {
        blocked.push(task);
      } else {
        (map[task.status] ??= []).push(task);
      }
    }
    map[BLOCKED_COLUMN_ID] = blocked;
    return map;
  }, [tasks]);

  const subtaskCounts = useMemo(() => {
    const terminalIds = new Set(columns.filter((s) => s.terminal).map((s) => s.id));
    terminalIds.add('done');
    terminalIds.add('archived');
    const counts: Record<string, { total: number; done: number }> = {};
    for (const task of tasks) {
      if (task.parentTaskId) {
        const c = (counts[task.parentTaskId] ??= { total: 0, done: 0 });
        c.total++;
        if (terminalIds.has(task.status)) c.done++;
      }
    }
    return counts;
  }, [tasks, columns]);

  const columnOrder = useMemo(() => buildColumnOrder(columns), [columns]);

  return {
    // State
    loading,
    error,
    columns,
    columnOrder,
    threads,
    selectedTask,
    createStatus,
    newTaskTitle,
    creating,
    moveError,
    tasksByStatus,
    archivedTasks,
    subtaskCounts,
    wipLimits,
    // Batch selection
    selectedTaskIds,
    lastClickedTaskId,
    setLastClickedTaskId,
    batchNotification,
    toggleSelect,
    rangeSelect,
    selectAll,
    clearSelection,
    bulkMove,
    bulkPriority,
    bulkAssign,
    bulkDelete,
    bulkArchive,
    // Setters
    setSelectedTask,
    setCreateStatus,
    setNewTaskTitle,
    newTaskClassOfService,
    setNewTaskClassOfService,
    // Handlers
    handleDrop,
    handleCreateTask,
    handleWipLimitChange,
    updateTaskLocally,
  };
}
