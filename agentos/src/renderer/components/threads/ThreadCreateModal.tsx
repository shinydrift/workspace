import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useThreadForm } from '../../hooks/useThreadForm';
import { ToggleRow } from '@/components/ui/toggle-row';
import { ProviderModelBadges } from './ProviderModelBadges';
import { ProjectPickerStep } from './ProjectPickerStep';

interface Props {
  onClose: () => void;
}

export function ThreadCreateModal({ onClose }: Props) {
  const {
    projects,
    showProjectPicker,
    setShowProjectPicker,
    pendingProjectPath,
    setPendingProjectPath,
    projectSearch,
    setProjectSearch,
    selectedProjectPath,
    setProjectNameTouched,
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
    runOnHost,
    setRunOnHostSelection,
    sandboxEnabled,
    creating,
    error,
    matchedProject,
    filteredProjects,
    pickDir,
    startNewProject,
    continueWithSelectedProject,
    submit,
  } = useThreadForm(onClose);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>New Thread</DialogTitle>
          <DialogDescription className="sr-only">Create a new Claude Code thread</DialogDescription>
        </DialogHeader>

        {showProjectPicker ? (
          <ProjectPickerStep
            filteredProjects={filteredProjects}
            pendingProjectPath={pendingProjectPath}
            projectSearch={projectSearch}
            onSearchChange={setProjectSearch}
            onSelectPath={setPendingProjectPath}
            onStartNew={startNewProject}
            onContinue={continueWithSelectedProject}
            onClose={onClose}
          />
        ) : (
          <>
            {projects.length > 0 && (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                <span className="text-xs text-muted-foreground truncate">
                  {selectedProjectPath
                    ? `Using saved project: ${projectName || selectedProjectPath}`
                    : 'Creating a new project'}
                </span>
                <Button onClick={() => setShowProjectPicker(true)} variant="ghost" size="sm" type="button">
                  Change
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Project name (optional)</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(e) => {
                  setProjectNameTouched(true);
                  setProjectName(e.target.value);
                }}
                placeholder={matchedProject?.name ?? 'e.g. payments-api'}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="thread-dir">Working directory</Label>
              <div className="flex gap-2">
                <Input
                  id="thread-dir"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1"
                  autoFocus={projects.length === 0}
                />
                <Button onClick={pickDir} variant="outline" size="sm">
                  Browse
                </Button>
              </div>
              {matchedProject ? (
                <p className="text-xs text-muted-foreground">
                  Workspace matched saved project "{matchedProject.name}" from persistence.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  If this workspace is already saved, project details are pulled from persistence.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Provider
              </span>
              <ProviderModelBadges
                provider={provider}
                model={model}
                effort={effort}
                reasoning={reasoning}
                onProviderChange={(p) => {
                  setProviderSelection(p);
                }}
                onModelChange={setModelSelection}
                onEffortChange={setEffort}
                onReasoningChange={setReasoning}
              />
            </div>

            {sandboxEnabled && (
              <ToggleRow
                label="Sandbox"
                description="Run this thread in a Docker sandbox. Turn off to run directly on the host for this thread only."
                checked={!runOnHost}
                onCheckedChange={(v) => setRunOnHostSelection(!v)}
              />
            )}

            {error && <p className="text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
              <Button onClick={onClose} variant="outline">
                Cancel
              </Button>
              <Button onClick={submit} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
