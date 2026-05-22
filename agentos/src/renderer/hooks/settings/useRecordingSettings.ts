import type { AppSettings, RecordingSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

const EMPTY_RECORDING: RecordingSettings = {};

export function useRecordingSettings(settings: AppSettings | null) {
  const [recording, setRecording] = useSettingsField<RecordingSettings>(
    settings,
    (s) => s.recording ?? EMPTY_RECORDING,
    EMPTY_RECORDING
  );
  return { recording, setRecording };
}
