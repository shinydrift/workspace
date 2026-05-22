import React, { useEffect, useMemo, useState } from 'react';
import type { AppSettings, Thread, ProjectConfigLookup } from '../../../shared/types';
import { FEATURES } from '../../../shared/features';
import { ContentCard } from '@/components/ui/content-card';
import { ProjectSettingsSheet } from './ProjectSettingsSheet';
import { ProjectDetailHeader } from './ProjectDetailHeader';
import { ProjectDetailContent } from './ProjectDetailContent';

interface Props {
  projectPath: string;
  projectName: string;
  thread: Thread | null; // most recent thread for this project, used for memory
  onProjectDeleted: () => void;
  onProjectRenamed: (newName: string) => void;
}

export type ViewId = 'board' | 'wiki' | 'insights' | 'memory' | 'sessions' | 'code' | 'graph';

export function ProjectDetail({ projectPath, projectName, thread, onProjectDeleted, onProjectRenamed }: Props) {
  const [view, setView] = useState<ViewId>('insights');
  const [showSettings, setShowSettings] = useState(false);
  const [configLookup, setConfigLookup] = useState<ProjectConfigLookup | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [enablingBoard, setEnablingBoard] = useState(false);

  useEffect(() => {
    if (!projectPath) return;
    void window.electronAPI.project.getConfig(projectPath).then(setConfigLookup);
  }, [projectPath]);

  useEffect(() => {
    void window.electronAPI.settings.get().then(setAppSettings);
  }, [showSettings]);

  async function handleEnableBoard() {
    setEnablingBoard(true);
    try {
      await window.electronAPI.project.updateConfig(projectPath, 'kanban', { enabled: true });
      const refreshed = await window.electronAPI.project.getConfig(projectPath);
      setConfigLookup(refreshed);
    } finally {
      setEnablingBoard(false);
    }
  }

  const tabs = useMemo(
    () => [
      ...(FEATURES.KANBAN ? [{ id: 'board' as const, label: 'board', disabled: !thread?.projectId }] : []),
      { id: 'insights' as const, label: 'insights', disabled: !thread },
      { id: 'memory' as const, label: 'memory', disabled: !thread },
      { id: 'sessions' as const, label: 'sessions', disabled: !thread },
      { id: 'code' as const, label: 'code', disabled: !thread },
      { id: 'graph' as const, label: 'graph', disabled: !thread },
      { id: 'wiki' as const, label: 'wiki', disabled: false },
    ],
    [thread]
  );

  return (
    <ContentCard className="relative">
      <ProjectDetailHeader
        projectName={projectName}
        projectPath={projectPath}
        view={view}
        tabs={tabs}
        onSetView={setView}
        onOpenSettings={() => setShowSettings(true)}
      />

      <ProjectDetailContent
        view={view}
        projectPath={projectPath}
        thread={thread}
        configLookup={configLookup}
        enablingBoard={enablingBoard}
        onEnableBoard={() => void handleEnableBoard()}
        onConfigChange={setConfigLookup}
      />

      <ProjectSettingsSheet
        projectPath={projectPath}
        projectName={projectName}
        configLookup={configLookup}
        appSettings={appSettings}
        onConfigChange={setConfigLookup}
        onProjectDeleted={onProjectDeleted}
        onProjectRenamed={onProjectRenamed}
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </ContentCard>
  );
}
