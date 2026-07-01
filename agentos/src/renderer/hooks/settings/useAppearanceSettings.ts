import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useAppearanceSettings(settings: AppSettings | null) {
  const [devMode, setDevMode] = useSettingsField(settings, (s) => Boolean(s.devMode), false);
  const [editorLabel, setEditorLabel] = useSettingsField(settings, (s) => s.editor?.label ?? '', '');
  const [editorCommand, setEditorCommand] = useSettingsField(settings, (s) => s.editor?.command ?? '', '');
  const [editorArgs, setEditorArgs] = useSettingsField(settings, (s) => s.editor?.args ?? '', '');

  return {
    devMode,
    setDevMode,
    editorLabel,
    setEditorLabel,
    editorCommand,
    setEditorCommand,
    editorArgs,
    setEditorArgs,
  };
}
