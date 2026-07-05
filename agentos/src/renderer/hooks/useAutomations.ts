import { useEffect, useState } from 'react';
import type { AutomationCreateRequest, AutomationJob, SavedProject } from '../../shared/types';
import { type FormState, EMPTY_FORM, fromJob, toTrigger } from '../components/automations/scheduleUtils';
import { useAsyncOp } from './useAsyncOp';

export function useAutomations(open: boolean, jobs: AutomationJob[], onJobsChange: (jobs: AutomationJob[]) => void) {
  const listOp = useAsyncOp();
  const saveOp = useAsyncOp();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);

  useEffect(() => {
    window.electronAPI.project
      .list()
      .then(setProjects)
      .catch((err) => {
        console.warn('Failed to load projects', err);
      });
  }, []);

  async function fetchJobs() {
    const list = await window.electronAPI.automation.list();
    onJobsChange(list);
  }

  useEffect(() => {
    if (!open) return;
    listOp.run(fetchJobs).catch((err) => {
      console.warn('Failed to refresh automations', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (!editing) return;

    if (!editing.name.trim()) {
      saveOp.setError('Name is required');
      return;
    }
    if (!editing.projectId) {
      saveOp.setError('Project is required');
      return;
    }
    if (!editing.instructions.trim()) {
      saveOp.setError('Instructions are required');
      return;
    }
    await saveOp.run(async () => {
      const payload: AutomationCreateRequest = {
        name: editing.name.trim(),
        description: editing.description.trim() || undefined,
        projectId: editing.projectId,
        trigger: toTrigger(editing),
        instructions: editing.instructions.trim(),
        provider: editing.provider,
        model: editing.model,
        effort: editing.effort,
        reasoning: editing.reasoning,
        notification:
          editing.notificationChannel !== 'none'
            ? {
                channel: editing.notificationChannel as 'slack',
                onFailure: editing.notifyOnFailure,
                ...(editing.notificationChannel === 'slack' && editing.notificationSlackChannelId
                  ? { slackChannelId: editing.notificationSlackChannelId }
                  : {}),
              }
            : undefined,
        enabled: editing.enabled,
        deleteAfterRun: editing.deleteAfterRun,
      };
      if (editing.id) {
        await window.electronAPI.automation.update({ id: editing.id, patch: payload });
      } else {
        const job = await window.electronAPI.automation.create(payload);
        setEditing((prev) => (prev ? { ...prev, id: job.id } : prev));
      }
      await fetchJobs();
    });
  }

  async function runNow(job: AutomationJob) {
    await listOp.run(async () => {
      const result = await window.electronAPI.automation.run(job.id);
      if (!result.ok) throw new Error(result.error ?? 'Run failed');
      await fetchJobs();
    });
  }

  async function remove(job: AutomationJob) {
    await listOp.run(async () => {
      await window.electronAPI.automation.delete(job.id);
      await fetchJobs();
    });
  }

  function startNew() {
    listOp.setError(null);
    saveOp.setError(null);
    setEditing({
      ...EMPTY_FORM,
      projectId: projects[0]?.id ?? '',
    });
  }

  return {
    listOp,
    saveOp,
    editing,
    setEditing,
    projects,
    save,
    runNow,
    remove,
    startNew,
    fromJob,
  };
}
