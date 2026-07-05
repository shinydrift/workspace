import { contextBridge, ipcRenderer } from 'electron';

// Many thread panels can each subscribe; raise the limit to avoid spurious warnings.
ipcRenderer.setMaxListeners(50);
import type {
  TerminalDataEvent,
  ThreadStatusEvent,
  MessageAppendedEvent,
  ThreadPostAppendedEvent,
  ThreadPostUpdatedEvent,
  ThreadRenamedEvent,
  ThreadUnreadEvent,
  Thread,
  AppLogEntry,
  WikiPage,
  TrayThread,
  KanbanTaskMovedEvent,
  RecordingOverlayPayload,
  MemoryIndexStatusEvent,
  ShutdownOverlayPayload,
  PublicSettings,
  SavedProject,
} from '../shared/types';
import type { ClaudeEffort, CodexReasoning } from '../shared/types/provider';
import { IPC_CHANNELS, IPC_EVENTS, TRAY_CHANNELS } from '../shared/types';
import type { IPCChannel, IPCInput, IPCOutput } from '../shared/ipc/registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(res: any): any {
  if (!res.ok) throw new Error(String(res.error ?? 'IPC error'));
  return res.data;
}

// Type-safe IPC invoke — input and output types are enforced by the registry.
// Changing a channel's payload shape in registry.ts causes a type error here.
function invoke<K extends IPCChannel>(
  channel: K,
  ...args: IPCInput<K> extends undefined ? [] : [IPCInput<K>]
): Promise<IPCOutput<K>> {
  return ipcRenderer.invoke(channel, ...args).then(unwrap) as Promise<IPCOutput<K>>;
}

const api = {
  thread: {
    create: (req: IPCInput<'thread:create'>) => invoke('thread:create', req),
    start: (threadId: string) => invoke('thread:start', { threadId }),
    stop: (threadId: string) => invoke('thread:stop', { threadId }),
    delete: (threadId: string) => invoke('thread:delete', { threadId }),
    archive: (threadId: string) => invoke('thread:archive', { threadId }),
    list: () => invoke('thread:list'),
    rename: (threadId: string, name: string) => invoke('thread:rename', { threadId, name }),
    getInjectionStatus: (threadId: string) => invoke('thread:getInjectionStatus', { threadId }),
    setAutopilot: (threadId: string, enabled: boolean) => invoke('thread:setAutopilot', { threadId, enabled }),
    setActive: (threadId: string | null) => invoke('thread:setActive', { threadId }),
    setProviderModel: (
      threadId: string,
      provider: string,
      model?: string,
      effort?: ClaudeEffort,
      reasoning?: CodexReasoning
    ): Promise<Thread> =>
      ipcRenderer
        .invoke(IPC_CHANNELS.THREAD_SET_PROVIDER_MODEL, { threadId, provider, model, effort, reasoning })
        .then(unwrap),
    derivePersonality: (projectId: string) => invoke('thread:derivePersonality', { projectId }),
  },

  memory: {
    status: (threadId: string) => invoke('memory:status', { threadId }),
    reindex: (threadId: string) => invoke('memory:reindex', { threadId }),
    doctor: (threadId: string) => invoke('memory:doctor', { threadId }),
    search: (req: IPCInput<'memory:search'>) => invoke('memory:search', req),
    get: (req: IPCInput<'memory:get'>) => invoke('memory:get', req),
    save: (req: IPCInput<'memory:save'>) => invoke('memory:save', req),
    list: (req: IPCInput<'memory:list'>) => invoke('memory:list', req),
    deleteChunk: (req: IPCInput<'memory:deleteChunk'>) => invoke('memory:deleteChunk', req),
    deleteFile: (req: IPCInput<'memory:deleteFile'>) => invoke('memory:deleteFile', req),
    updateChunk: (req: IPCInput<'memory:updateChunk'>) => invoke('memory:updateChunk', req),
    pinChunk: (req: IPCInput<'memory:pinChunk'>) => invoke('memory:pinChunk', req),
    graphQuery: (req: IPCInput<'memory:graphQuery'>) => invoke('memory:graphQuery', req),
    graphAll: (req: IPCInput<'memory:graphAll'>) => invoke('memory:graphAll', req),
    graphAllPage: (req: IPCInput<'memory:graphAllPage'>) => invoke('memory:graphAllPage', req),
    getEntityChunks: (req: IPCInput<'memory:getEntityChunks'>) => invoke('memory:getEntityChunks', req),
    reindexGraph: (threadId: string) => invoke('memory:reindexGraph', { threadId }),
    getDecayConfig: (threadId: string) => invoke('memory:getDecayConfig', { threadId }),
    setDecayConfig: (req: IPCInput<'memory:setDecayConfig'>) => invoke('memory:setDecayConfig', req),
    healthCheck: (threadId: string) => invoke('memory:healthCheck', { threadId }),
    getThreadChunks: (threadId: string, limit?: number) => invoke('memory:getThreadChunks', { threadId, limit }),
    getProjectStats: (projectId: string) => invoke('memory:getProjectStats', { projectId }),
    getGlobalExpansionCounts: () => invoke('memory:getGlobalExpansionCounts', {}),
    resetEmbeddings: (projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph') =>
      invoke('memory:resetEmbeddings', { projectId, target }),
    deleteData: (projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph') =>
      invoke('memory:deleteData', { projectId, target }),
  },

  terminal: {
    sendInput: (req: IPCInput<'terminal:sendInput'>) => invoke('terminal:sendInput', req),
    resize: (req: IPCInput<'terminal:resize'>) => invoke('terminal:resize', req),
    getHistory: (threadId: string) => invoke('terminal:getHistory', { threadId }),
  },

  settings: {
    get: () => invoke('settings:get'),
    set: (patch: IPCInput<'settings:set'>) => invoke('settings:set', patch),
  },

  project: {
    list: () => invoke('project:list'),
    save: (req: IPCInput<'project:save'>) => invoke('project:save', req),
    delete: (projectId: string) => invoke('project:delete', { projectId }),
    getConfig: (projectPath: string) => invoke('project:getConfig', { projectPath }),
    updateConfig: (projectPath: string, key: string, updates: Record<string, unknown>) =>
      invoke('project:updateConfig', { projectPath, key, updates }),
    initConfig: (projectPath: string) => invoke('project:initConfig', { projectPath }),
    openConfig: (projectPath: string) => invoke('project:openConfig', { projectPath }),
  },

  slack: {
    listChannels: () => invoke('slack:listChannels'),
  },

  automation: {
    list: () => invoke('automation:list'),
    create: (req: IPCInput<'automation:create'>) => invoke('automation:create', req),
    update: (req: IPCInput<'automation:update'>) => invoke('automation:update', req),
    delete: (id: string) => invoke('automation:delete', { id }),
    run: (id: string) => invoke('automation:run', { id }),
    toggle: (id: string, enabled: boolean) => invoke('automation:toggle', { id, enabled }),
  },

  messages: {
    list: (threadId: string) => invoke('messages:list', { threadId }),
    pending: (threadId: string) => invoke('messages:pending', { threadId }),
    clear: (threadId: string) => invoke('messages:clear', { threadId }),
  },

  threadPosts: {
    list: (threadId: string) => invoke('threadPosts:list', { threadId }),
  },

  dialog: {
    openDirectory: () => invoke('dialog:openDirectory'),
  },

  sandbox: {
    listContainers: () => invoke('sandbox:listContainers'),
    pruneContainers: () => invoke('sandbox:pruneContainers'),
    removeContainer: (containerName: string) => invoke('sandbox:removeContainer', { containerName }),
  },

  log: {
    getHistory: () => invoke('log:getHistory'),
  },

  health: {
    run: () => invoke('health:run'),
  },

  audio: {
    modelReady: () => invoke('audio:modelReady'),
    transcribe: (audioBuffer: ArrayBuffer) => invoke('audio:transcribe', audioBuffer),
    playTTS: (text: string) => invoke('audio:playTTS', { text }),
    stopTTS: () => invoke('audio:stopTTS'),
  },

  win: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    focus: () => invoke('window:focus'),
    pasteTranscript: (text: string, targetApp?: string | null) => invoke('window:pasteTranscript', { text, targetApp }),
    broadcastRecordingState: (payload: RecordingOverlayPayload) =>
      ipcRenderer.send(IPC_EVENTS.RECORDING_OVERLAY_STATE, payload),
    cancelRecording: () => ipcRenderer.send(IPC_EVENTS.RECORDING_CANCEL),
    notifyVoiceFlowStopped: () => ipcRenderer.send(IPC_EVENTS.VOICE_FLOW_STOPPED),
  },

  wiki: {
    list: (projectPath: string) => invoke('wiki:list', { projectPath }),
    get: (projectPath: string, pageId: string) => invoke('wiki:get', { projectPath, pageId }),
    save: (projectPath: string, page: WikiPage) => invoke('wiki:save', { projectPath, page }),
    delete: (projectPath: string, pageId: string) => invoke('wiki:delete', { projectPath, pageId }),
  },

  shell: {
    openExternal: (url: string) => invoke('shell:openExternal', { url }),
    openInEditor: (folderPath: string) => invoke('shell:openInEditor', { folderPath }),
    openFolderTarget: (folderPath: string, target: 'vscode' | 'finder' | 'terminal' | 'xcode') =>
      invoke('shell:openFolderTarget', { folderPath, target }),
    openAttachment: (name: string, data: ArrayBuffer) => invoke('shell:openAttachment', { name, data }),
  },

  env: {
    listShellVars: () => invoke('env:listShellVars'),
  },

  app: {
    getInfo: () => invoke('app:getInfo'),
    getUpdateStatus: () => invoke('app:getUpdateStatus'),
    quitAndInstall: () => invoke('app:quitAndInstall'),
  },

  files: {
    upload: (req: IPCInput<'file:upload'>) => invoke('file:upload', req),
    saveTranscript: (req: IPCInput<'transcript:save'>) => invoke('transcript:save', req),
    saveRecording: (req: IPCInput<'recording:save'>) => invoke('recording:save', req),
    setRecordingThread: (req: IPCInput<'recording:setThread'>) => invoke('recording:setThread', req),
    setRecordingTitle: (req: IPCInput<'recording:setTitle'>) => invoke('recording:setTitle', req),
    deleteRecording: (req: IPCInput<'recording:delete'>) => invoke('recording:delete', req),
    readRecording: (req: IPCInput<'recording:read'>) => invoke('recording:read', req),
    listRecordings: () => invoke('recording:list'),
    listSegments: (req: IPCInput<'recording:segments'>) => invoke('recording:segments', req),
  },

  desktopCapturer: {
    getSources: (types: string[]) => invoke('desktop:getSources', { types }),
  },

  analytics: {
    getSessionMetrics: (threadId: string) => invoke('analytics:getSessionMetrics', { threadId }),
    getAutomationRuns: (jobId: string, limit?: number, since?: number) =>
      invoke('analytics:getAutomationRuns', { jobId, limit, since }),
    getTopCostThreads: (projectId: string, limit?: number) =>
      invoke('analytics:getTopCostThreads', { projectId, limit }),
    getToolBreakdown: (threadId: string, since?: number) => invoke('analytics:getToolBreakdown', { threadId, since }),
    getToolInvocations: (threadId: string) => invoke('analytics:getToolInvocations', { threadId }),
    getTurnMetrics: (threadId: string) => invoke('analytics:getTurnMetrics', { threadId }),
    getProjectOverview: (projectId: string) => invoke('analytics:getProjectOverview', { projectId }),
    getGlobalOverview: () => invoke('analytics:getGlobalOverview'),
    getProjectToolBreakdown: (projectId: string) => invoke('analytics:getProjectToolBreakdown', { projectId }),
    getGlobalToolBreakdown: () => invoke('analytics:getGlobalToolBreakdown'),
    getGlobalMemoryGetCount: () => invoke('analytics:getGlobalMemoryGetCount'),
    getProviderRateLimits: () => invoke('analytics:getProviderRateLimits'),
  },

  kanban: {
    list: (projectId: string, status?: IPCInput<'kanban:list'>['status']) =>
      invoke('kanban:list', { projectId, status }),
    get: (projectId: string, taskId: string) => invoke('kanban:get', { projectId, taskId }),
    create: (req: IPCInput<'kanban:create'>) => invoke('kanban:create', req),
    move: (projectId: string, taskId: string, status: IPCInput<'kanban:move'>['status'], reason?: string) =>
      invoke('kanban:move', { projectId, taskId, status, reason }),
    delete: (projectId: string, taskId: string) => invoke('kanban:delete', { projectId, taskId }),
    updateProgress: (projectId: string, taskId: string, progress: number, note?: string) =>
      invoke('kanban:updateProgress', { projectId, taskId, progress, note }),
    assign: (projectId: string, taskId: string, threadId: string) =>
      invoke('kanban:assign', { projectId, taskId, threadId }),
    addNote: (projectId: string, taskId: string, content: string, threadId?: string) =>
      invoke('kanban:addNote', { projectId, taskId, content, threadId }),
    addReview: (
      projectId: string,
      taskId: string,
      verdict: IPCInput<'kanban:addReview'>['verdict'],
      summary?: string,
      threadId?: string
    ) => invoke('kanban:addReview', { projectId, taskId, verdict, summary, threadId }),
    setBlocker: (projectId: string, taskId: string, blocked: boolean, summary?: string, threadId?: string) =>
      invoke('kanban:setBlocker', { projectId, taskId, blocked, summary, threadId }),
    getNotes: (projectId: string, taskId: string) => invoke('kanban:getNotes', { projectId, taskId }),
    listEvents: (projectId: string, taskId: string) => invoke('kanban:listEvents', { projectId, taskId }),
    getGitSummary: (projectId: string, taskId: string) => invoke('kanban:getGitSummary', { projectId, taskId }),
    getWipLimits: (projectId: string) => invoke('kanban:getWipLimits', { projectId }),
    setWipLimit: (projectId: string, status: IPCInput<'kanban:setWipLimit'>['status'], maxTasks: number) =>
      invoke('kanban:setWipLimit', { projectId, status, maxTasks }),
    listSubtasks: (projectId: string, parentTaskId: string) =>
      invoke('kanban:listSubtasks', { projectId, parentTaskId }),
    listStages: (projectId: string) => invoke('kanban:listStages', { projectId }),
    updateStage: (projectId: string, stage: IPCInput<'kanban:updateStage'>['stage']) =>
      invoke('kanban:updateStage', { projectId, stage }),
    renameStage: (projectId: string, oldId: string, newId: string) =>
      invoke('kanban:renameStage', { projectId, oldId, newId }),
    deleteStage: (projectId: string, stageId: string) => invoke('kanban:deleteStage', { projectId, stageId }),
    getCfdData: (projectId: string, days: number) => invoke('kanban:getCfdData', { projectId, days }),
    updateClassOfService: (
      projectId: string,
      taskId: string,
      classOfService: IPCInput<'kanban:updateClassOfService'>['classOfService']
    ) => invoke('kanban:updateClassOfService', { projectId, taskId, classOfService }),
    setDueDate: (projectId: string, taskId: string, dueAt: number | null) =>
      invoke('kanban:setDueDate', { projectId, taskId, dueAt }),
    listOverdue: (projectId: string) => invoke('kanban:listOverdue', { projectId }),
    addDependency: (projectId: string, taskId: string, blocksId: string) =>
      invoke('kanban:addDependency', { projectId, taskId, blocksId }),
    removeDependency: (projectId: string, taskId: string, blocksId: string) =>
      invoke('kanban:removeDependency', { projectId, taskId, blocksId }),
    getBlockedTasks: (projectId: string) => invoke('kanban:getBlockedTasks', { projectId }),
    shareSlackUpdate: (projectId: string, taskId: string, message: string, channelId?: string) =>
      invoke('kanban:shareSlackUpdate', { projectId, taskId, message, channelId }),
    updatePriority: (projectId: string, taskId: string, priority: IPCInput<'kanban:updatePriority'>['priority']) =>
      invoke('kanban:updatePriority', { projectId, taskId, priority }),
    assignThread: (projectId: string, taskId: string, threadId: string | null) =>
      invoke('kanban:assignThread', { projectId, taskId, threadId }),
    editNote: (projectId: string, eventId: string, newText: string) =>
      invoke('kanban:editNote', { projectId, eventId, newText }),
    deleteNote: (projectId: string, eventId: string) => invoke('kanban:deleteNote', { projectId, eventId }),
  },

  council: {
    listConfigs: () => invoke('council:listConfigs'),
    getConfig: (id: string) => invoke('council:getConfig', { id }),
    upsertConfig: (req: IPCInput<'council:upsertConfig'>) => invoke('council:upsertConfig', req),
    deleteConfig: (id: string) => invoke('council:deleteConfig', { id }),
    run: (configId: string, parentThreadId: string, prompt: string) =>
      invoke('council:run', { configId, parentThreadId, prompt }),
    getRun: (runId: string) => invoke('council:getRun', { runId }),
    getOutcomes: (runId: string) => invoke('council:getOutcomes', { runId }),
    listRunsByThread: (parentThreadId: string) => invoke('council:listRunsByThread', { parentThreadId }),
  },

  tray: {
    focusThread: (threadId: string) => ipcRenderer.send(TRAY_CHANNELS.FOCUS_THREAD, { threadId }),
    openApp: () => ipcRenderer.send(TRAY_CHANNELS.OPEN_APP),
    quitApp: () => ipcRenderer.send(TRAY_CHANNELS.QUIT_APP),
  },

  platform: process.platform,

  on: {
    terminalData: (cb: (e: TerminalDataEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalDataEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.TERMINAL_DATA, handler);
      return () => ipcRenderer.off(IPC_EVENTS.TERMINAL_DATA, handler);
    },

    threadStatus: (cb: (e: ThreadStatusEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ThreadStatusEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_STATUS, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_STATUS, handler);
    },

    sandboxImageBuilding: (cb: (e: { progress: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { progress: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.SANDBOX_IMAGE_BUILDING, handler);
      return () => ipcRenderer.off(IPC_EVENTS.SANDBOX_IMAGE_BUILDING, handler);
    },

    updateReady: (cb: (e: { releaseName: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { releaseName: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.UPDATE_READY, handler);
      return () => ipcRenderer.off(IPC_EVENTS.UPDATE_READY, handler);
    },

    logEntry: (cb: (entry: AppLogEntry) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: AppLogEntry) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.LOG_ENTRY, handler);
      return () => ipcRenderer.off(IPC_EVENTS.LOG_ENTRY, handler);
    },

    messageAppended: (cb: (e: MessageAppendedEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: MessageAppendedEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.MESSAGE_APPENDED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.MESSAGE_APPENDED, handler);
    },

    threadPostAppended: (cb: (e: ThreadPostAppendedEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ThreadPostAppendedEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_POST_APPENDED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_POST_APPENDED, handler);
    },

    threadPostUpdated: (cb: (e: ThreadPostUpdatedEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ThreadPostUpdatedEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_POST_UPDATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_POST_UPDATED, handler);
    },

    threadRenamed: (cb: (e: ThreadRenamedEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ThreadRenamedEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_RENAMED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_RENAMED, handler);
    },

    threadCreated: (cb: (thread: Thread) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: Thread) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_CREATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_CREATED, handler);
    },

    threadDeleted: (cb: (e: { threadId: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { threadId: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_DELETED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_DELETED, handler);
    },

    threadUnread: (cb: (e: ThreadUnreadEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ThreadUnreadEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.THREAD_UNREAD, handler);
      return () => ipcRenderer.off(IPC_EVENTS.THREAD_UNREAD, handler);
    },

    trayThreadsUpdate: (cb: (threads: TrayThread[]) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TrayThread[]) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.TRAY_THREADS_UPDATE, handler);
      return () => ipcRenderer.off(IPC_EVENTS.TRAY_THREADS_UPDATE, handler);
    },

    trayNavigateToThread: (cb: (e: { threadId: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { threadId: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.TRAY_NAVIGATE_TO_THREAD, handler);
      return () => ipcRenderer.off(IPC_EVENTS.TRAY_NAVIGATE_TO_THREAD, handler);
    },

    kanbanTaskMoved: (cb: (e: KanbanTaskMovedEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: KanbanTaskMovedEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.KANBAN_TASK_MOVED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.KANBAN_TASK_MOVED, handler);
    },

    kanbanTaskCreated: (cb: (e: import('../shared/types').KanbanTask) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: import('../shared/types').KanbanTask) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.KANBAN_TASK_CREATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.KANBAN_TASK_CREATED, handler);
    },

    kanbanTaskUpdated: (cb: (e: import('../shared/types').KanbanTask) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: import('../shared/types').KanbanTask) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.KANBAN_TASK_UPDATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.KANBAN_TASK_UPDATED, handler);
    },

    kanbanStagesUpdated: (cb: (e: { projectId: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { projectId: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.KANBAN_STAGES_UPDATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.KANBAN_STAGES_UPDATED, handler);
    },

    kanbanTaskDeleted: (cb: (e: { projectId: string; taskId: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { projectId: string; taskId: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.KANBAN_TASK_DELETED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.KANBAN_TASK_DELETED, handler);
    },

    councilRunUpdated: (cb: (run: import('../shared/types').CouncilRun) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: import('../shared/types').CouncilRun) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.COUNCIL_RUN_UPDATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.COUNCIL_RUN_UPDATED, handler);
    },

    councilOutcomeSubmitted: (
      cb: (e: { runId: string; outcome: import('../shared/types').CouncilOutcomeRecord }) => void
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { runId: string; outcome: import('../shared/types').CouncilOutcomeRecord }
      ) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.COUNCIL_OUTCOME_SUBMITTED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.COUNCIL_OUTCOME_SUBMITTED, handler);
    },

    voiceFlowStart: (cb: (payload: { appFocused: boolean; frontmostApp: string | null }) => void): (() => void) => {
      const handler = (_: unknown, payload: { appFocused: boolean; frontmostApp: string | null }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.VOICE_FLOW_START, handler);
      return () => ipcRenderer.off(IPC_EVENTS.VOICE_FLOW_START, handler);
    },

    voiceFlowStop: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC_EVENTS.VOICE_FLOW_STOP, handler);
      return () => ipcRenderer.off(IPC_EVENTS.VOICE_FLOW_STOP, handler);
    },

    voiceFlowDownloadProgress: (cb: (e: { model: string; percent: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { model: string; percent: number }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS, handler);
      return () => ipcRenderer.off(IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS, handler);
    },

    voiceFlowTranscriptSegment: (cb: (e: { text: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { text: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.VOICE_FLOW_TRANSCRIPT_SEGMENT, handler);
      return () => ipcRenderer.off(IPC_EVENTS.VOICE_FLOW_TRANSCRIPT_SEGMENT, handler);
    },

    meetingDetected: (cb: (e: { url: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { url: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.MEETING_DETECTED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.MEETING_DETECTED, handler);
    },

    meetingEnded: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC_EVENTS.MEETING_ENDED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.MEETING_ENDED, handler);
    },

    recordingOverlayState: (cb: (e: RecordingOverlayPayload) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: RecordingOverlayPayload) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.RECORDING_OVERLAY_STATE, handler);
      return () => ipcRenderer.off(IPC_EVENTS.RECORDING_OVERLAY_STATE, handler);
    },

    recordingCancel: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC_EVENTS.RECORDING_CANCEL, handler);
      return () => ipcRenderer.off(IPC_EVENTS.RECORDING_CANCEL, handler);
    },

    memoryIndexStatus: (cb: (e: MemoryIndexStatusEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: MemoryIndexStatusEvent) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.MEMORY_INDEX_STATUS, handler);
      return () => ipcRenderer.off(IPC_EVENTS.MEMORY_INDEX_STATUS, handler);
    },

    shutdownOverlayState: (cb: (e: ShutdownOverlayPayload) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: ShutdownOverlayPayload) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.SHUTDOWN_OVERLAY_STATE, handler);
      return () => ipcRenderer.off(IPC_EVENTS.SHUTDOWN_OVERLAY_STATE, handler);
    },

    settingsChanged: (cb: (settings: PublicSettings) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: PublicSettings) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.SETTINGS_CHANGED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.SETTINGS_CHANGED, handler);
    },

    projectSaved: (cb: (project: SavedProject) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: SavedProject) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.PROJECT_SAVED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.PROJECT_SAVED, handler);
    },

    projectDeleted: (cb: (e: { projectId: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { projectId: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.PROJECT_DELETED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.PROJECT_DELETED, handler);
    },

    projectConfigUpdated: (cb: (e: { projectPath: string; key: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { projectPath: string; key: string }) => cb(payload);
      ipcRenderer.on(IPC_EVENTS.PROJECT_CONFIG_UPDATED, handler);
      return () => ipcRenderer.off(IPC_EVENTS.PROJECT_CONFIG_UPDATED, handler);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
