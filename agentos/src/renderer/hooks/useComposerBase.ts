import { useState, useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import { useAttachedFiles } from './useAttachedFiles';
import { useAudioRecording } from './useAudioRecording';
import { useUIStore } from '@/store/uiStore';

interface UseComposerBaseOptions {
  /** true = only consume pendingTranscripts where newThread=true (NewThreadComposer).
   *  false (default) = only consume transcripts where newThread is falsy (PromptInput). */
  isNewThread?: boolean;
  /** Provide an external error setter to route attachment/audio errors there instead of
   *  the hook's own error state. Useful when the parent already owns an error display. */
  setError?: (msg: string) => void;
}

export function useComposerBase({ isNewThread = false, setError: externalSetError }: UseComposerBaseOptions = {}) {
  const [internalError, setInternalError] = useState('');
  const setError = externalSetError ?? setInternalError;

  const [value, setValue] = useState('');
  const [autoSubmitAfterTranscript, setAutoSubmitAfterTranscript] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { attachedFiles, setAttachedFiles, onFileInputChange, removeAttachedFile } = useAttachedFiles(setError);

  const { recording, transcribing, recordingSeconds, toggleRecording } = useAudioRecording({
    onTranscript: (text) => {
      setValue((prev) => (prev ? `${prev} ${text}` : text));
      textareaRef.current?.focus();
    },
    onError: setError,
  });

  const pendingTranscript = useUIStore((s) => s.pendingTranscript);
  const setPendingTranscript = useUIStore((s) => s.setPendingTranscript);

  useEffect(() => {
    if (!pendingTranscript) return;
    // Each composer handles only the transcripts directed at it.
    if (isNewThread !== !!pendingTranscript.newThread) return;
    setValue((prev) => (prev ? `${prev} ${pendingTranscript.text}` : pendingTranscript.text));
    if (pendingTranscript.autoSubmit) setAutoSubmitAfterTranscript(true);
    setPendingTranscript(null);
    textareaRef.current?.focus();
  }, [pendingTranscript, setPendingTranscript, isNewThread]);

  const onTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return {
    // error is only meaningful when no externalSetError was provided
    error: internalError,
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
  };
}
