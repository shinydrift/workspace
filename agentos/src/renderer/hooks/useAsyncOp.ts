import { useState, useCallback } from 'react';
import { getErrorMessage } from '../../shared/utils/errorMessage';

export function useAsyncOp() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async function <T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(getErrorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []); // setBusy and setError are stable React state setters

  return { busy, error, setError, run };
}
