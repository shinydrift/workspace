import { useEffect, useRef, useState } from 'react';
import type { SavedProject, ProjectConfigLookup } from '../../shared/types';
import type { SectionId } from '../components/project/ProjectSettingsNav';

interface Options {
  projectPath: string;
  projectName: string;
  onConfigChange: (lookup: ProjectConfigLookup) => void;
  onProjectDeleted: () => void;
  onProjectRenamed: (newName: string) => void;
}

export function useProjectSettingsForm({
  projectPath,
  projectName,
  onConfigChange,
  onProjectDeleted,
  onProjectRenamed,
}: Options) {
  const [section, setSection] = useState<SectionId>('general');
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);

  const [name, setName] = useState(projectName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void window.electronAPI.project.list().then((projects) => {
      if (!mountedRef.current) return;
      const p = projects.find((proj) => proj.path === projectPath) ?? null;
      setSavedProject(p);
    });
  }, [projectPath]);

  useEffect(() => {
    setName(projectName);
  }, [projectName]);

  async function refreshConfig() {
    const updated = await window.electronAPI.project.getConfig(projectPath);
    if (mountedRef.current) onConfigChange(updated);
  }

  async function updateConfig(key: string, updates: Record<string, unknown>) {
    setSavingKey(key);
    try {
      await window.electronAPI.project.updateConfig(projectPath, key, updates);
      await refreshConfig();
    } finally {
      if (mountedRef.current) setSavingKey(null);
    }
  }

  async function handleRenameSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === projectName) return;
    await window.electronAPI.project.save({ path: projectPath, name: trimmed });
    onProjectRenamed(trimmed);
  }

  async function handleDelete() {
    if (!savedProject) return;
    setDeleting(true);
    try {
      await window.electronAPI.project.delete(savedProject.id);
      onProjectDeleted();
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }

  return {
    section,
    setSection,
    savedProject,
    name,
    setName,
    confirmDelete,
    setConfirmDelete,
    deleting,
    savingKey,
    updateConfig,
    handleRenameSave,
    handleDelete,
  };
}
