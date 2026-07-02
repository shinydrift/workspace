import { app, BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron';
import path from 'path';
import { internalBus } from '../events';
import { threadManager } from '../sessions/ThreadManager';
import { setThreadRunner, councilService } from '../council/service';
import { createCouncilThreadRunner } from '../council/threadRunner';
import { councilMcpServer } from '../integrations/councilMcpServer';
import { autopilotMcpServer } from '../integrations/autopilotMcpServer';
import { eventLogger, initEventLog } from '../utils/eventLog';
import { ensureBundledClaudeSkills } from '../utils/claudePlugins';
import { automationService } from '../automations/service';
import { slackBridge } from '../integrations/slackBridge';
import { validateSlackUploadPath } from '../integrations/slackUploadWorkspace';
import { memoryMcpServer } from '../integrations/memoryMcpServer';
import { threadMcpServer } from '../integrations/threadMcpServer';
import { threadPostsStore } from '../sessions/threadPostsStore';
import { FEATURES } from '../../shared/features';
import { initVoiceFlowHotkey, stopVoiceFlowHotkey } from '../audio/voiceFlowHotkey';
import { meetingDetector } from '../meetings/meetingDetector';
import { kanbanMcpServer } from '../kanban/mcpServer';
import { recordingsMcpServer } from '../integrations/recordingsMcpServer';
import { startSegmentRetention, stopSegmentRetention } from '../audio/segmentRetention';
import { kanbanEventRouter } from '../kanban/eventRouter';
import { reconcileOrphanedTasks } from '../kanban/taskMain';
import { startKanbanArchiver } from '../kanban/archiver';
import { isTerminalStatus } from '../kanban/db';
import { kanbanService } from '../kanban/service';
import { agentOSMemoryService } from '../memory/service';
import { analyticsService } from '../analytics/service';
import { initAnalyticsDbDir } from '../analytics/db';
import { initCouncilDbDir } from '../council/councilDb';
import { initProjectsDbDir, getProject, getRecording, setRecordingTitle } from '../threads/db';
import { getThreadsByProject } from '../threads/threadStore';
import { getStore, setSettings, settingsEvents } from '../store/index';
import { setLocalhostAuthBypass } from '../mcp/mcpAuth';
import { TrayManager } from '../tray/trayManager';
import { registerTrayUpdateHook } from '../sessions/broadcaster';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { loadProjectConfig, updateProjectConfig } from '../config/projectConfig';
import { reconcilePersonalityRefresh } from '../personality/automation';
import { installPerfTraceInstrumentation } from '../utils/perfTrace';
import { initProviderRateLimitRefresh } from '../analytics/providerRateLimitRefresh';
import { createRecordingOverlay, createShutdownOverlay } from './windows';
import type { Disposable } from '../lifecycle';

export interface Services {
  mainWindow: BrowserWindow;
  recordingOverlay: BrowserWindow | null;
  shutdownOverlay: BrowserWindow;
  trayManager: TrayManager;
  disposables: Disposable[];
}

function safeInit(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        eventLogger.error('boot', `Failed to initialize ${name} — continuing without it`, {
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      });
    }
  } catch (err) {
    eventLogger.error('boot', `Failed to initialize ${name} — continuing without it`, {
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
}

function resolveProjectPath(threadId: string): string {
  const thread = threadManager.getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);
  return thread.projectPath ?? thread.workingDirectory;
}

function buildSlackConfig(): Parameters<typeof slackBridge.init>[0] {
  return {
    createThread: (req) => threadManager.createThread(req),
    sendInput: (threadId, input, source, options) => threadManager.sendInput(threadId, input, source, options),
    getThreadName: (threadId) => threadManager.getThread(threadId)?.name ?? null,
    getThreadWorkingDirectory: (threadId) => threadManager.getThread(threadId)?.workingDirectory ?? null,
    setSlackContext: (threadId, ctx) => threadManager.setSlackContext(threadId, ctx),
    setAutopilot: (threadId, enabled, options) => threadManager.setThreadAutopilot(threadId, enabled, options),
  };
}

function buildThreadMcpConfig(): Parameters<typeof threadMcpServer.init>[0] {
  return {
    setAutopilot: (threadId, enabled) => threadManager.setThreadAutopilot(threadId, enabled),
    updatePersonality: async (threadId, patch) => {
      const projectPath = resolveProjectPath(threadId);
      const { config } = await loadProjectConfig(projectPath);
      const existing = config?.personality;

      const enriched = { ...patch };

      // EMA smoothing: blend incoming bigFive with prior (0.6 new / 0.4 old) to reduce oscillation.
      if (enriched.bigFive && existing?.bigFive) {
        const prev = existing.bigFive;
        const next = enriched.bigFive;
        const blend = (n: number, p: number) => Math.min(5, Math.max(1, Math.round(0.6 * n + 0.4 * p)));
        enriched.bigFive = {
          openness: blend(next.openness, prev.openness),
          conscientiousness: blend(next.conscientiousness, prev.conscientiousness),
          extraversion: blend(next.extraversion, prev.extraversion),
          agreeableness: blend(next.agreeableness, prev.agreeableness),
          neuroticism: blend(next.neuroticism, prev.neuroticism),
        };
      }

      // Push a history snapshot before overwriting (max 3, newest first).
      if (existing?.generatedAt) {
        const snapshot = {
          agentStyle: existing.agentStyle,
          autopilotInstructions: existing.autopilotInstructions,
          bigFive: existing.bigFive,
          generatedAt: existing.generatedAt,
          messageCount: existing.messageCount,
        };
        const prior = existing.history ?? [];
        enriched.history = [snapshot, ...prior].slice(0, 3);
      }

      await updateProjectConfig(projectPath, 'personality', enriched as Record<string, unknown>);
    },
    setPersonalityOverride: (threadId, override) => threadManager.setPersonalityOverride(threadId, override),
    getAppSettings: () => getStore().get('settings'),
    updateAppSettings: (patch) => setSettings(patch),
    getProjectConfig: async (threadId) => {
      const result = await loadProjectConfig(resolveProjectPath(threadId));
      return result.config;
    },
    updateProjectConfig: async (threadId, key, updates) => {
      await updateProjectConfig(resolveProjectPath(threadId), key, updates);
    },
    listProjectMessages: (threadId, { role, limit, sinceMs }) => {
      const thread = threadManager.getThread(threadId);
      if (!thread?.projectId) return [];
      const projectThreadIds = getThreadsByProject(thread.projectId).map((t) => t.id);
      // Pass filters to listMessages so per-thread filtering happens at read time.
      const messages = projectThreadIds.flatMap((tid) => threadManager.listMessages(tid, { sinceMs, role }));
      messages.sort((a, b) => a.timestamp - b.timestamp);
      return messages.slice(-limit).map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }));
    },
    setRecordingTitle: (recordingId, title) => {
      const recording = getRecording(recordingId);
      setRecordingTitle(recordingId, title);
      if (recording?.threadId) threadManager.renameThread(recording.threadId, title);
    },
    testWebhookEvent: (jobId, payload) => automationService.testWebhookEvent(jobId, payload),
    postThreadUpdate: (threadId, kind, text) => {
      threadPostsStore.append(threadId, kind, 'agent', text);
      slackBridge.echoThreadPost(threadId, text);
    },
    uploadThreadFile: async (threadId, filePath, filename, comment) => {
      const hostWorkingDir = threadManager.getThread(threadId)?.workingDirectory ?? null;
      if (!hostWorkingDir) throw new Error(`No working directory bound to thread ${threadId}`);
      // Validates the sandbox prefix, ensures the host uploads dir exists, then realpath-checks
      // containment so `..`/symlink escapes outside `.agentos/uploads/` are rejected.
      const resolved = await validateSlackUploadPath(filePath, hostWorkingDir);
      const name = filename ?? path.basename(resolved);
      threadPostsStore.append(threadId, 'file', 'agent', comment ?? name, { filename: name, path: resolved });
      await slackBridge.echoUploadFile(threadId, resolved, name, comment);
      return 'File uploaded.';
    },
  };
}

function buildKanbanConfig(): Parameters<typeof kanbanEventRouter.init>[0] {
  return {
    sendInput: (threadId, input, source) =>
      threadManager.sendInput(threadId, input, source as Parameters<typeof threadManager.sendInput>[2]),
    saveToMemory: (projectId, task) => {
      const notes = kanbanService
        .getNotes(projectId, task.id)
        .map((n) => n.content)
        .join('\n\n---\n\n');
      return agentOSMemoryService
        .save({
          projectId,
          path: `memory/research-${task.id}.md`,
          content: `# ${task.title}\n\n${notes}`,
          mode: 'overwrite',
        })
        .then(async (): Promise<void> => {
          try {
            await agentOSMemoryService.linkEntities({
              projectId,
              entities: [
                {
                  name: task.title,
                  type: 'concept',
                  observation: `Research report saved to memory/research-${task.id}.md`,
                },
              ],
            });
          } catch {
            // non-fatal — graph linking failure should not fail the report save
          }
        });
    },
  };
}

export function bootServices(
  mainWindow: BrowserWindow,
  opts: { homeDir: string; preloadPath: string; rendererBase: string }
): Services {
  const { homeDir, preloadPath, rendererBase } = opts;
  const disposables: Disposable[] = [];

  // ── Phase 0: infrastructure (sync) ───────────────────────────────────────
  initEventLog(app.getPath('userData'));
  installPerfTraceInstrumentation();
  initProjectsDbDir(homeDir);
  initAnalyticsDbDir(homeDir);
  initCouncilDbDir(homeDir);
  agentOSMemoryService.configure(homeDir);
  const bundledSkillsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bundled-skills')
    : path.join(app.getAppPath(), 'resources', 'bundled-skills');
  ensureBundledClaudeSkills(homeDir, bundledSkillsDir).catch((error: unknown) => {
    eventLogger.warn('skills', 'Failed to initialize bundled Claude skills', { error: getErrorMessage(error) });
  });

  // ── Phase 1: core services (sync) ────────────────────────────────────────
  threadManager.loadFromStore();
  setThreadRunner(
    createCouncilThreadRunner({
      spawnChildThread: (childOpts) => threadManager.spawnCouncilChildThread(childOpts),
    })
  );
  councilService.rearmTimers();

  // ── Phase 2: optional services (sync, safeInit-wrapped) ──────────────────
  setLocalhostAuthBypass(!getStore().get('settings').mcpRequireAuth);
  const onSettingsChange = (s: { mcpRequireAuth?: boolean }): void => setLocalhostAuthBypass(!s.mcpRequireAuth);
  settingsEvents.on('change', onSettingsChange);
  disposables.push({
    dispose: () => {
      settingsEvents.off('change', onSettingsChange);
    },
  });

  safeInit('council-mcp', () => councilMcpServer.start());
  safeInit('autopilot-mcp', () => autopilotMcpServer.start());
  safeInit('recordings-mcp', () => recordingsMcpServer.start());
  safeInit('segment-retention', () => startSegmentRetention());

  safeInit('slack', () => {
    slackBridge.init(buildSlackConfig());
    slackBridge.applySettings(getStore().get('settings'));
  });

  safeInit('mcp-memory', () => memoryMcpServer.start());

  safeInit('thread-mcp', () => {
    threadMcpServer.init(buildThreadMcpConfig());
    threadMcpServer.start();
  });

  if (FEATURES.KANBAN) {
    safeInit('kanban', () => {
      kanbanMcpServer.start();
      kanbanEventRouter.init(buildKanbanConfig());
      void reconcileOrphanedTasks().catch((err: unknown) => {
        eventLogger.warn('kanban', 'Startup task reconciliation failed', { error: getErrorMessage(err) });
      });
      disposables.push({ dispose: startKanbanArchiver() });
      threadManager.setKanbanWatchdog((taskId, projectId, reason) => {
        try {
          const task = kanbanService.get(projectId, taskId);
          if (!task) return;
          if (isTerminalStatus(task.status)) return;
          // Record the autopilot failure as a note without reverting the stage —
          // silently rewinding to an earlier stage destroys in-flight work.
          kanbanService.addNote(projectId, taskId, `Autopilot blocked on ${task.status}: ${reason}`);
        } catch (err) {
          const msg = getErrorMessage(err);
          if (!msg.includes('not found')) {
            eventLogger.warn('kanban-watchdog', 'Failed to record autopilot-blocked note', {
              taskId,
              projectId,
              error: msg,
            });
          }
        }
      });
    });
  }

  safeInit('automation', async () => {
    await automationService.init(homeDir);
    await automationService.start();
    // Reconcile hidden personality-refresh jobs after the service is running.
    // Detached so startup isn't blocked; per-project errors are isolated inside.
    void reconcilePersonalityRefresh();
  });
  // Deferred 30s — container cleanup is non-critical and slows perceived startup.
  setTimeout(() => {
    threadManager.pruneContainers().catch((error: unknown) => {
      eventLogger.warn('docker', 'Startup container prune failed', { error: getErrorMessage(error) });
    });
  }, 30_000);

  if (FEATURES.VOICE_FLOW) {
    safeInit('voice', () => initVoiceFlowHotkey(() => mainWindow));
  }
  if (FEATURES.MEETINGS) {
    safeInit('meetings', () => meetingDetector.start(mainWindow));
  }

  // ── Phase 3: deferred after renderer is interactive ───────────────────────
  let phase3Initialized = false;
  const runPhase3 = (): void => {
    if (phase3Initialized) return;
    phase3Initialized = true;
    // Order is significant: loadFromStoreLate does FS/git work;
    // analytics init follows so it sees accurate thread state.
    threadManager.loadFromStoreLate().catch((error: unknown) => {
      eventLogger.error('boot', 'loadFromStoreLate failed', { error: getErrorMessage(error) });
    });
    agentOSMemoryService.warmup().catch((err: unknown) => {
      eventLogger.warn('memory', 'Memory warmup failed', { error: getErrorMessage(err) });
    });
    analyticsService.init();
    initProviderRateLimitRefresh(homeDir);
  };
  mainWindow.webContents.once('did-finish-load', runPhase3);
  // Fallback: if the renderer never fires did-finish-load (load error, blank page),
  // Phase 3 still runs so analytics, warmup, and rate-limit refresh are not silently skipped.
  const phase3Fallback = setTimeout(runPhase3, 10_000);
  disposables.push({ dispose: () => clearTimeout(phase3Fallback) });

  // ── Phase 4: UI / tray (sync) ─────────────────────────────────────────────
  let recordingOverlay: BrowserWindow | null = null;
  if (FEATURES.VOICE_FLOW) {
    recordingOverlay = createRecordingOverlay(preloadPath);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      recordingOverlay.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/recording-overlay`);
    } else {
      recordingOverlay.loadFile(path.join(rendererBase, `${MAIN_WINDOW_VITE_NAME}/index.html`), {
        hash: '/recording-overlay',
      });
    }
  }

  const shutdownOverlay = createShutdownOverlay(preloadPath);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    shutdownOverlay.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/shutdown-overlay`);
  } else {
    shutdownOverlay.loadFile(path.join(rendererBase, `${MAIN_WINDOW_VITE_NAME}/index.html`), {
      hash: '/shutdown-overlay',
    });
  }

  const trayManager = new TrayManager(
    mainWindow,
    (projectId) => getProject(projectId)?.name ?? projectId,
    () => threadManager.getThreads(),
    (win) => {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/tray`);
      } else {
        win.loadFile(path.join(rendererBase, `${MAIN_WINDOW_VITE_NAME}/index.html`), { hash: '/tray' });
      }
    },
    preloadPath
  );
  trayManager.init();
  registerTrayUpdateHook(() => trayManager.update());

  // Keep the system awake (not display) so Slack messages are received without blocking screen lock.
  const appWakeBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  disposables.push({
    dispose: () => {
      if (powerSaveBlocker.isStarted(appWakeBlockerId)) powerSaveBlocker.stop(appWakeBlockerId);
    },
  });

  // Dynamic power blocker: prevent system suspend only while turns are actively executing.
  let appSuspensionBlockerId: number | null = null;

  const startSuspensionBlock = (): void => {
    if (appSuspensionBlockerId === null || !powerSaveBlocker.isStarted(appSuspensionBlockerId)) {
      appSuspensionBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  };

  const stopSuspensionBlock = (): void => {
    if (appSuspensionBlockerId !== null && powerSaveBlocker.isStarted(appSuspensionBlockerId)) {
      powerSaveBlocker.stop(appSuspensionBlockerId);
      appSuspensionBlockerId = null;
    }
  };

  internalBus.on('turn:started', startSuspensionBlock);
  internalBus.on('turn:ended', () => {
    if (threadManager.getActiveThreadIds().length === 0) stopSuspensionBlock();
  });

  disposables.push({ dispose: stopSuspensionBlock });

  // Track threads that had active turns when the system suspended so we can recover them.
  let threadsActiveAtSuspend: string[] = [];

  powerMonitor.on('suspend', () => {
    threadsActiveAtSuspend = threadManager.getActiveThreadIds();
    eventLogger.info('power', 'System suspending', { activeThreads: threadsActiveAtSuspend.length });
  });

  powerMonitor.on('resume', () => {
    slackBridge.reconnect();

    // For any thread that was mid-turn at suspend time AND is still actively running
    // at resume, inject a recovery prompt. Skip threads that completed or errored
    // during the suspend to avoid duplicate work or spurious continuation.
    const activeNow = new Set(threadManager.getActiveThreadIds());
    const toRecover = threadsActiveAtSuspend.filter((id) => activeNow.has(id));
    threadsActiveAtSuspend = [];
    for (const threadId of toRecover) {
      threadManager
        .sendInput(threadId, 'The system was suspended mid-turn. Please continue where you left off.', 'automation')
        .catch((err: unknown) => {
          eventLogger.warn('power', 'Failed to send resume recovery message', {
            threadId,
            error: getErrorMessage(err),
          });
        });
    }
  });

  // Registration order = reverse teardown priority (drained with .reverse() in lifecycle.ts).
  if (FEATURES.VOICE_FLOW)
    disposables.push({
      dispose: () => {
        stopVoiceFlowHotkey();
        if (recordingOverlay && !recordingOverlay.isDestroyed()) recordingOverlay.destroy();
      },
    });
  if (FEATURES.MEETINGS) disposables.push({ dispose: () => meetingDetector.stop() });
  disposables.push(automationService);
  if (FEATURES.KANBAN) disposables.push(kanbanMcpServer);
  disposables.push(threadMcpServer);
  disposables.push(memoryMcpServer);
  // Drain background embed work before the app exits — otherwise enqueued
  // chunks_vec writes from in-flight saveChunk calls never land. Then shut
  // down the memory utilityProcess so the WAL closes cleanly.
  disposables.push({
    dispose: async () => {
      try {
        await agentOSMemoryService.flushPending();
      } finally {
        await agentOSMemoryService.shutdown();
      }
    },
  });
  disposables.push(recordingsMcpServer);
  disposables.push({ dispose: () => stopSegmentRetention() });
  disposables.push(councilMcpServer);
  disposables.push(autopilotMcpServer);
  disposables.push(slackBridge);
  disposables.push(trayManager);
  disposables.push(analyticsService);
  disposables.push(threadManager);

  return { mainWindow, recordingOverlay, shutdownOverlay, trayManager, disposables };
}
