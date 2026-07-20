import React, { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import { type SavedProject, type Thread } from '../../../shared/types';
import { useThreadComposer } from '../../hooks/useThreadComposer';
import { BlockGridBackground } from './BlockGridBackground';
import { AttachedFileList } from '../prompt/AttachedFileList';
import { getBaseName } from '@/lib/utils';
import { useComposerBase } from '@/hooks/useComposerBase';
import { useNewThreadSubmit } from './useNewThreadSubmit';
import { ComposerToolbar } from './ComposerToolbar';
import { Textarea } from '@/components/ui/textarea';

/**
 * Pick the project that most-recently had a thread created in it. Falls back to
 * the first project, or null if there are no projects. Used as the default
 * workingDir so hotkey-initiated new threads land in the "active" project.
 */
function pickDefaultProject(projects: SavedProject[], threads: Thread[]): SavedProject | null {
  if (projects.length === 0) return null;
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const sortedThreads = [...threads]
    .filter((t) => !t.archivedAt && !t.parentThreadId)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const t of sortedThreads) {
    const key = t.projectPath ?? t.workingDirectory;
    const match = byPath.get(key);
    if (match) return match;
  }
  return projects[0];
}

export function NewThreadComposer() {
  const { upsertThread, threads: threadsMap } = useDomainStore();
  const { setSelectedThread } = useUIStore();

  const [projects, setProjects] = useState<SavedProject[]>([]);

  const bgMouseRef = useRef({ x: -9999, y: -9999 });

  const {
    workingDir,
    setWorkingDir,
    projectName,
    setProjectName,
    provider,
    setProviderSelection,
    model,
    setModelSelection,
    effort,
    setEffort,
    reasoning,
    setReasoning,
    clearProviderTouch,
    runOnHost,
    setRunOnHostSelection,
    sandboxEnabled,
    autopilotEnabled,
    setAutopilotEnabled,
    creating,
    setCreating,
    error,
    setError,
    matchedProject,
  } = useThreadComposer(projects);

  const {
    value: message,
    setValue: setMessage,
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
  } = useComposerBase({ isNewThread: true, setError });

  useEffect(() => {
    window.electronAPI.project
      .list()
      .then((list) => {
        setProjects(list);
        const preferred = pickDefaultProject(list, Object.values(threadsMap));
        if (preferred) {
          setWorkingDir(preferred.path);
          setProjectName(preferred.name);
        }
      })
      .catch((err) => {
        console.warn('Failed to load projects', err);
      });
    textareaRef.current?.focus();
    // Intentionally run once on mount — threadsMap is used for initial seed only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useNewThreadSubmit({
    attachedFiles,
    autopilotEnabled,
    matchedProjectName: matchedProject?.name,
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
  });

  useEffect(() => {
    if (!autoSubmitAfterTranscript) return;
    if (!message.trim() || !workingDir) return;
    setAutoSubmitAfterTranscript(false);
    void submit();
  }, [autoSubmitAfterTranscript, setAutoSubmitAfterTranscript, message, workingDir, submit]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onBgMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    bgMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onBgMouseLeave() {
    bgMouseRef.current = { x: -9999, y: -9999 };
  }

  return (
    <div className="flex flex-col h-full bg-background p-3">
      <div
        className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden rounded-xl bg-card shadow-sm border border-border/40 p-8"
        onMouseMove={onBgMouseMove}
        onMouseLeave={onBgMouseLeave}
      >
        <BlockGridBackground mouseRef={bgMouseRef} />
        {/* vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 25%, var(--background) 80%)',
          }}
        />
        <div className="relative z-10 w-full max-w-2xl">
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileInputChange} />
            {/* Textarea */}
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={onTextareaChange}
              onKeyDown={onKeyDown}
              rows={4}
              placeholder="What would you like to work on? (Enter to start)"
              className="w-full resize-none border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none px-4 pt-4 pb-2 text-sm leading-relaxed min-h-[100px] max-h-[200px]"
            />

            <AttachedFileList files={attachedFiles} onRemove={removeAttachedFile} />

            <div className="border-t border-border/60" />

            <ComposerToolbar
              autopilotEnabled={autopilotEnabled}
              creating={creating}
              model={model}
              effort={effort}
              reasoning={reasoning}
              onAttach={() => fileInputRef.current?.click()}
              onModelChange={setModelSelection}
              onEffortChange={setEffort}
              onReasoningChange={setReasoning}
              onStop={() => setCreating(false)}
              onSubmit={() => void submit()}
              onToggleAutopilot={() => setAutopilotEnabled((value) => !value)}
              provider={provider}
              runOnHost={runOnHost}
              sandboxEnabled={sandboxEnabled}
              onToggleRunOnHost={() => setRunOnHostSelection(!runOnHost)}
              recording={recording}
              recordingSeconds={recordingSeconds}
              setProviderSelection={setProviderSelection}
              toggleRecording={toggleRecording}
              transcribing={transcribing}
              projects={projects}
              projectName={projectName}
              workingDir={workingDir}
              onProjectChange={(p) => {
                clearProviderTouch();
                setWorkingDir(p.path);
                setProjectName(p.name);
              }}
              onBrowseFolder={async () => {
                const dir = await window.electronAPI.dialog.openDirectory().catch((): undefined => undefined);
                if (dir) {
                  setWorkingDir(dir);
                  setProjectName(getBaseName(dir));
                }
              }}
            />

            {error && <div className="px-3 pb-2.5 text-xs text-destructive">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
