import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useAppearanceSettings(settings: AppSettings | null) {
  const [devMode, setDevMode] = useSettingsField(settings, (s) => Boolean(s.devMode), false);

  return {
    devMode,
    setDevMode,
  };
}
