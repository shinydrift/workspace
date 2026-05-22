import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AppSettings } from '../../../shared/types';

export function useSettingsField<T>(
  settings: AppSettings | null,
  getter: (s: AppSettings) => T,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);
  const prevSerializedRef = useRef<string>(JSON.stringify(defaultValue));
  useEffect(() => {
    if (!settings) return;
    const next = getter(settings);
    const serialized = JSON.stringify(next);
    if (serialized === prevSerializedRef.current) return;
    prevSerializedRef.current = serialized;
    setValue(next);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps -- getter intentionally omitted: callers pass inline arrows, memoizing them adds more complexity than it's worth
  return [value, setValue];
}
