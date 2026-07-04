import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useEditorSettings(settings: AppSettings | null) {
  const [label, setLabel] = useSettingsField(settings, (s) => s.editor?.label ?? '', '');
  const [command, setCommand] = useSettingsField(settings, (s) => s.editor?.command ?? '', '');
  const [args, setArgs] = useSettingsField(settings, (s) => s.editor?.args ?? '', '');

  return {
    label,
    setLabel,
    command,
    setCommand,
    args,
    setArgs,
  };
}
