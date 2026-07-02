import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDragResize } from '../../hooks/useDragResize';
import { useDomainStore } from '../../store/domainStore';
import { useUIStore } from '../../store/uiStore';
import { cn, formatSeconds } from '@/lib/utils';
import { SettingsModal } from '../settings/SettingsModal';
import { isMeetingThread } from '../meetings/MeetingPanel';
import { FEATURES } from '../../../shared/features';
import { TitleBar } from './TitleBar';
import { SettingsMenuDropdown } from './SettingsMenuDropdown';
import { SidebarToggle } from './SidebarToggle';
import { AgentOSLogo } from '../ui/agentos-logo';
import { DockerDesktopPrompt } from './DockerDesktopPrompt';
import { useDockerHealth } from '../../hooks/useDockerHealth';
import { AppSidebar } from './AppSidebar';
import { MainContentRouter } from './MainContentRouter';
import { useVoiceFlow } from '../../hooks/useVoiceFlow';
import { RecordingPill } from '../voice-flow/RecordingPill';
import { useMeetingRecorder } from '../../hooks/useMeetingRecorder';
import { useContinuousCapture } from '../../hooks/useContinuousCapture';
import type { DetailView } from '../threads/ThreadDetail';

function VoiceFlowController() {
  const { state, recordingSeconds, downloadProgress, transcriptPreview, analyserNode, cancel } = useVoiceFlow();
  return (
    <RecordingPill
      state={state}
      recordingSeconds={recordingSeconds}
      downloadProgress={downloadProgress}
      transcriptPreview={transcriptPreview}
      analyserNode={analyserNode}
      onCancel={cancel}
    />
  );
}

function MeetingRecordingPill({
  state,
  elapsed,
  statusMsg,
  onStop,
}: {
  state: 'recording' | 'processing';
  elapsed: number;
  statusMsg: string;
  onStop: () => void;
}) {
  return (
    <div className="fixed bottom-6 left-6 flex items-center gap-2 px-3 py-2 rounded-full bg-neutral-900 shadow-lg select-none z-50">
      {state === 'processing' ? (
        <>
          <span className="h-2 w-2 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
          <span className="text-white/70 text-sm">{statusMsg || 'Processing…'}</span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-white text-sm font-mono tabular-nums">{formatSeconds(elapsed)}</span>
          <button
            onClick={onStop}
            className="flex cursor-pointer items-center justify-center w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 shrink-0"
            aria-label="Stop meeting recording"
          >
            <span className="block w-2 h-2 rounded-sm bg-white/60" />
          </button>
        </>
      )}
    </div>
  );
}

export function AppShell() {
  const { threads, automations, setAutomations } = useDomainStore();
  const { selectedThreadId, sandboxBuildProgress, memoryIndexProgress, threadFilter, setSelectedThread } = useUIStore();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [showThreadFilters, setShowThreadFilters] = useState(false);
  const [activePanel, setActivePanel] = useState<'new-thread' | 'automations' | 'usage' | 'meetings' | null>(null);
  const [selectedProject, setSelectedProject] = useState<{ path: string; name: string } | null>(null);
  const [threadInitialView, setThreadInitialView] = useState<DetailView | null>(null);

  const [meetingWorkingDir, setMeetingWorkingDir] = useState('');
  const [meetingProjectName, setMeetingProjectName] = useState<string | undefined>(undefined);
  const meetingRecorder = useMeetingRecorder(meetingWorkingDir, meetingProjectName);
  // Always-on capture lives here (app root) so 5-min segments keep rolling across navigation.
  const continuousCapture = useContinuousCapture();
  const handleMeetingDirChange = useCallback((dir: string, projectName?: string) => {
    setMeetingWorkingDir(dir);
    setMeetingProjectName(projectName);
  }, []);
  const selectedProjectPath = selectedProject?.path ?? null;
  const [searchFocusSeq, setSearchFocusSeq] = useState(0);
  const {
    width: sidebarWidth,
    isDragging: sidebarDragging,
    handleMouseDown: sidebarMouseDown,
  } = useDragResize({
    defaultWidth: 282,
    minWidth: 180,
    maxWidth: 520,
    storageKey: 'agentos:sidebarWidth',
  });
  const {
    showDockerPrompt,
    dockerChecking,
    dockerActionBusy,
    dockerError,
    healthStatus,
    handleDockerRecheck,
    handleOpenDocker,
  } = useDockerHealth();

  const threadList = Object.values(threads);
  const selected = selectedThreadId ? threads[selectedThreadId] : null;

  // For the project view: most recent non-archived thread for the selected project
  const selectedProjectThread = useMemo(() => {
    if (!selectedProjectPath) return null;
    return (
      threadList
        .filter(
          (t) =>
            (t.projectPath ?? t.workingDirectory) === selectedProjectPath &&
            t.status !== 'archived' &&
            !t.archivedAt &&
            !t.parentThreadId
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] ?? null
    );
  }, [selectedProjectPath, threadList]);

  const hasActiveThreadFilter = useMemo(
    () => threadFilter.query.trim().length > 0 || threadFilter.status !== 'all' || threadFilter.sortBy !== 'newest',
    [threadFilter]
  );

  // Selecting a thread switches away from automations, usage, and project wiki.
  // Keep meetings panel active when a meeting thread is selected; MainContentRouter renders ThreadDetail in that case.
  useEffect(() => {
    if (!selectedThreadId) return;
    const t = threads[selectedThreadId];
    const isMeeting = FEATURES.MEETINGS && t && isMeetingThread(t);
    setActivePanel((prev) => (prev === 'meetings' && isMeeting ? 'meetings' : null));
    if (!isMeeting) setSelectedProject(null);
  }, [selectedThreadId, threads]);

  // Clear pending initial view after thread mounts so subsequent sidebar navigations start at chat.
  useEffect(() => {
    setThreadInitialView(null);
  }, [selectedThreadId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f')) return;
      if (sidebarHidden || !showThreadFilters) return;
      e.preventDefault();
      setSearchFocusSeq((v) => v + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarHidden, showThreadFilters]);

  // Voice Flow "new thread" signal — fired from useVoiceFlow when the hotkey is
  // released while the app is unfocused (or no thread is selected). Route to NewThreadComposer.
  useEffect(() => {
    const onNewThread = () => {
      setSelectedThread(null);
      setSelectedProject(null);
      setActivePanel(null);
    };
    window.addEventListener('voiceflow:newThread', onNewThread);
    return () => window.removeEventListener('voiceflow:newThread', onNewThread);
  }, [setSelectedThread]);

  const titleBarLeft = (
    <SidebarToggle
      sidebarHidden={sidebarHidden}
      onToggle={() => setSidebarHidden((v) => !v)}
      onOpenAutomations={() => {
        setSidebarHidden(false);
        setSelectedThread(null);
        setActivePanel('automations');
      }}
    />
  );

  const titleBarRight = (
    <SettingsMenuDropdown onOpenSettings={() => setShowSettings(true)} healthStatus={healthStatus} />
  );

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-background">
      <TitleBar left={titleBarLeft} right={titleBarRight}>
        <AgentOSLogo className="h-5 w-auto" />
      </TitleBar>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside
          style={!sidebarHidden ? { width: sidebarWidth } : undefined}
          className={cn(
            'relative shrink-0 bg-background flex flex-col',
            sidebarDragging
              ? 'transition-none overflow-hidden'
              : 'transition-all duration-200 ease-out overflow-hidden',
            sidebarHidden ? 'w-0 min-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'opacity-100 translate-x-0'
          )}
        >
          <AppSidebar
            threads={threadList}
            selectedId={selectedThreadId}
            selectedProjectPath={selectedProjectPath}
            activePanel={activePanel}
            meetingEnabled={FEATURES.MEETINGS}
            showThreadFilters={showThreadFilters}
            searchFocusSeq={searchFocusSeq}
            sandboxBuildProgress={sandboxBuildProgress ?? null}
            memoryIndexProgress={memoryIndexProgress ?? null}
            hasActiveThreadFilter={hasActiveThreadFilter}
            sidebarMouseDown={sidebarMouseDown}
            onSetActivePanel={(panel) => {
              setSelectedThread(null);
              setSelectedProject(null);
              setActivePanel(panel);
            }}
            onToggleFilters={() => setShowThreadFilters((v) => !v)}
            onSelectProject={(path, name) => {
              setSelectedThread(null);
              setActivePanel(null);
              setSelectedProject({ path, name });
            }}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-background relative overflow-hidden">
          <MainContentRouter
            activePanel={activePanel}
            meetingEnabled={FEATURES.MEETINGS}
            selected={selected}
            selectedProject={selectedProject}
            selectedProjectThread={selectedProjectThread}
            automations={automations}
            onAutomationsChange={setAutomations}
            onProjectDeleted={() => setSelectedProject(null)}
            onProjectRenamed={(newName) => setSelectedProject((p) => (p ? { ...p, name: newName } : p))}
            meetingRecorder={meetingRecorder}
            continuousCapture={continuousCapture}
            onMeetingDirChange={handleMeetingDirChange}
            onSelectProject={(path, name) => {
              setSelectedThread(null);
              setActivePanel(null);
              setSelectedProject({ path, name });
            }}
            threadInitialView={threadInitialView}
          />
        </main>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {FEATURES.VOICE_FLOW && <VoiceFlowController />}
      {FEATURES.MEETINGS &&
        (meetingRecorder.state === 'recording' || meetingRecorder.state === 'processing') &&
        activePanel !== 'meetings' && (
          <MeetingRecordingPill
            state={meetingRecorder.state}
            elapsed={meetingRecorder.elapsed}
            statusMsg={meetingRecorder.statusMsg}
            onStop={() => void meetingRecorder.stopAndProcess()}
          />
        )}
      <DockerDesktopPrompt
        open={showDockerPrompt}
        checking={dockerChecking}
        actionBusy={dockerActionBusy}
        error={dockerError}
        onOpenDocker={handleOpenDocker}
        onRecheck={handleDockerRecheck}
      />
    </div>
  );
}
