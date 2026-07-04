import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, ArrowRight, CircleNotch, Warning, PencilSimple, Trash, Check, X } from '@phosphor-icons/react';
import { ContentCard } from '@/components/ui/content-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { Button } from '@/components/ui/button';
import { MeetingRecorder } from './MeetingRecorder';
import { MeetingsPanelHeader } from './MeetingsPanelHeader';
import { ContinuousCaptureBar } from './ContinuousCaptureBar';
import { SegmentTimeline } from './SegmentTimeline';
import { RecordingPlayer } from './RecordingPlayer';
import { cn, formatSeconds, getBaseName } from '@/lib/utils';
import type { RecordingRecord, SavedProject, Thread } from '../../../shared/types';
import type { ProcessingEntry, UseMeetingRecorderResult } from '../../hooks/useMeetingRecorder';
import type { UseContinuousCaptureResult } from '../../hooks/useContinuousCapture';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';

export function isMeetingThread(t: Thread) {
  return t.recordingId != null;
}

/** "Today" / "Yesterday" / "Mon, Jul 3, 2026" — groups the recordings list by day. */
function dayHeading(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
  onChanged,
}: {
  recording: RecordingRecord;
  thread: Thread | undefined;
  projects: SavedProject[];
  onCreateThread: UseMeetingRecorderResult['createThread'];
  onChanged: () => void;
}) {
  const { setSelectedThread } = useUIStore();
  const [busy, setBusy] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pickedProject, setPickedProject] = useState<SavedProject | null>(projects[0] ?? null);
  const [threadError, setThreadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recording.title ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync pickedProject when projects load asynchronously
  useEffect(() => {
    if (pickedProject === null && projects.length > 0) {
      setPickedProject(projects[0]);
    }
  }, [projects, pickedProject]);

  const date = new Date(recording.createdAt);
  const timeLabel = `${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const displayTitle = recording.title?.trim() || timeLabel;

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

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditing(false);
    if (next === (recording.title?.trim() ?? '')) return;
    try {
      if (next) await window.electronAPI.files.setRecordingTitle({ recordingId: recording.id, title: next });
      onChanged();
    } catch {
      /* leave list as-is on failure */
    }
  }

  async function handleDelete() {
    try {
      await window.electronAPI.files.deleteRecording({ recordingId: recording.id });
      onChanged();
    } catch {
      setConfirmDelete(false);
    }
  }

  return (
    <div className="group px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={titleDraft}
              placeholder="Add a title…"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTitle();
                if (e.key === 'Escape') {
                  setTitleDraft(recording.title ?? '');
                  setEditing(false);
                }
              }}
              className="w-full text-sm bg-muted border border-border rounded px-2 py-1 text-foreground"
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm text-foreground truncate">{displayTitle}</p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Rename recording"
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
              >
                <PencilSimple className="h-3 w-3" />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {timeLabel} · {formatSeconds(recording.durationSeconds)}
            {thread && <span className="text-blue-400"> · {thread.name}</span>}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleDelete()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : thread ? (
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setSelectedThread(thread.id)}>
              Open <ArrowRight className="h-3 w-3" />
            </Button>
          ) : showProjectPicker ? (
            <div className="flex flex-col items-end gap-1">
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
            <Button size="sm" variant="outline" onClick={() => setShowProjectPicker(true)}>
              Start Thread
            </Button>
          )}
          {!confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete recording"
              className="shrink-0 p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition"
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <RecordingPlayer recordingId={recording.id} durationSeconds={recording.durationSeconds} className="mt-2" />
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
                    {visibleRecordings.map((r, i) => {
                      const prev = visibleRecordings[i - 1];
                      const dayLabel = dayHeading(r.createdAt);
                      const showHeading = !prev || dayHeading(prev.createdAt) !== dayLabel;
                      return (
                        <React.Fragment key={r.id}>
                          {showHeading && (
                            <p className="px-4 pt-3 pb-1 text-[11px] font-medium text-muted-foreground/70">
                              {dayLabel}
                            </p>
                          )}
                          <RecordingRow
                            recording={r}
                            thread={r.threadId ? threads[r.threadId] : undefined}
                            projects={projects}
                            onCreateThread={recorder.createThread}
                            onChanged={loadRecordings}
                          />
                        </React.Fragment>
                      );
                    })}
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
