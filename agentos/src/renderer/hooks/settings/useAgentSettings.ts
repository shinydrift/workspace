import type { AppSettings, Provider, ProviderEntry } from '../../../shared/types';
import {
  DEFAULT_PROVIDER_ORDER,
  normalizeProviderOrder,
} from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useAgentSettings(settings: AppSettings | null) {
  const [queueSilenceFallbackMs, setQueueSilenceFallbackMs] = useSettingsField(
    settings,
    (s) => Math.max(200, s.queueSilenceFallbackMs ?? 1_500),
    1500
  );
  const [providerOrder, setProviderOrder] = useSettingsField<ProviderEntry[]>(
    settings,
    (s) => {
      const normalized = normalizeProviderOrder(s.providerOrder);
      return normalized.length > 0 ? normalized : [...DEFAULT_PROVIDER_ORDER];
    },
    [...DEFAULT_PROVIDER_ORDER]
  );
  const [persistDebugLogs, setPersistDebugLogs] = useSettingsField(settings, (s) => Boolean(s.persistDebugLogs), false);
  const [logRetentionDays, setLogRetentionDays] = useSettingsField(
    settings,
    (s) => Math.max(1, s.logRetentionDays ?? 30),
    30
  );
  const [ttsEnabled, setTtsEnabled] = useSettingsField(settings, (s) => Boolean(s.voice?.ttsEnabled), false);
  const [autopilotEnabled, setAutopilotEnabled] = useSettingsField(
    settings,
    (s) => Boolean(s.autopilot?.enabled),
    false
  );
  const [autopilotMaxConsecutiveTurns, setAutopilotMaxConsecutiveTurns] = useSettingsField(
    settings,
    (s) => Math.max(1, s.autopilot?.maxConsecutiveTurns ?? 3),
    3
  );
  const [autopilotTranscriptMessages, setAutopilotTranscriptMessages] = useSettingsField(
    settings,
    (s) => Math.max(1, s.autopilot?.transcriptMessages ?? 12),
    12
  );
  const [autopilotPlannerProvider, setAutopilotPlannerProvider] = useSettingsField<Provider | undefined>(
    settings,
    (s) => s.autopilot?.plannerProvider,
    undefined
  );
  const [autopilotPlannerModel, setAutopilotPlannerModel] = useSettingsField<string | undefined>(
    settings,
    (s) => s.autopilot?.plannerModel,
    undefined
  );

  return {
    queueSilenceFallbackMs,
    setQueueSilenceFallbackMs,
    providerOrder,
    setProviderOrder,
    persistDebugLogs,
    setPersistDebugLogs,
    logRetentionDays,
    setLogRetentionDays,
    ttsEnabled,
    setTtsEnabled,
    autopilotEnabled,
    setAutopilotEnabled,
    autopilotMaxConsecutiveTurns,
    setAutopilotMaxConsecutiveTurns,
    autopilotTranscriptMessages,
    setAutopilotTranscriptMessages,
    autopilotPlannerProvider,
    setAutopilotPlannerProvider,
    autopilotPlannerModel,
    setAutopilotPlannerModel,
  };
}
