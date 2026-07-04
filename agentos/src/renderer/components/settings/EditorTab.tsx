import React, { useRef } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { SettingSection } from '@/components/ui/setting-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function EditorTab() {
  const { editor } = useSettings();

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
    editor.setLabel(value);
    persistEditor(value, editor.command, editor.args);
  }

  function handleEditorCommandChange(value: string) {
    editor.setCommand(value);
    persistEditor(editor.label, value, editor.args);
  }

  function handleEditorArgsChange(value: string) {
    editor.setArgs(value);
    persistEditor(editor.label, editor.command, value);
  }

  return (
    <div className="space-y-6">
      <SettingSection
        title="Editor"
        description="Open a thread's worktree in your editor from the thread header. Command is the executable (resolved against your shell PATH, or a full path); put any flags in Arguments. Defaults to VS Code."
      >
        <div className="flex flex-col gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="editor-label" className="text-xs text-muted-foreground">
              Label
            </Label>
            <Input
              id="editor-label"
              value={editor.label}
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
              value={editor.command}
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
              value={editor.args}
              onChange={(e) => handleEditorArgsChange(e.target.value)}
              placeholder="-n"
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
