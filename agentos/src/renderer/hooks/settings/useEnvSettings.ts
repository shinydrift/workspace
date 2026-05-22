import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useEnvSettings(settings: AppSettings | null) {
  const [envSafelist, setEnvSafelist] = useSettingsField(settings, (s) => s.envSafelist ?? [], []);
  const [envVars, setEnvVars] = useSettingsField(settings, (s) => s.envVars ?? {}, {});
  return { envSafelist, setEnvSafelist, envVars, setEnvVars };
}
