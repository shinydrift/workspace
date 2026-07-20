import { useCallback } from 'react';
import type { AttachedFile } from '../prompt/AttachedFileList';
import type { Provider } from '../../../shared/types';
import type { ClaudeEffort, CodexReasoning } from '../../../shared/types/provider';
import { deriveThreadTitleFromMessage } from '../../../shared/threadTitle';
import { getBaseName } from '@/lib/utils';

interface SubmitOptions {
  attachedFiles: AttachedFile[];
  autopilotEnabled: boolean;
  matchedProjectName?: string;
  message: string;
  model: string | undefined;
  effort?: ClaudeEffort | undefined;
  reasoning?: CodexReasoning | undefined;
  runOnHost?: boolean;
  projectName: string;
  provider: Provider;
  setAttachedFiles: (files: AttachedFile[]) => void;
  setCreating: (value: boolean) => void;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  setSelectedThread: (threadId: string) => void;
  upsertThread: (thread: unknown) => void;
  workingDir: string;
}

export function useNewThreadSubmit({
  attachedFiles,
  autopilotEnabled,
  matchedProjectName,
  message,
  model,
  effort,
  reasoning,
  runOnHost,
  projectName,
  provider,
  setAttachedFiles,
  setCreating,
  setError,
  setMessage,
  setSelectedThread,
  upsertThread,
  workingDir,
}: SubmitOptions) {
  return useCallback(async () => {
    if (!workingDir) {
      setError('Select a working directory first');
      return;
    }

    setCreating(true);
    setError('');
    const filesToSend = attachedFiles;
    setAttachedFiles([]);

    try {
      const messageTitle = deriveThreadTitleFromMessage(message);
      const threadName =
        messageTitle || projectName.trim() || matchedProjectName || getBaseName(workingDir) || 'Untitled';
      const thread = await window.electronAPI.thread.create({
        name: threadName,
        workingDirectory: workingDir,
        provider,
        model,
        effort,
        reasoning,
        runOnHost,
        createWorktree: true,
        projectName: projectName.trim() || undefined,
      });

      upsertThread({ ...thread, logBuffer: [] });

      if (autopilotEnabled) {
        const updated = await window.electronAPI.thread.setAutopilot(thread.id, true);
        upsertThread({ ...updated, logBuffer: [] });
      }

      // Build input before navigating so file-upload errors can still surface in NewThreadComposer.
      let inputToSend: string | null = null;
      if (message.trim() || filesToSend.length > 0) {
        let input = message.trim();
        if (filesToSend.length > 0) {
          const uploadedPaths = await Promise.all(
            filesToSend.map((file) =>
              window.electronAPI.files
                .upload({ threadId: thread.id, fileName: file.name, data: file.data })
                .then((result) => result.path)
            )
          );
          const fileList = uploadedPaths.map((path) => `  ${path}`).join('\n');
          input = input ? `${input}\n\nAttached files:\n${fileList}` : `Attached files:\n${fileList}`;
        }
        inputToSend = input;
      }

      setMessage('');
      setSelectedThread(thread.id);
      setCreating(false);

      // Fire sendInput after navigation — thread status events keep ThreadDetail in sync.
      if (inputToSend !== null) {
        window.electronAPI.terminal.sendInput({ threadId: thread.id, input: inputToSend + '\n' }).catch(console.error);
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
      setAttachedFiles(filesToSend);
      setCreating(false);
    }
  }, [
    attachedFiles,
    autopilotEnabled,
    matchedProjectName,
    message,
    model,
    effort,
    reasoning,
    runOnHost,
    projectName,
    provider,
    setAttachedFiles,
    setCreating,
    setError,
    setMessage,
    setSelectedThread,
    upsertThread,
    workingDir,
  ]);
}
