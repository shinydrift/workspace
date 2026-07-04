import { useEffect, useRef } from 'react';
import type { AppLogEntry } from '../../shared/types';
import { useDomainStore } from '../store/domainStore';
import { useUIStore } from '../store/uiStore';
import { useLogsStore } from '../store/logsStore';

export function useAppSync() {
  const {
    setThreads,
    updateThreadStatus,
    renameThread,
    setAutomations,
    upsertThread,
    removeThread,
    setProjects,
    upsertProject,
    removeProject,
  } = useDomainStore();
  const { setSandboxBuildProgress, setMemoryIndexProgress, setDevMode, setEditor } = useUIStore();
  const { setLogs, addLogs } = useLogsStore();

  const ttsEnabledRef = useRef(false);
  const pendingLogsRef = useRef<AppLogEntry[]>([]);
  const logFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.thread.list().then(setThreads);
    window.electronAPI.log.getHistory().then(setLogs);
    window.electronAPI.automation.list().then(setAutomations);
    window.electronAPI.project.list().then(setProjects);

    window.electronAPI.settings
      .get()
      .then((s) => {
        ttsEnabledRef.current = Boolean(s.voice?.ttsEnabled);
        setDevMode(Boolean(s.devMode));
        setEditor(s.editor ?? null);
      })
      .catch((err) => {
        console.warn('Failed to load settings', err);
      });

    const unsubStatus = window.electronAPI.on.threadStatus((event) => {
      const extra = {
        provider: event.provider,
        pid: event.pid,
        exitCode: event.exitCode,
        queueDepth: event.queueDepth,
        ...(event.autopilotEnabled !== undefined ? { autopilotEnabled: event.autopilotEnabled } : {}),
        ...(event.autopilotState !== undefined ? { autopilotState: event.autopilotState } : {}),
        ...(event.autopilotLastReason !== undefined ? { autopilotLastReason: event.autopilotLastReason } : {}),
        ...(event.autopilotConsecutiveTurns !== undefined
          ? { autopilotConsecutiveTurns: event.autopilotConsecutiveTurns }
          : {}),
        ...(event.reaction !== undefined ? { currentReaction: event.reaction } : {}),
        sessionStartedAt: event.sessionStartedAt,
      };
      updateThreadStatus(event.threadId, event.status, {
        ...extra,
      });
    });

    let sandboxProgressTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubSandbox = window.electronAPI.on.sandboxImageBuilding(({ progress }) => {
      setSandboxBuildProgress(progress);
      if (sandboxProgressTimer) clearTimeout(sandboxProgressTimer);
      sandboxProgressTimer = setTimeout(() => setSandboxBuildProgress(null), 3000);
    });

    let memoryIndexTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubMemoryIndex = window.electronAPI.on.memoryIndexStatus(({ phase, state }) => {
      if (state === 'started') {
        if (memoryIndexTimer) clearTimeout(memoryIndexTimer);
        setMemoryIndexProgress(phase === 'memory' ? 'Indexing memory…' : 'Indexing code…');
      } else {
        if (memoryIndexTimer) clearTimeout(memoryIndexTimer);
        memoryIndexTimer = setTimeout(() => setMemoryIndexProgress(null), 2000);
      }
    });

    const flushLogs = () => {
      if (pendingLogsRef.current.length === 0) return;
      addLogs(pendingLogsRef.current);
      pendingLogsRef.current = [];
      logFlushTimerRef.current = null;
    };
    const unsubLogs = window.electronAPI.on.logEntry((entry) => {
      pendingLogsRef.current.push(entry);
      if (!logFlushTimerRef.current) {
        logFlushTimerRef.current = setTimeout(flushLogs, 100);
      }
    });

    const unsubRenamed = window.electronAPI.on.threadRenamed((event) => {
      renameThread(event.threadId, event.name);
    });

    const unsubCreated = window.electronAPI.on.threadCreated((thread) => {
      upsertThread(thread);
    });

    const unsubDeleted = window.electronAPI.on.threadDeleted(({ threadId }) => {
      removeThread(threadId);
    });

    const unsubSettings = window.electronAPI.on.settingsChanged((settings) => {
      ttsEnabledRef.current = Boolean(settings.voice?.ttsEnabled);
      setDevMode(Boolean(settings.devMode));
      setEditor(settings.editor ?? null);
    });

    const unsubProjectSaved = window.electronAPI.on.projectSaved((project) => {
      upsertProject(project);
    });

    const unsubProjectDeleted = window.electronAPI.on.projectDeleted(({ projectId }) => {
      removeProject(projectId);
    });

    const unsubTts = window.electronAPI.on.messageAppended((event) => {
      if (!ttsEnabledRef.current) return;
      if (event.message.role !== 'assistant') return;
      // content is raw text; normalized.blocks may have structured text blocks
      const normalized = event.message.normalized;
      const text = normalized
        ? normalized.blocks
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join(' ')
            .trim()
        : event.message.content.trim();
      if (text)
        window.electronAPI.audio.playTTS(text).catch((err) => {
          console.warn('TTS playback failed', err);
        });
    });

    return () => {
      if (sandboxProgressTimer) clearTimeout(sandboxProgressTimer);
      if (memoryIndexTimer) clearTimeout(memoryIndexTimer);
      if (logFlushTimerRef.current) {
        clearTimeout(logFlushTimerRef.current);
        flushLogs();
      }
      unsubStatus();
      unsubSandbox();
      unsubMemoryIndex();
      unsubLogs();
      unsubRenamed();
      unsubCreated();
      unsubDeleted();
      unsubSettings();
      unsubProjectSaved();
      unsubProjectDeleted();
      unsubTts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
