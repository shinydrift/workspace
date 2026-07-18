// IPC type registry — single source of truth for all IPC channel input/output types.
//
// Usage:
//   type Input  = IPCInput<'thread:create'>;   // CreateThreadRequest
//   type Output = IPCOutput<'thread:create'>;  // Thread
//
// The preload uses `typedInvoke` to enforce these types at every call site.
// Changing a channel name or payload shape here causes type errors at all callers.
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskEvent,
  KanbanTaskGitSummary,
  KanbanTaskNote,
  KanbanWipLimit,
  KanbanCreateRequest,
  KanbanAddReviewRequest,
  KanbanSetBlockerRequest,
  KanbanClassOfService,
  CfdSnapshot,
  Thread,
  AppSettings,
  CreateThreadRequest,
  SendInputRequest,
  ResizeTerminalRequest,
  ThreadInjectionStatus,
  ThreadLogEntry,
  ContainerSummary,
  SavedProject,
  SaveProjectRequest,
  Message,
  ThreadPost,
  AppLogEntry,
  SlackChannelOption,
  ProjectConfigLookup,
  ProjectConfigInitResult,
  ProjectConfigOpenResult,
  MemoryEntryRecord,
  MemoryDoctorResult,
  MemoryIndexStatus,
  MemorySaveRequest,
  MemorySearchHit,
  MemorySearchRequest,
  MemoryGetRequest,
  MemoryListRequest,
  MemoryListResult,
  MemoryGraphQueryRequest,
  MemoryGraphAllRequest,
  MemoryGraphAllPageRequest,
  MemoryGetEntityChunksRequest,
  MemoryGetDecayConfigRequest,
  MemorySetDecayConfigRequest,
  MemoryDecayConfig,
  MemoryHealthReport,
  MemoryThreadChunk,
  MemoryProjectStats,
  AutomationJob,
  AutomationCreateRequest,
  AutomationUpdateRequest,
  HealthReport,
  WikiPage,
  WikiSaveRequest,
  SessionMetrics,
  AnalyticsRunRecord,
  ProjectInsightsOverview,
  GlobalInsightsOverview,
  ToolCallStats,
  ToolCallInvocation,
  TurnMetric,
  ProviderRateLimitsEntry,
  FileUploadRequest,
  CouncilConfig,
  CouncilRun,
  CouncilOutcomeRecord,
  CouncilMember,
  PersonalitySettings,
  RecordingRecord,
  UpdateReadyEvent,
  IPC_CHANNELS,
} from '../types';
import type { GraphQueryResult } from '../../main/memory/graph';

// Each entry: { input: payload sent from renderer; output: value resolved in renderer }
export type IPCMap = {
  // Thread
  'thread:create': { input: CreateThreadRequest; output: Thread };
  'thread:start': { input: { threadId: string }; output: void };
  'thread:stop': { input: { threadId: string }; output: void };
  'thread:delete': { input: { threadId: string }; output: void };
  'thread:archive': { input: { threadId: string }; output: void };
  'thread:list': { input: undefined; output: Thread[] };
  'thread:rename': { input: { threadId: string; name: string }; output: Thread };
  'thread:getInjectionStatus': { input: { threadId: string }; output: ThreadInjectionStatus };
  'thread:setAutopilot': { input: { threadId: string; enabled: boolean }; output: Thread };
  'thread:setActive': { input: { threadId: string | null }; output: void };
  'thread:derivePersonality': { input: { projectId: string }; output: PersonalitySettings };
  // Memory
  'memory:status': { input: { threadId: string }; output: MemoryIndexStatus };
  'memory:reindex': { input: { threadId: string }; output: MemoryIndexStatus };
  'memory:doctor': { input: { threadId: string }; output: MemoryDoctorResult };
  'memory:search': { input: MemorySearchRequest; output: MemorySearchHit[] };
  'memory:get': { input: MemoryGetRequest; output: MemoryEntryRecord | null };
  'memory:save': { input: MemorySaveRequest; output: { savedPath: string; bytesWritten: number } };
  'memory:list': { input: MemoryListRequest; output: MemoryListResult };
  'memory:deleteChunk': { input: { threadId: string; chunkId: string }; output: void };
  'memory:deleteFile': { input: { threadId: string; path: string }; output: void };
  'memory:updateChunk': { input: { threadId: string; chunkId: string; text: string }; output: void };
  'memory:pinChunk': { input: { threadId: string; chunkId: string; pinned: boolean }; output: void };
  'memory:graphQuery': { input: MemoryGraphQueryRequest; output: GraphQueryResult };
  'memory:graphAll': { input: MemoryGraphAllRequest; output: GraphQueryResult };
  'memory:graphAllPage': { input: MemoryGraphAllPageRequest; output: GraphQueryResult & { hasMore: boolean } };
  'memory:getEntityChunks': { input: MemoryGetEntityChunksRequest; output: { chunkIds: string[] } };
  'memory:reindexGraph': { input: { threadId: string }; output: { entityCount: number; edgeCount: number } };
  'memory:getDecayConfig': { input: MemoryGetDecayConfigRequest; output: MemoryDecayConfig };
  'memory:setDecayConfig': { input: MemorySetDecayConfigRequest; output: { ok: boolean } };
  'memory:healthCheck': { input: { threadId: string }; output: MemoryHealthReport };
  'memory:getThreadChunks': { input: { threadId: string; limit?: number }; output: MemoryThreadChunk[] };
  'memory:getProjectStats': { input: { projectId: string }; output: MemoryProjectStats };
  'memory:getGlobalExpansionCounts': { input: Record<string, never>; output: { thisWeek: number; lastWeek: number } };
  'memory:resetEmbeddings': {
    input: { projectId: string; target: 'memory' | 'sessions' | 'code' | 'graph' };
    output: { cleared: number };
  };
  'memory:deleteData': {
    input: { projectId: string; target: 'memory' | 'sessions' | 'code' | 'graph' };
    output: { cleared: number };
  };

  // Terminal
  'terminal:sendInput': { input: SendInputRequest; output: void };
  'terminal:resize': { input: ResizeTerminalRequest; output: void };
  'terminal:getHistory': { input: { threadId: string }; output: ThreadLogEntry[] };

  // Settings
  'settings:get': { input: undefined; output: AppSettings };
  'settings:set': { input: Partial<AppSettings>; output: AppSettings };

  // Project
  'project:list': { input: undefined; output: SavedProject[] };
  'project:save': { input: SaveProjectRequest; output: SavedProject };
  'project:delete': { input: { projectId: string }; output: void };
  'project:getConfig': { input: { projectPath: string }; output: ProjectConfigLookup };
  'project:updateConfig': {
    input: { projectPath: string; key: string; updates: Record<string, unknown> };
    output: void;
  };
  'project:initConfig': { input: { projectPath: string }; output: ProjectConfigInitResult };
  'project:openConfig': { input: { projectPath: string }; output: ProjectConfigOpenResult };

  // Slack
  'slack:listChannels': { input: undefined; output: SlackChannelOption[] };

  // Automation
  'automation:list': { input: undefined; output: AutomationJob[] };
  'automation:create': { input: AutomationCreateRequest; output: AutomationJob };
  'automation:update': { input: AutomationUpdateRequest; output: AutomationJob };
  'automation:delete': { input: { id: string }; output: void };
  'automation:run': { input: { id: string }; output: { ok: boolean; error?: string } };
  'automation:toggle': { input: { id: string; enabled: boolean }; output: AutomationJob };

  // Messages
  'messages:list': { input: { threadId: string }; output: Message[] };
  'messages:pending': { input: { threadId: string }; output: string };
  'messages:clear': { input: { threadId: string }; output: void };
  'threadPosts:list': { input: { threadId: string }; output: ThreadPost[] };

  // Dialog
  'dialog:openDirectory': { input: undefined; output: string | null };

  // Sandbox
  'sandbox:listContainers': { input: undefined; output: ContainerSummary[] };
  'sandbox:pruneContainers': { input: undefined; output: { pruned: string[]; errors: string[] } };
  'sandbox:removeContainer': { input: { containerName: string }; output: void };

  // Log
  'log:getHistory': { input: undefined; output: AppLogEntry[] };

  // Health
  'health:run': { input: undefined; output: HealthReport };

  // Audio
  'audio:transcribe': { input: ArrayBuffer; output: { text: string } };
  'audio:modelReady': { input: undefined; output: { ready: boolean } };
  'audio:playTTS': { input: { text: string }; output: void };
  'audio:stopTTS': { input: undefined; output: void };

  // Window
  'window:minimize': { input: undefined; output: void };
  'window:maximize': { input: undefined; output: void };
  'window:close': { input: undefined; output: void };
  'window:isMaximized': { input: undefined; output: boolean };
  'window:focus': { input: undefined; output: void };
  'window:pasteTranscript': { input: { text: string; targetApp?: string | null }; output: void };

  // Wiki
  'wiki:list': { input: { projectPath: string }; output: WikiPage[] };
  'wiki:get': { input: { projectPath: string; pageId: string }; output: WikiPage | null };
  'wiki:save': { input: WikiSaveRequest; output: WikiPage };
  'wiki:delete': { input: { projectPath: string; pageId: string }; output: void };

  // Shell
  'shell:openExternal': { input: { url: string }; output: void };
  'shell:openInEditor': { input: { folderPath: string }; output: void };
  'shell:openFolderTarget': {
    input: { folderPath: string; target: 'vscode' | 'finder' | 'terminal' | 'xcode' };
    output: void;
  };
  'shell:openAttachment': { input: { name: string; data: ArrayBuffer }; output: void };
  'shell:openPath': { input: { path: string }; output: void };

  // Analytics
  'analytics:getSessionMetrics': { input: { threadId: string }; output: SessionMetrics | null };
  'analytics:getAutomationRuns': {
    input: { jobId: string; limit?: number; since?: number };
    output: AnalyticsRunRecord[];
  };
  'analytics:getTopCostThreads': { input: { projectId: string; limit?: number }; output: SessionMetrics[] };
  'analytics:getToolBreakdown': { input: { threadId: string; since?: number }; output: ToolCallStats[] };
  'analytics:getToolInvocations': { input: { threadId: string }; output: ToolCallInvocation[] };
  'analytics:getTurnMetrics': { input: { threadId: string }; output: TurnMetric[] };
  'analytics:getProjectOverview': { input: { projectId: string }; output: ProjectInsightsOverview };
  'analytics:getGlobalOverview': { input: undefined; output: GlobalInsightsOverview };
  'analytics:getProjectToolBreakdown': { input: { projectId: string }; output: ToolCallStats[] };
  'analytics:getGlobalToolBreakdown': { input: undefined; output: ToolCallStats[] };
  'analytics:getGlobalMemoryGetCount': { input: undefined; output: number };
  'analytics:getProviderRateLimits': { input: undefined; output: Record<string, ProviderRateLimitsEntry> };

  // Env
  'env:listShellVars': { input: undefined; output: string[] };

  // App
  'app:getInfo': { input: undefined; output: { version: string } };
  'app:getUpdateStatus': { input: undefined; output: UpdateReadyEvent | null };
  'app:quitAndInstall': { input: undefined; output: void };

  // File
  'file:upload': { input: FileUploadRequest; output: { path: string } };
  'transcript:save': {
    input: { workingDirectory: string; filename: string; text: string };
    output: { path: string };
  };
  'recording:save': {
    input: {
      duration: number;
      arrayBuffer: ArrayBuffer;
      transcript: string;
      title?: string;
      kind?: 'segment';
      startedAt?: number;
    };
    output: { recordingId: string };
  };
  'recording:setThread': {
    input: { recordingId: string; threadId: string };
    output: void;
  };
  'recording:setTitle': {
    input: { recordingId: string; title: string };
    output: void;
  };
  'recording:delete': {
    input: { recordingId: string };
    output: void;
  };
  'recording:read': {
    input: { recordingId: string };
    output: { data: ArrayBuffer };
  };
  'recording:list': {
    input: undefined;
    output: RecordingRecord[];
  };
  'recording:segments': {
    input: { from: number; to: number };
    output: RecordingRecord[];
  };

  // Desktop capturer (system audio source IDs)
  'desktop:getSources': { input: { types: string[] }; output: Array<{ id: string; name: string }> };

  // Kanban
  'kanban:list': { input: { projectId: string; status?: string }; output: KanbanTask[] };
  'kanban:get': { input: { projectId: string; taskId: string }; output: KanbanTask | null };
  'kanban:create': { input: KanbanCreateRequest; output: KanbanTask };
  'kanban:move': {
    input: { projectId: string; taskId: string; status: string; reason?: string };
    output: KanbanTask;
  };
  'kanban:delete': { input: { projectId: string; taskId: string }; output: void };
  'kanban:updateProgress': {
    input: { projectId: string; taskId: string; progress: number; note?: string };
    output: void;
  };
  'kanban:assign': { input: { projectId: string; taskId: string; threadId: string }; output: void };
  'kanban:addNote': {
    input: { projectId: string; taskId: string; content: string; threadId?: string };
    output: KanbanTaskNote;
  };
  'kanban:addReview': {
    input: { projectId: string; taskId: string } & Omit<KanbanAddReviewRequest, 'id'>;
    output: void;
  };
  'kanban:setBlocker': {
    input: { projectId: string; taskId: string } & Omit<KanbanSetBlockerRequest, 'id'>;
    output: void;
  };
  'kanban:getNotes': { input: { projectId: string; taskId: string }; output: KanbanTaskNote[] };
  'kanban:listEvents': { input: { projectId: string; taskId: string }; output: KanbanTaskEvent[] };
  'kanban:getGitSummary': { input: { projectId: string; taskId: string }; output: KanbanTaskGitSummary | null };
  'kanban:getWipLimits': { input: { projectId: string }; output: KanbanWipLimit[] };
  'kanban:setWipLimit': { input: { projectId: string; status: string; maxTasks: number }; output: void };
  'kanban:listSubtasks': { input: { projectId: string; parentTaskId: string }; output: KanbanTask[] };
  'kanban:listStages': { input: { projectId: string }; output: KanbanStage[] };
  'kanban:updateStage': { input: { projectId: string; stage: KanbanStage }; output: void };
  'kanban:renameStage': { input: { projectId: string; oldId: string; newId: string }; output: void };
  'kanban:deleteStage': { input: { projectId: string; stageId: string }; output: void };
  'kanban:getCfdData': { input: { projectId: string; days: number }; output: CfdSnapshot[] };
  'kanban:updateClassOfService': {
    input: { projectId: string; taskId: string; classOfService: KanbanClassOfService };
    output: KanbanTask | null;
  };
  'kanban:setDueDate': {
    input: { projectId: string; taskId: string; dueAt: number | null };
    output: KanbanTask | null;
  };
  'kanban:listOverdue': { input: { projectId: string }; output: KanbanTask[] };
  'kanban:addDependency': { input: { projectId: string; taskId: string; blocksId: string }; output: void };
  'kanban:removeDependency': { input: { projectId: string; taskId: string; blocksId: string }; output: void };
  'kanban:getBlockedTasks': { input: { projectId: string }; output: KanbanTask[] };
  'kanban:shareSlackUpdate': {
    input: { projectId: string; taskId: string; message: string; channelId?: string };
    output: { ok: boolean; threadTs?: string; channelId?: string };
  };
  'kanban:updatePriority': {
    input: { projectId: string; taskId: string; priority: KanbanTask['priority'] };
    output: KanbanTask | null;
  };
  'kanban:assignThread': {
    input: { projectId: string; taskId: string; threadId: string | null };
    output: KanbanTask | null;
  };
  'kanban:editNote': {
    input: { projectId: string; eventId: string; newText: string };
    output: KanbanTaskEvent | null;
  };
  'kanban:deleteNote': {
    input: { projectId: string; eventId: string };
    output: void;
  };

  // Council
  'council:listConfigs': { input: undefined; output: CouncilConfig[] };
  'council:getConfig': { input: { id: string }; output: CouncilConfig | null };
  'council:upsertConfig': {
    input: {
      id?: string;
      name: string;
      members: CouncilMember[];
    };
    output: CouncilConfig;
  };
  'council:deleteConfig': { input: { id: string }; output: void };
  'council:run': { input: { configId: string; parentThreadId: string; prompt: string }; output: CouncilRun };
  'council:getRun': { input: { runId: string }; output: CouncilRun | null };
  'council:getOutcomes': { input: { runId: string }; output: CouncilOutcomeRecord[] };
  'council:listRunsByThread': {
    input: { parentThreadId: string };
    output: { run: CouncilRun; outcomes: CouncilOutcomeRecord[]; memberCount: number }[];
  };
};

export type IPCChannel = keyof IPCMap;
export type IPCInput<K extends IPCChannel> = IPCMap[K]['input'];
export type IPCOutput<K extends IPCChannel> = IPCMap[K]['output'];

// ── Parity: IPC_CHANNELS values must be typed in IPCMap ─────────────────────
// Channels listed here intentionally bypass the typed registry (use raw invoke).
// Adding a new channel to IPC_CHANNELS without adding it to IPCMap (or this list)
// will cause a compile-time error in `npx tsc --noEmit`.
type _ExcludedChannels = 'thread:setProviderModel';
type _AllChannelValues = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
type _ParityCheck = Exclude<_AllChannelValues, _ExcludedChannels> extends IPCChannel ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _parity: _ParityCheck = true;

// Runtime set of all typed channels — used by parity tests.
export const TYPED_CHANNEL_SET: ReadonlySet<string> = new Set<IPCChannel>([
  'thread:create',
  'thread:start',
  'thread:stop',
  'thread:delete',
  'thread:archive',
  'thread:list',
  'thread:rename',
  'thread:getInjectionStatus',
  'thread:setAutopilot',
  'thread:setActive',
  'thread:derivePersonality',
  'memory:status',
  'memory:reindex',
  'memory:doctor',
  'memory:search',
  'memory:get',
  'memory:save',
  'memory:list',
  'memory:deleteChunk',
  'memory:deleteFile',
  'memory:updateChunk',
  'memory:pinChunk',
  'memory:graphQuery',
  'memory:graphAll',
  'memory:graphAllPage',
  'memory:getEntityChunks',
  'memory:reindexGraph',
  'memory:getDecayConfig',
  'memory:setDecayConfig',
  'memory:healthCheck',
  'memory:getThreadChunks',
  'memory:getProjectStats',
  'memory:getGlobalExpansionCounts',
  'memory:resetEmbeddings',
  'memory:deleteData',
  'terminal:sendInput',
  'terminal:resize',
  'terminal:getHistory',
  'settings:get',
  'settings:set',
  'project:list',
  'project:save',
  'project:delete',
  'project:getConfig',
  'project:updateConfig',
  'project:initConfig',
  'project:openConfig',
  'slack:listChannels',
  'automation:list',
  'automation:create',
  'automation:update',
  'automation:delete',
  'automation:run',
  'automation:toggle',
  'dialog:openDirectory',
  'sandbox:listContainers',
  'sandbox:pruneContainers',
  'sandbox:removeContainer',
  'shell:openExternal',
  'shell:openInEditor',
  'shell:openFolderTarget',
  'shell:openAttachment',
  'shell:openPath',
  'log:getHistory',
  'health:run',
  'audio:transcribe',
  'audio:modelReady',
  'audio:playTTS',
  'audio:stopTTS',
  'messages:list',
  'messages:pending',
  'messages:clear',
  'threadPosts:list',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'window:focus',
  'window:pasteTranscript',
  'wiki:list',
  'wiki:get',
  'wiki:save',
  'wiki:delete',
  'analytics:getSessionMetrics',
  'analytics:getAutomationRuns',
  'analytics:getTopCostThreads',
  'analytics:getToolBreakdown',
  'analytics:getToolInvocations',
  'analytics:getTurnMetrics',
  'analytics:getProjectOverview',
  'analytics:getGlobalOverview',
  'analytics:getProjectToolBreakdown',
  'analytics:getGlobalToolBreakdown',
  'analytics:getGlobalMemoryGetCount',
  'analytics:getProviderRateLimits',
  'env:listShellVars',
  'app:getInfo',
  'app:getUpdateStatus',
  'app:quitAndInstall',
  'file:upload',
  'transcript:save',
  'recording:save',
  'recording:setThread',
  'recording:setTitle',
  'recording:delete',
  'recording:read',
  'recording:list',
  'recording:segments',
  'desktop:getSources',
  'kanban:list',
  'kanban:get',
  'kanban:create',
  'kanban:move',
  'kanban:delete',
  'kanban:updateProgress',
  'kanban:assign',
  'kanban:addNote',
  'kanban:addReview',
  'kanban:setBlocker',
  'kanban:getNotes',
  'kanban:listEvents',
  'kanban:getGitSummary',
  'kanban:getWipLimits',
  'kanban:setWipLimit',
  'kanban:listSubtasks',
  'kanban:listStages',
  'kanban:updateStage',
  'kanban:renameStage',
  'kanban:deleteStage',
  'kanban:getCfdData',
  'kanban:updateClassOfService',
  'kanban:setDueDate',
  'kanban:listOverdue',
  'kanban:addDependency',
  'kanban:removeDependency',
  'kanban:getBlockedTasks',
  'kanban:shareSlackUpdate',
  'kanban:updatePriority',
  'kanban:assignThread',
  'kanban:editNote',
  'kanban:deleteNote',
  'council:listConfigs',
  'council:getConfig',
  'council:upsertConfig',
  'council:deleteConfig',
  'council:run',
  'council:getRun',
  'council:getOutcomes',
  'council:listRunsByThread',
] satisfies IPCChannel[]);
