import React, { useRef } from 'react';
import { Sun, Moon, Desktop } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import type { FontSize } from '@/hooks/useTheme';
import { useSettings } from '../../contexts/SettingsContext';
import { useUIStore } from '../../store/uiStore';
import { ToggleRow } from '@/components/ui/toggle-row';
import { SettingSection } from '@/components/ui/setting-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Desktop },
] as const;

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
];

const COLOR_SWATCHES = [
  { value: 'violet', bg: 'bg-[oklch(0.45_0.22_280)]', label: 'Violet' },
  { value: 'emerald', bg: 'bg-[oklch(0.48_0.16_160)]', label: 'Emerald' },
  { value: 'amber', bg: 'bg-[oklch(0.58_0.19_55)]', label: 'Amber' },
  { value: 'default', bg: 'bg-[oklch(0.4_0_0)]', label: 'Default' },
] as const;

export function AppearanceTab() {
  const { theme, setTheme, colorTheme, setColorTheme, fontSize, setFontSize } = useTheme();
  const { appearance } = useSettings();
  const setUiDevMode = useUIStore((s) => s.setDevMode);

  function handleDevModeChange(value: boolean) {
    appearance.setDevMode(value);
    setUiDevMode(value);
    window.electronAPI?.settings.set({ devMode: value }).catch((err) => {
      console.warn('Failed to persist dev mode', err);
    });
  }

  const editorPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function persistEditor(label: string, command: string, args: string) {
    const trimmedCommand = command.trim();
    const trimmedArgs = args.trim();
    // Drop the setting entirely when no command is set so the header badge stays hidden; the label
    // alone has nothing to launch.
    const editor = trimmedCommand
      ? { label: label.trim(), command: trimmedCommand, ...(trimmedArgs ? { args: trimmedArgs } : {}) }
      : undefined;
    // Debounce: these come from text inputs, so persist once typing settles rather than on every
    // keystroke (each set is a disk write + a settingsChanged broadcast to every window).
    if (editorPersistTimer.current) clearTimeout(editorPersistTimer.current);
    editorPersistTimer.current = setTimeout(() => {
      window.electronAPI?.settings.set({ editor }).catch((err) => {
        console.warn('Failed to persist editor', err);
      });
    }, 400);
  }

  function handleEditorLabelChange(value: string) {
    appearance.setEditorLabel(value);
    persistEditor(value, appearance.editorCommand, appearance.editorArgs);
  }

  function handleEditorCommandChange(value: string) {
    appearance.setEditorCommand(value);
    persistEditor(appearance.editorLabel, value, appearance.editorArgs);
  }

  function handleEditorArgsChange(value: string) {
    appearance.setEditorArgs(value);
    persistEditor(appearance.editorLabel, appearance.editorCommand, value);
  }

  return (
    <div className="space-y-6">
      <SettingSection title="Theme">
        <div className="flex items-center rounded-lg bg-muted p-0.5 w-fit">
          {THEME_OPTIONS.map(({ value, label, Icon: ThemeIcon }) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              onClick={() => setTheme(value)}
              className={cn(
                'h-auto gap-2 px-3 py-1.5 text-sm',
                theme === value
                  ? 'bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground'
                  : 'text-muted-foreground hover:bg-transparent hover:text-muted-foreground'
              )}
            >
              <ThemeIcon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </SettingSection>

      <SettingSection title="Font Size">
        <div className="flex items-center rounded-lg bg-muted p-0.5 w-fit">
          {FONT_SIZE_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              onClick={() => setFontSize(value)}
              className={cn(
                'h-auto px-4 py-1.5 text-sm',
                fontSize === value
                  ? 'bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground'
                  : 'text-muted-foreground hover:bg-transparent hover:text-muted-foreground'
              )}
            >
              {label}
            </Button>
          ))}
        </div>
      </SettingSection>

      <SettingSection title="Color">
        <div className="flex gap-3 items-center">
          {COLOR_SWATCHES.map(({ value, bg, label }) => (
            <button
              key={value}
              type="button"
              title={label}
              onClick={() => setColorTheme(value)}
              className={cn(
                'w-6 h-6 rounded-full transition-all ring-offset-background ring-offset-2',
                bg,
                colorTheme === value ? 'ring-2 ring-ring' : 'opacity-60 hover:opacity-100'
              )}
            />
          ))}
        </div>
      </SettingSection>

      <SettingSection
        title="Editor"
        description="Open a thread's worktree in your editor from the thread header. Command is the executable (resolved against your shell PATH, or a full path); put any flags in Arguments."
      >
        <div className="flex flex-col gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="editor-label" className="text-xs text-muted-foreground">
              Label
            </Label>
            <Input
              id="editor-label"
              value={appearance.editorLabel}
              onChange={(e) => handleEditorLabelChange(e.target.value)}
              placeholder="VS Code"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editor-command" className="text-xs text-muted-foreground">
              Command
            </Label>
            <Input
              id="editor-command"
              value={appearance.editorCommand}
              onChange={(e) => handleEditorCommandChange(e.target.value)}
              placeholder="code"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editor-args" className="text-xs text-muted-foreground">
              Arguments <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="editor-args"
              value={appearance.editorArgs}
              onChange={(e) => handleEditorArgsChange(e.target.value)}
              placeholder="-n"
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>
      </SettingSection>

      <SettingSection title="Developer">
        <ToggleRow
          label="Dev mode"
          description="Shows the terminal view in threads."
          checked={appearance.devMode}
          onCheckedChange={handleDevModeChange}
        />
      </SettingSection>
    </div>
  );
}
