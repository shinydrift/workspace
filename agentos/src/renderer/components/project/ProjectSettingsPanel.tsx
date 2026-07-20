import React from 'react';
import type { AppSettings, ProjectConfigLookup, SandboxSecuritySettings } from '../../../shared/types';
import {
  DEFAULT_CONTAINER_PRUNE_SETTINGS,
  DEFAULT_SANDBOX_SETTINGS,
  DEFAULT_WORKTREE_SETTINGS,
} from '../../../shared/types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProjectSettingsNav } from './ProjectSettingsNav';
import { useProjectSettingsForm } from '../../hooks/useProjectSettingsForm';
import { GeneralSection } from './sections/GeneralSection';
import { KeysSection } from './sections/KeysSection';
import { AgentsSection } from './sections/AgentsSection';
import { SandboxSection } from './sections/SandboxSection';
import { EnvSection } from './sections/EnvSection';
import { ContainersSection } from './sections/ContainersSection';
import { MemorySection } from './sections/MemorySection';
import { CodeSection } from './sections/CodeSection';
import { KanbanSection } from './sections/KanbanSection';
import { AutopilotSection } from './sections/AutopilotSection';
import { PersonalitySection } from './sections/PersonalitySection';
import { RecordingSection } from './sections/RecordingSection';
import { DangerSection } from './sections/DangerSection';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FEATURES } from '../../../shared/features';

export interface Props {
  projectPath: string;
  projectName: string;
  configLookup: ProjectConfigLookup | null;
  appSettings: AppSettings | null;
  onConfigChange: (lookup: ProjectConfigLookup) => void;
  onProjectDeleted: () => void;
  onProjectRenamed: (newName: string) => void;
}

export function ProjectSettingsPanel({
  projectPath,
  projectName,
  configLookup,
  appSettings,
  onConfigChange,
  onProjectDeleted,
  onProjectRenamed,
}: Props) {
  const {
    section,
    setSection,
    savedProject,
    name,
    setName,
    subdir,
    setSubdir,
    confirmDelete,
    setConfirmDelete,
    deleting,
    savingKey,
    updateConfig,
    handleRenameSave,
    handleSubdirSave,
    handleDelete,
  } = useProjectSettingsForm({ projectPath, projectName, onConfigChange, onProjectDeleted, onProjectRenamed });

  const config = configLookup?.config ?? {};

  const sandbox: Partial<SandboxSecuritySettings> = config.sandbox ?? {};
  const sb = { ...DEFAULT_SANDBOX_SETTINGS, ...(appSettings?.sandbox ?? {}), ...sandbox };
  const runOnHost = config.runOnHost ?? appSettings?.runOnHost ?? false;
  const memory = config.memory ?? {};
  const kanban = config.kanban ?? {};
  const appWorktreeAutoCreate = appSettings?.worktree?.autoCreate ?? DEFAULT_WORKTREE_SETTINGS.autoCreate;
  const appPruneOnStop = appSettings?.worktree?.pruneOnStop ?? DEFAULT_WORKTREE_SETTINGS.pruneOnStop;
  const appPruneIdleHours = appSettings?.containers?.pruneIdleHours ?? DEFAULT_CONTAINER_PRUNE_SETTINGS.idleHours;
  const appPruneMaxAgeDays = appSettings?.containers?.pruneMaxAgeDays ?? DEFAULT_CONTAINER_PRUNE_SETTINGS.maxAgeDays;

  return (
    <div className="flex flex-row flex-1 overflow-hidden text-sm">
      <ProjectSettingsNav activeSection={section} onSectionChange={setSection} />

      {/* Content pane */}
      <ScrollArea key={section} className="flex-1 animate-in fade-in-0 duration-150">
        <div className="px-8 py-6 space-y-6">
          {section === 'general' && (
            <GeneralSection
              name={name}
              setName={setName}
              subdir={subdir}
              setSubdir={setSubdir}
              onSubdirSave={() => void handleSubdirSave()}
              projectPath={projectPath}
              onSave={() => void handleRenameSave()}
            />
          )}
          {section === 'keys' && (
            <KeysSection
              apiKeys={config.apiKeys ?? {}}
              appKeys={
                appSettings
                  ? {
                      anthropic: appSettings.apiKeys?.anthropic,
                      openai: appSettings.apiKeys?.openai,
                      google: appSettings.apiKeys?.google,
                      voyage: appSettings.apiKeys?.voyage,
                      mistral: appSettings.apiKeys?.mistral,
                      githubToken: appSettings.apiKeys?.github,
                      tailscaleAuthKey: appSettings.tailscale?.authKey,
                      tailscaleFunnel: appSettings.tailscale?.funnel,
                    }
                  : undefined
              }
              savingKey={savingKey}
              onPatch={(patch) => void updateConfig('apiKeys', patch as Record<string, unknown>)}
            />
          )}
          {section === 'agents' && (
            <AgentsSection
              agents={config.agents ?? {}}
              appSettings={appSettings}
              savingKey={savingKey}
              onAgentsPatch={(patch) => void updateConfig('agents', patch as Record<string, unknown>)}
            />
          )}
          {section === 'sandbox' && (
            <SandboxSection
              sb={sb}
              runOnHost={runOnHost}
              savingKey={savingKey}
              onPatch={(patch) => void updateConfig('sandbox', { ...sb, ...patch })}
              onRunOnHostChange={(v) => void updateConfig('runOnHost', { _value: v })}
            />
          )}
          {section === 'env' && (
            <EnvSection
              safelist={config.env?.safelist ?? []}
              appSafelist={appSettings?.env?.safelist ?? []}
              vars={config.env?.vars ?? {}}
              appVars={appSettings?.env?.vars ?? {}}
              savingKey={savingKey}
              onChange={(safelist) => void updateConfig('env', { safelist })}
              onVarsChange={(vars) => void updateConfig('env', { vars })}
            />
          )}
          {section === 'containers' && (
            <ContainersSection
              worktree={config.worktree ?? {}}
              containers={config.containers ?? {}}
              appAutoCreate={appWorktreeAutoCreate}
              appPruneOnStop={appPruneOnStop}
              appPruneIdleHours={appPruneIdleHours}
              appPruneMaxAgeDays={appPruneMaxAgeDays}
              projectPath={projectPath}
              savingKey={savingKey}
              onWorktreePatch={(patch) => void updateConfig('worktree', patch as Record<string, unknown>)}
              onContainersPatch={(patch) => void updateConfig('containers', patch as Record<string, unknown>)}
            />
          )}
          {section === 'memory' && (
            <MemorySection
              memory={memory}
              appSettings={appSettings}
              savingKey={savingKey}
              onPatch={(patch) => void updateConfig('memory', patch as Record<string, unknown>)}
            />
          )}
          {section === 'code' && (
            <CodeSection
              memory={memory}
              appSettings={appSettings}
              savingKey={savingKey}
              onPatch={(patch) => void updateConfig('memory', patch as Record<string, unknown>)}
            />
          )}
          {FEATURES.KANBAN && section === 'kanban' && (
            <KanbanSection
              projectId={savedProject?.id ?? ''}
              kanban={kanban}
              savingKey={savingKey}
              onPatch={(patch) => void updateConfig('kanban', patch as Record<string, unknown>)}
            />
          )}
          {section === 'autopilot' && (
            <AutopilotSection
              agents={config.agents ?? {}}
              appSettings={appSettings}
              savingKey={savingKey}
              onAgentsPatch={(patch) => void updateConfig('agents', patch as Record<string, unknown>)}
            />
          )}
          {section === 'personality' && (
            <PersonalitySection
              projectId={savedProject?.id ?? ''}
              personality={config.personality}
              savingKey={savingKey}
              // _value sentinel: replaces the whole field (null = delete key, object = set directly)
              onPatch={(patch) =>
                void updateConfig('personality', patch === undefined ? { _value: null } : { _value: patch })
              }
            />
          )}
          {FEATURES.MEETINGS && section === 'recording' && (
            <RecordingSection
              recording={config.recording}
              savingKey={savingKey}
              onPatch={(patch) =>
                void updateConfig('recording', patch === undefined ? { _value: null } : { _value: patch })
              }
            />
          )}
          {section === 'danger' && (
            <DangerSection
              savedProject={savedProject}
              deleting={deleting}
              onDeleteClick={() => setConfirmDelete(true)}
            />
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project?"
        description={`"${projectName}" will be removed from AgentOS. Your files on disk won't be touched.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false);
          void handleDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
