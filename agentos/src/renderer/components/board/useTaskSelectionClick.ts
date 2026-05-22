import { useCallback } from 'react';
import type React from 'react';
import type { KanbanTask } from '../../../shared/types/kanban';

interface UseTaskSelectionClickOptions {
  task: KanbanTask;
  selectionActive?: boolean;
  onToggleSelect?: () => void;
  onShiftClick?: () => void;
  onSetLastClicked?: () => void;
  onActivate: (task: KanbanTask) => void;
}

export function useTaskSelectionClick({
  task,
  selectionActive,
  onToggleSelect,
  onShiftClick,
  onSetLastClicked,
  onActivate,
}: UseTaskSelectionClickOptions) {
  return useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey && onShiftClick) {
        e.preventDefault();
        onShiftClick();
        return;
      }
      if (selectionActive && onToggleSelect) {
        onSetLastClicked?.();
        onToggleSelect();
        return;
      }
      onSetLastClicked?.();
      onActivate(task);
    },
    [task, selectionActive, onToggleSelect, onShiftClick, onSetLastClicked, onActivate]
  );
}
