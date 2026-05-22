import React, { createContext, useContext } from 'react';
import { useSettingsState } from '../hooks/useSettingsState';

type SettingsState = ReturnType<typeof useSettingsState>;

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const state = useSettingsState();
  return <SettingsContext.Provider value={state}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
