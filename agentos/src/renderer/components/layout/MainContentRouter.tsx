import React from 'react';
import type { AutomationJob, Thread } from '../../../shared/types';
import { ThreadDetail, type DetailView } from '../threads/ThreadDetail';
import { NewThreadComposer } from '../threads/NewThreadComposer';
import { AutomationsPanel } from '../automations/AutomationsPanel';
import { ProjectDetail } from '../project/ProjectDetail';
import { GlobalInsightsPanel } from '../insights/GlobalInsightsPanel';
import { MeetingPanel } from '../meetings/MeetingPanel';
import type { UseMeetingRecorderResult } from '../../hooks/useMeetingRecorder';

interface Props {
  activePanel: 'new-thread' | 'automations' | 'usage' | 'meetings' | null;
  meetingEnabled: boolean;
  selected: Thread | null;
  selectedProject: { path: string; name: string } | null;
  selectedProjectThread: Thread | null;
  automations: AutomationJob[];
  onAutomationsChange: (jobs: AutomationJob[]) => void;
  onProjectDeleted: () => void;
  onProjectRenamed: (newName: string) => void;
  meetingRecorder: UseMeetingRecorderResult;
  onMeetingDirChange: (dir: string, projectName?: string) => void;
  onSelectProject: (path: string, name: string) => void;
  threadInitialView: DetailView | null;
}

export function MainContentRouter({
  activePanel,
  meetingEnabled,
  selected,
  selectedProject,
  selectedProjectThread,
  automations,
  onAutomationsChange,
  onProjectDeleted,
  onProjectRenamed,
  meetingRecorder,
  onMeetingDirChange,
  onSelectProject,
  threadInitialView,
}: Props) {
  if (activePanel === 'automations') {
    return <AutomationsPanel open jobs={automations} onJobsChange={onAutomationsChange} />;
  }
  if (activePanel === 'usage') {
    return <GlobalInsightsPanel onSelectProject={onSelectProject} />;
  }
  if (activePanel === 'meetings' && meetingEnabled && !selected) {
    return <MeetingPanel recorder={meetingRecorder} onWorkingDirChange={onMeetingDirChange} />;
  }
  return (
    <div className="min-h-0 flex-1 flex flex-col">
      {selected ? (
        <ThreadDetail key={selected.id} thread={selected} initialView={threadInitialView ?? undefined} />
      ) : selectedProject ? (
        <ProjectDetail
          projectPath={selectedProject.path}
          projectName={selectedProject.name}
          thread={selectedProjectThread}
          onProjectDeleted={onProjectDeleted}
          onProjectRenamed={onProjectRenamed}
        />
      ) : (
        <NewThreadComposer />
      )}
    </div>
  );
}
