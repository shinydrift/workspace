import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, ArrowRight, CircleNotch, Warning } from '@phosphor-icons/react';
import { ContentCard } from '@/components/ui/content-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { Button } from '@/components/ui/button';
import { MeetingRecorder } from './MeetingRecorder';
import { MeetingsPanelHeader } from './MeetingsPanelHeader';
import { ContinuousCaptureBar } from './ContinuousCaptureBar';
import { SegmentTimeline } from './SegmentTimeline';
import { cn, formatSeconds, getBaseName } from '@/lib/utils';
import type { RecordingRecord, SavedProject, Thread } from '../../../shared/types';
import type { ProcessingEntry, UseMeetingRecorderResult } from '../../hooks/useMeetingRecorder';
import type { UseContinuousCaptureResult } from '../../hooks/useContinuousCapture';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';

export function isMeetingThread(t: Thread) {
  return t.recordingId != null;
}

interface MeetingPanelProps {
  recorder: UseMeetingRecorderResult;
  continuousCapture: UseContinuousCaptureResult;
  onWorkingDirChange: (dir: string, projectName?: string) => void;
}

function ProcessingRow({ entry }: { entry: ProcessingEntry }) {
  const date = new Date(entry.createdAt);
  const label = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{formatSeconds(entry.durationSeconds)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
        {entry.error ? (
          <>
            <Warning className="h-3 w-3 text-destructive shrink-0" />
            <span className="text-destructive">{entry.error}</span>
          </>
        ) : (
          <>
            <CircleNotch className="h-3 w-3 animate-spin shrink-0" />
            <span>{entry.statusMsg}</span>
          </>
        )}
      </div>
    </div>
  );
}

function RecordingRow({
  recording,
  thread,
  projects,
  onCreateThread,
}: {
  recording: RecordingRecord;
  thread: Thread | undefined;
  projects: SavedProject[];
  onCreateThread: UseMeetingRecorderResult['createThread'];
}) {
  const { setSelectedThread } = useUIStore();
  const [busy, setBusy] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pickedProject, setPickedProject] = useState<SavedProject | null>(projects[0] ?? null);
  const [threadError, setThreadError] = useState('');

  // Sync pickedProject when projects load asynchronously
  useEffect(() => {
    if (pickedProject === null && projects.length > 0) {
      setPickedProject(projects[0]);
    }
  }, [projects, pickedProject]);

  const date = new Date(recording.createdAt);
  const label = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  async function handleCreateThread() {
    if (!pickedProject) return;
    setBusy(true);
    setThreadError('');
    try {
      await onCreateThread(recording.id, recording.createdAt, pickedProject.path, pickedProject.name);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{formatSeconds(recording.durationSeconds)}</p>
        {thread && <p className="text-xs text-blue-400 truncate mt-0.5">{thread.name}</p>}
      </div>

      {thread ? (
        <Button size="sm" variant="ghost" className="shrink-0 gap-1" onClick={() => setSelectedThread(thread.id)}>
          Open <ArrowRight className="h-3 w-3" />
        </Button>
      ) : showProjectPicker ? (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-2">
            <select
              className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground"
              value={pickedProject?.path ?? ''}
              onChange={(e) => {
                setPickedProject(projects.find((p) => p.path === e.target.value) ?? null);
                setThreadError('');
              }}
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => void handleCreateThread()} disabled={busy || !pickedProject}>
              {busy ? <CircleNotch className="h-3 w-3 animate-spin" /> : 'Start'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowProjectPicker(false);
                setThreadError('');
              }}
            >
              ✕
            </Button>
          </div>
          {threadError && <p className="text-xs text-destructive max-w-[200px] text-right">{threadError}</p>}
        </div>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowProjectPicker(true)}>
          Start Thread
        </Button>
      )}
    </div>
  );
}

export function MeetingPanel({ recorder, continuousCapture, onWorkingDirChange }: MeetingPanelProps) {
  const { threads } = useDomainStore();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [defaultProject, setDefaultProject] = useState<SavedProject | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);

  const loadRecordings = useCallback(async () => {
    const list = await window.electronAPI.files.listRecordings().catch(() => [] as RecordingRecord[]);
    setRecordings(list);
  }, []);

  useEffect(() => {
    Promise.all([window.electronAPI.project.list(), window.electronAPI.settings.get()])
      .then(([list, settings]) => {
        setProjects(list);
        const saved = list.find((p) => p.path === settings.meetingProjectPath);
        setDefaultProject(saved ?? (list.length > 0 ? list[0] : null));
      })
      .catch(() => {});
    void loadRecordings();
  }, [loadRecordings]);

  // Reload list only when recorder transitions TO idle (recording just completed)
  const prevRecorderStateRef = useRef(recorder.state);
  useEffect(() => {
    if (prevRecorderStateRef.current !== 'idle' && recorder.state === 'idle') {
      void loadRecordings();
    }
    prevRecorderStateRef.current = recorder.state;
  }, [recorder.state, loadRecordings]);

  useEffect(() => {
    onWorkingDirChange(defaultProject?.path ?? '', defaultProject?.name);
  }, [defaultProject, onWorkingDirChange]);

  function selectProject(p: SavedProject) {
    setDefaultProject(p);
    void window.electronAPI.settings.set({ meetingProjectPath: p.path });
  }

  async function pickDir() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (!dir) return;
    const existing = projects.find((p) => p.path === dir);
    selectProject(existing ?? { id: '', name: getBaseName(dir), path: dir, createdAt: 0, lastUsedAt: 0 });
  }

  const projectLabel = defaultProject?.name || (defaultProject?.path ? getBaseName(defaultProject.path) : null);

  return (
    <ContentCard>
      <MeetingsPanelHeader
        projects={projects}
        projectLabel={projectLabel}
        showPicker={showPicker}
        onSetShowPicker={setShowPicker}
        onSelectProject={selectProject}
        onPickDir={pickDir}
      />

      <div className="relative flex-1 min-h-0">
        <ScrollFade />
        <ScrollArea className="h-full">
          <div className="flex flex-col max-w-[1200px] w-full mx-auto">
            <MeetingRecorder recorder={recorder} />

            <ContinuousCaptureBar capture={continuousCapture} />
            <SegmentTimeline defaultProject={defaultProject} active={continuousCapture.enabled} />

            {!defaultProject && (
              <div
                className={cn(
                  'flex items-center gap-2 mx-4 mb-4 px-3 py-2 rounded-md bg-amber-500/10 text-xs text-amber-500'
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span>Select a default project above to auto-create threads after recording.</span>
              </div>
            )}

            {(() => {
              const visibleRecordings = recordings.filter((r) => r.id !== recorder.processingEntry?.recordingId);
              return (
                (visibleRecordings.length > 0 || recorder.processingEntry) && (
                  <div className="border-t border-border">
                    <p className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Past Recordings
                    </p>
                    {recorder.processingEntry && <ProcessingRow entry={recorder.processingEntry} />}
                    {visibleRecordings.map((r) => (
                      <RecordingRow
                        key={r.id}
                        recording={r}
                        thread={r.threadId ? threads[r.threadId] : undefined}
                        projects={projects}
                        onCreateThread={recorder.createThread}
                      />
                    ))}
                  </div>
                )
              );
            })()}
          </div>
        </ScrollArea>
      </div>
    </ContentCard>
  );
}
