import { useEffect, useRef } from 'react';

/**
 * Poll a fetcher on mount and every intervalMs. Cancels on unmount or dep change.
 * Uses stable refs for fetcher/onSuccess so they don't need to be in the dep array.
 */
export function usePollData<T>(
  fetcher: () => Promise<T | null | undefined>,
  onSuccess: (data: T) => void,
  intervalMs: number,
  deps: unknown[] = [],
  label = 'poll'
): void {
  const inFlight = useRef(false);
  const fetcherRef = useRef(fetcher);
  const onSuccessRef = useRef(onSuccess);
  fetcherRef.current = fetcher;
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let cancelled = false;
    inFlight.current = false;

    function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      fetcherRef
        .current()
        .then((d: T | null | undefined) => {
          if (!cancelled && d != null) onSuccessRef.current(d);
        })
        .catch((err: unknown) => console.warn(`Failed to load ${label}`, err))
        .finally(() => {
          inFlight.current = false;
        });
    }

    load();
    const timer = window.setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
