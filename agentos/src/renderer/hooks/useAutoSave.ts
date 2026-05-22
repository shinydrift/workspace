import { useEffect, useRef } from 'react';

/**
 * Debounced autosave that activates once `ready` becomes true.
 *
 * When `snapshot` changes (and autosave is active), calls `onSave` after
 * `delay` ms. The one-tick delay before enabling prevents a spurious save
 * on the first render after settings load.
 */
export function useAutoSave(snapshot: string, onSave: () => void, ready: boolean, delay = 1500) {
  const enabledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  // Enable autosave after initial load. The one-tick delay (setTimeout 0) lets sub-hooks
  // flush their own state updates from the same render cycle before we start watching for changes.
  useEffect(() => {
    if (ready && !enabledRef.current) {
      const id = setTimeout(() => {
        enabledRef.current = true;
      }, 0);
      return () => clearTimeout(id);
    }
  }, [ready]);

  useEffect(() => {
    if (!enabledRef.current) return;
    clearTimeout(timerRef.current ?? undefined);
    timerRef.current = setTimeout(() => saveRef.current(), delay);
    return () => clearTimeout(timerRef.current ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, delay]);
}
