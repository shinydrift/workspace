import { useEffect, useMemo, useState } from 'react';
import { type SavedProject } from '../../shared/types';
import { getBaseName } from '@/lib/utils';
import { useThreadComposer } from './useThreadComposer';
import { useDomainStore } from '../store/domainStore';
import { useUIStore } from '../store/uiStore';

export function useThreadForm(onClose: () => void) {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pendingProjectPath, setPendingProjectPath] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [projectNameTouched, setProjectNameTouched] = useState(false);

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
    creating,
    setCreating,
    error,
    setError,
    matchedProject,
  } = useThreadComposer(projects);

  const { upsertThread } = useDomainStore();
  const { setSelectedThread } = useUIStore();

  useEffect(() => {
    window.electronAPI.project
      .list()
      .then((list) => {
        setProjects(list);
        if (list.length > 0) {
          setPendingProjectPath(list[0].path);
          setShowProjectPicker(true);
        } else {
          setShowProjectPicker(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to load projects', err);
      });
  }, []);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const haystack = `${p.name} ${p.path}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, projectSearch]);

  useEffect(() => {
    const dir = workingDir.trim();
    if (!dir) {
      if (selectedProjectPath) setSelectedProjectPath('');
      return;
    }
    const existing = projects.find((p) => p.path === dir);
    if (!existing) {
      if (selectedProjectPath) setSelectedProjectPath('');
      return;
    }
    if (selectedProjectPath !== existing.path) {
      setSelectedProjectPath(existing.path);
    }
    if (!projectNameTouched) {
      setProjectName(existing.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDir, projects, selectedProjectPath, projectNameTouched]);

  async function pickDir() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) {
      clearProviderTouch();
      setWorkingDir(dir);
      const existing = projects.find((p) => p.path === dir);
      setSelectedProjectPath(existing?.path ?? '');
      if (existing) {
        setProjectName(existing.name);
        setProjectNameTouched(false);
      }
    }
  }

  function onProjectSelect(pathValue: string) {
    clearProviderTouch();
    setSelectedProjectPath(pathValue);
    if (!pathValue) return;
    const project = projects.find((p) => p.path === pathValue);
    if (!project) return;
    setWorkingDir(project.path);
    setProjectName(project.name);
    setProjectNameTouched(false);
  }

  function startNewProject() {
    clearProviderTouch();
    setSelectedProjectPath('');
    setWorkingDir('');
    setProjectName('');
    setProjectNameTouched(false);
    setError('');
    setProjectSearch('');
    setShowProjectPicker(false);
  }

  function continueWithSelectedProject() {
    if (!pendingProjectPath) return;
    onProjectSelect(pendingProjectPath);
    setShowProjectPicker(false);
  }

  async function submit() {
    if (!workingDir) {
      setError('Working directory is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const threadName = projectName.trim() || matchedProject?.name || getBaseName(workingDir) || 'Untitled';
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
      setSelectedThread(thread.id);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  return {
    projects,
    showProjectPicker,
    setShowProjectPicker,
    pendingProjectPath,
    setPendingProjectPath,
    projectSearch,
    setProjectSearch,
    selectedProjectPath,
    projectNameTouched,
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
    onProjectSelect,
    startNewProject,
    continueWithSelectedProject,
    submit,
  };
}
