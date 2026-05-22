import React, { useEffect, type KeyboardEvent } from 'react';
import { ArrowUp, Microphone, MicrophoneSlash, Paperclip, Robot, Stop } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatSeconds } from '@/lib/utils';
import { useComposerBase } from '@/hooks/useComposerBase';
import { AttachedFileList } from './AttachedFileList';

interface PromptInputProps {
  threadId: string;
  disabled?: boolean;
  isRunning?: boolean;
  onStop?: () => void;
  autopilotEnabled?: boolean;
  onToggleAutopilot?: () => void;
}

export function PromptInput({
  threadId,
  disabled,
  isRunning,
  onStop,
  autopilotEnabled,
  onToggleAutopilot,
}: PromptInputProps) {
  const {
    error,
    setError,
    value,
    setValue,
    autoSubmitAfterTranscript,
    setAutoSubmitAfterTranscript,
    textareaRef,
    fileInputRef,
    attachedFiles,
    setAttachedFiles,
    onFileInputChange,
    removeAttachedFile,
    recording,
    transcribing,
    recordingSeconds,
    toggleRecording,
    onTextareaChange,
  } = useComposerBase();

  // When a Voice Flow transcript arrives with autoSubmit, fire send() once value has been applied.
  useEffect(() => {
    if (!autoSubmitAfterTranscript || !value.trim()) return;
    setAutoSubmitAfterTranscript(false);
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmitAfterTranscript, value]);

  async function send() {
    const trimmed = value.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    setError('');
    setValue('');
    const filesToSend = attachedFiles;
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      let input = trimmed;
      if (filesToSend.length > 0) {
        const uploadedPaths = await Promise.all(
          filesToSend.map((file) =>
            window.electronAPI.files.upload({ threadId, fileName: file.name, data: file.data }).then((r) => r.path)
          )
        );
        const fileList = uploadedPaths.map((p) => `  ${p}`).join('\n');
        input = input ? `${input}\n\nAttached files:\n${fileList}` : `Attached files:\n${fileList}`;
      }
      await window.electronAPI.terminal.sendInput({ threadId, input: input + '\n' });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setValue(trimmed);
      setAttachedFiles(filesToSend);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col bg-card shrink-0">
      {error && <div className="px-3 pt-2 text-sm text-destructive">{error}</div>}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileInputChange} />
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={onTextareaChange}
        onKeyDown={onKeyDown}
        disabled={disabled || transcribing}
        autoFocus
        rows={1}
        placeholder={
          transcribing
            ? 'Transcribing…'
            : disabled
              ? 'Thread not running'
              : 'Type a prompt… (Enter to send, Shift+Enter for newline)'
        }
        className={cn(
          'w-full resize-none border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none px-4 pt-3 pb-2 text-sm leading-relaxed min-h-[44px] max-h-[200px]',
          (disabled || transcribing) && 'opacity-50'
        )}
      />
      <AttachedFileList files={attachedFiles} onRemove={removeAttachedFile} />
      <div className="border-t border-border/60" />
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || transcribing || recording}
          variant="ghost"
          size="icon"
          title="Attach files"
          aria-label="Attach files"
          className="h-7 w-7 shrink-0 text-muted-foreground"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </Button>
        {onToggleAutopilot && (
          <Button
            onClick={onToggleAutopilot}
            variant="ghost"
            size="icon"
            title={autopilotEnabled ? 'Autopilot on — click to disable' : 'Autopilot off — click to enable'}
            aria-label={autopilotEnabled ? 'Autopilot on — click to disable' : 'Autopilot off — click to enable'}
            className={cn(
              'h-7 w-7 shrink-0',
              autopilotEnabled ? 'text-emerald-500 hover:text-emerald-400' : 'text-muted-foreground'
            )}
          >
            <Robot className="h-3.5 w-3.5" weight={autopilotEnabled ? 'fill' : 'regular'} />
          </Button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {recording && (
            <span className="text-xs tabular-nums text-destructive">{formatSeconds(recordingSeconds)}</span>
          )}
          <Button
            onClick={toggleRecording}
            disabled={disabled || transcribing}
            variant={recording ? 'destructive' : 'ghost'}
            size="icon"
            title={recording ? 'Stop recording' : 'Record voice input'}
            aria-label={recording ? 'Stop recording' : 'Record voice input'}
            className="h-7 w-7"
          >
            {recording ? <MicrophoneSlash className="h-3.5 w-3.5" /> : <Microphone className="h-3.5 w-3.5" />}
          </Button>
          {isRunning && onStop ? (
            <Button onClick={onStop} variant="secondary" size="icon" className="h-7 w-7 p-0">
              <Stop className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={disabled || (!value.trim() && attachedFiles.length === 0) || transcribing}
              size="icon"
              className="h-7 w-7 p-0"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
