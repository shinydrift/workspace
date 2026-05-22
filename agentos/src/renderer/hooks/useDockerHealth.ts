import { useEffect, useState } from 'react';
import type { HealthCheck } from '../../shared/types';

export function useDockerHealth() {
  const [showDockerPrompt, setShowDockerPrompt] = useState(false);
  const [dockerChecking, setDockerChecking] = useState(false);
  const [dockerActionBusy, setDockerActionBusy] = useState(false);
  const [dockerError, setDockerError] = useState('');
  const [healthStatus, setHealthStatus] = useState<HealthCheck['status'] | null>(null);

  useEffect(() => {
    window.electronAPI?.health
      .run()
      .then((report) => {
        const hasError = report.checks.some((c) => c.status === 'error');
        const hasWarn = report.checks.some((c) => c.status === 'warn');
        setHealthStatus(hasError ? 'error' : hasWarn ? 'warn' : 'ok');
      })
      .catch(() => {
        // silently ignore — health is non-critical at startup
      });
  }, []);

  useEffect(() => {
    if (window.electronAPI?.platform !== 'darwin') return;

    let cancelled = false;
    async function checkDockerAtStartup() {
      setDockerChecking(true);
      try {
        const result = await window.electronAPI?.sandbox.checkDocker();
        if (cancelled || !result) return;
        setShowDockerPrompt(!result.available);
        if (result.available) setDockerError('');
      } catch (error) {
        if (cancelled) return;
        setShowDockerPrompt(true);
        setDockerError(error instanceof Error ? error.message : 'Unable to verify Docker Desktop status.');
      } finally {
        if (!cancelled) setDockerChecking(false);
      }
    }

    void checkDockerAtStartup();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDockerRecheck() {
    if (!window.electronAPI) return;
    setDockerChecking(true);
    setDockerError('');
    try {
      const result = await window.electronAPI.sandbox.checkDocker();
      if (result.available) {
        setShowDockerPrompt(false);
        return;
      }
      setShowDockerPrompt(true);
      setDockerError('Docker Desktop is still unavailable. Finish starting it, then recheck again.');
    } catch (error) {
      setDockerError(error instanceof Error ? error.message : 'Unable to verify Docker Desktop status.');
    } finally {
      setDockerChecking(false);
    }
  }

  async function handleOpenDocker() {
    if (!window.electronAPI) return;
    setDockerActionBusy(true);
    setDockerError('');
    try {
      await window.electronAPI.sandbox.openDocker();
    } catch (error) {
      setDockerError(error instanceof Error ? error.message : 'Unable to open Docker Desktop.');
    } finally {
      setDockerActionBusy(false);
    }
  }

  return {
    showDockerPrompt,
    dockerChecking,
    dockerActionBusy,
    dockerError,
    healthStatus,
    handleDockerRecheck,
    handleOpenDocker,
  };
}
