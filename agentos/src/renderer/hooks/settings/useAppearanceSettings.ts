import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useAppearanceSettings(settings: AppSettings | null) {
  const [devMode, setDevMode] = useSettingsField(settings, (s) => Boolean(s.devMode), false);
  const [desktopNotifications, setDesktopNotifications] = useSettingsField(
    settings,
    (s) => Boolean(s.notifications?.desktop),
    false
  );

  return {
    devMode,
    setDevMode,
    desktopNotifications,
    setDesktopNotifications,
  };
}
