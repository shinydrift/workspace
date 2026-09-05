import type { AppSettings, KeepAwakeMode } from '../../../shared/types';
import { DEFAULT_KEEP_AWAKE_MODE, resolveKeepAwakeMode } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useAppearanceSettings(settings: AppSettings | null) {
  const [devMode, setDevMode] = useSettingsField(settings, (s) => Boolean(s.devMode), false);
  const [desktopNotifications, setDesktopNotifications] = useSettingsField(
    settings,
    (s) => Boolean(s.notifications?.desktop),
    false
  );
  const [keepAwake, setKeepAwake] = useSettingsField<KeepAwakeMode>(
    settings,
    (s) => resolveKeepAwakeMode(s),
    DEFAULT_KEEP_AWAKE_MODE
  );

  return {
    devMode,
    setDevMode,
    desktopNotifications,
    setDesktopNotifications,
    keepAwake,
    setKeepAwake,
  };
}
