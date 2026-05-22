import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import { selectWipLimit } from '../../store/boardStore';
import { BoardColumn } from './BoardColumn';
import { TaskSlideOver } from './TaskSlideOver';
import { QuickAddModal } from './QuickAddModal';
import { CoordinatorBar } from './CoordinatorBar';
import { CfdPanel } from './CfdPanel';
import { ExpediteLane } from './ExpediteLane';
import { ListView } from './ListView';
import { BatchActionBar } from './BatchActionBar';
import type { ProjectConfigLookup } from '../../../shared/types';
import { useBoardData, BLOCKED_COLUMN_ID } from './useBoardData';
import { CardPrefsProvider } from './CardPrefsContext';
import { ScrollArea } from '@/components/ui/scroll-area';

interface BoardViewProps {
  projectId: string;
  projectPath?: string;
  onConfigChange?: (lookup: ProjectConfigLookup) => void;
}

export function BoardView({ projectId, projectPath, onConfigChange }: BoardViewProps) {
  const [showCfd, setShowCfd] = useState(false);
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() =>
    localStorage.getItem(`board-view-mode:${projectId}`) === 'list' ? 'list' : 'board'
  );

  function handleSetViewMode(mode: 'board' | 'list') {
    setViewMode(mode);
    localStorage.setItem(`board-view-mode:${projectId}`, mode);
  }

  const {
    loading,
    error,
    columns,
    columnOrder,
    threads,
    selectedTask,
    createStatus,
    newTaskTitle,
    newTaskClassOfService,
    creating,
    moveError,
    tasksByStatus,
    archivedTasks,
    subtaskCounts,
    wipLimits,
    selectedTaskIds,
    lastClickedTaskId: _lastClickedTaskId,
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
    setSelectedTask,
    setCreateStatus,
    setNewTaskTitle,
    setNewTaskClassOfService,
    handleDrop,
    handleCreateTask,
    handleWipLimitChange,
    updateTaskLocally,
  } = useBoardData({ projectId, projectPath, onConfigChange });

  // Escape clears selection; Cmd/Ctrl+A selects all
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedTaskIds.size > 0) {
        clearSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        selectAll();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedTaskIds.size, clearSelection, selectAll]);

  const allTasks = useMemo(() => Object.values(tasksByStatus).flat(), [tasksByStatus]);
  const expediteTasks = useMemo(() => allTasks.filter((t) => t.classOfService === 'expedite'), [allTasks]);
  const normalTasksByStatus = useMemo(() => {
    const map: typeof tasksByStatus = {};
    for (const [status, tasks] of Object.entries(tasksByStatus)) {
      map[status] = tasks.filter((t) => t.classOfService !== 'expedite');
    }
    return map;
  }, [tasksByStatus]);

  const columnDefs = useMemo(() => {
    return columnOrder
      .map((id) => {
        if (id === BLOCKED_COLUMN_ID) return { id: BLOCKED_COLUMN_ID, label: 'Blocked', isBlocked: true };
        const col = columns.find((c) => c.id === id);
        return col ? { id: col.id, label: col.label, isBlocked: false } : null;
      })
      .filter(Boolean) as { id: string; label: string; isBlocked: boolean }[];
  }, [columnOrder, columns]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">loading board…</span>
      </div>
    );
  }

  return (
    <CardPrefsProvider projectId={projectId}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {/* Error toast */}
        {(error || moveError) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-lg px-3 py-2">
            <Warning size={14} />
            {error ?? moveError}
          </div>
        )}

        {/* Batch notification */}
        {batchNotification && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 border text-xs rounded-lg px-3 py-2 ${
              batchNotification.kind === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
            }`}
          >
            <CheckCircle size={14} />
            {batchNotification.message}
          </div>
        )}

        <CoordinatorBar
          showCfd={showCfd}
          onToggleCfd={() => setShowCfd((v) => !v)}
          viewMode={viewMode}
          onSetViewMode={handleSetViewMode}
        />
        {showCfd && <CfdPanel projectId={projectId} />}

        {viewMode === 'list' ? (
          <ListView
            columnDefs={columnDefs}
            tasksByStatus={tasksByStatus}
            archivedTasks={archivedTasks}
            threads={threads}
            projectId={projectId}
            subtaskCounts={subtaskCounts}
            onTaskClick={setSelectedTask}
            updateTaskLocally={updateTaskLocally}
            selectedTaskIds={selectedTaskIds}
            onToggleSelect={toggleSelect}
            onRangeSelect={rangeSelect}
            onSetLastClicked={setLastClickedTaskId}
          />
        ) : (
          <>
            <ExpediteLane
              tasks={expediteTasks}
              projectId={projectId}
              threads={threads}
              subtaskCounts={subtaskCounts}
              onTaskClick={setSelectedTask}
              updateTaskLocally={updateTaskLocally}
              selectedTaskIds={selectedTaskIds}
              onToggleSelect={toggleSelect}
              onRangeSelect={rangeSelect}
              onSetLastClicked={setLastClickedTaskId}
            />

            {/* Board scroll area */}
            <ScrollArea scrollbars="both" className="flex flex-1 min-h-0">
              <div className="flex p-4 gap-3">
                {columnDefs.map(({ id, label, isBlocked }) => (
                  <BoardColumn
                    key={id}
                    status={id}
                    label={label}
                    isBlocked={isBlocked}
                    tasks={normalTasksByStatus[id] ?? []}
                    threads={threads}
                    projectId={projectId}
                    wipLimit={isBlocked ? null : selectWipLimit(wipLimits, id)}
                    onTaskClick={setSelectedTask}
                    onDrop={handleDrop}
                    onWipLimitChange={isBlocked ? undefined : (n) => void handleWipLimitChange(id, n)}
                    onAddTask={(s) => {
                      setCreateStatus(s);
                      setNewTaskTitle('');
                    }}
                    subtaskCounts={subtaskCounts}
                    updateTaskLocally={updateTaskLocally}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelect={toggleSelect}
                    onRangeSelect={rangeSelect}
                    onSetLastClicked={setLastClickedTaskId}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        {/* Quick-add modal */}
        {createStatus && (
          <QuickAddModal
            status={createStatus}
            title={newTaskTitle}
            classOfService={newTaskClassOfService}
            creating={creating}
            onTitleChange={setNewTaskTitle}
            onClassChange={setNewTaskClassOfService}
            onCreate={() => void handleCreateTask()}
            onClose={() => setCreateStatus(null)}
          />
        )}

        {/* Task slide-over */}
        <TaskSlideOver
          task={selectedTask}
          projectId={projectId}
          columns={columns}
          allTasks={allTasks}
          onClose={() => setSelectedTask(null)}
          onMove={handleDrop}
        />

        {/* Batch action bar */}
        {selectedTaskIds.size > 0 && (
          <BatchActionBar
            count={selectedTaskIds.size}
            columns={columns}
            threads={threads}
            projectId={projectId}
            onMove={(status) => bulkMove(status)}
            onPriority={(priority) => bulkPriority(priority)}
            onAssign={(threadId) => bulkAssign(threadId)}
            onDelete={() => bulkDelete()}
            onArchive={() => bulkArchive()}
            onClear={clearSelection}
          />
        )}
      </div>
    </CardPrefsProvider>
  );
}
