# AgentOS — Module & API Reference

## Table of Contents

- [IPC Channel Registry](#ipc-channel-registry)
  - [Thread channels](#thread-channels)
  - [Terminal channels](#terminal-channels)
  - [Memory channels](#memory-channels)
  - [Project channels](#project-channels)
  - [Settings channels](#settings-channels)
  - [Automation channels](#automation-channels)
  - [Sandbox channels](#sandbox-channels)
  - [Messages channels](#messages-channels)
  - [Audio channels](#audio-channels)
  - [Wiki channels](#wiki-channels)
  - [Window channels](#window-channels)
  - [Health & Log channels](#health--log-channels)
- [IPC Push Events](#ipc-push-events)
- [ThreadManager Public API](#threadmanager-public-api)
- [AgentOSMemoryService Public API](#agentosmemoryservice-public-api)
- [AutomationService Public API](#automationservice-public-api)
- [Shared Types Reference](#shared-types-reference)
- [window.electronAPI (Renderer)](#windowelectronapi-renderer)

---

## IPC Channel Registry

All channels are defined in `src/shared/ipc/registry.ts` as the `IPCMap` type. Each entry specifies a typed `input` (renderer → main) and `output` (main → renderer). The preload enforces these types via the generic `invoke<K>()` helper.

### Thread channels

#### `thread:create`

Creates a new thread with a git worktree and Docker container configuration.

| | |
|---|---|
| **Input** | `CreateThreadRequest` |
| **Output** | `Thread` |

```ts
interface CreateThreadRequest {
  name: string;                // display name for the thread
  workingDirectory: string;    // absolute path to the project directory
  provider?: Provider;         // 'claude' | 'codex' | 'gemini'; defaults to project/global setting
  projectName?: string;        // optional: override the project display name
}
```

**Side effects:** If worktrees are enabled, creates a git worktree at `<repoRoot>/.agentos/worktrees/<slug>-<id>` from the latest available `origin/<baseBranch>` (falling back to the local base branch), saves the project to electron-store, persists the thread, broadcasts `THREAD_CREATED`.

---

#### `thread:start`

Starts the Docker container for an existing stopped thread.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `void` |

**Throws:** `"Docker is not available"` if Docker Desktop is not running.

**Side effects:** Pulls/builds the sandbox image if needed, spawns `docker run`, broadcasts `THREAD_STATUS` with `status: 'running'`.

---

#### `thread:stop`

Stops the running PTY/container for a thread (sets status to `'stopped'`).

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `void` |

---

#### `thread:delete`

Permanently removes a thread, its Docker container, worktree, and all persisted data.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `void` |

---

#### `thread:archive`

Archives a thread (marks it `status: 'archived'`, removes the worktree). Archived threads do not appear in the thread list.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `void` |

---

#### `thread:list`

Returns all non-archived threads with their current runtime state.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `Thread[]` |

---

#### `thread:rename`

Renames a thread.

| | |
|---|---|
| **Input** | `{ threadId: string; name: string }` |
| **Output** | `Thread` |

**Side effects:** Broadcasts `THREAD_RENAMED`.

---

#### `thread:getInjectionStatus`

Returns whether the boot/memory context has been injected for the thread.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `ThreadInjectionStatus` |

```ts
interface ThreadInjectionStatus {
  hasBoot: boolean;   // true if project has a boot prompt
  hasMemory: boolean; // retained for status compatibility; memory search is no longer injected
  injected: boolean;  // true once injection completed
  error?: string;
}
```

---

#### `thread:setAutopilot`

Toggles autopilot for one thread.

| | |
|---|---|
| **Input** | `{ threadId: string; enabled: boolean }` |
| **Output** | `Thread` |

---

#### `thread:derivePersonality`

Derives a project personality profile from recent user messages.

| | |
|---|---|
| **Input** | `{ projectId: string }` |
| **Output** | `PersonalitySettings` |

---

### Terminal channels

#### `terminal:sendInput`

Enqueues a text input for the thread (sent to the running agent).

| | |
|---|---|
| **Input** | `SendInputRequest` |
| **Output** | `void` |

```ts
interface SendInputRequest {
  threadId: string;
  input: string;  // must end with '\n' for the CLI to process it
}
```

---

#### `terminal:resize`

Resizes the PTY for the given thread.

| | |
|---|---|
| **Input** | `ResizeTerminalRequest` |
| **Output** | `void` |

```ts
interface ResizeTerminalRequest {
  threadId: string;
  cols: number;
  rows: number;
}
```

---

#### `terminal:getHistory`

Returns the in-memory ANSI log buffer for a thread (up to `maxLogBufferSize` entries).

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `ThreadLogEntry[]` |

```ts
interface ThreadLogEntry {
  id: string;
  timestamp: number;              // unix ms
  data: string;                   // raw ANSI chunk
  source: 'stdout' | 'stderr' | 'system';
}
```

---

### Memory channels

#### `memory:search`

Performs a hybrid vector + keyword search over the project's memory index.

| | |
|---|---|
| **Input** | `MemorySearchRequest` |
| **Output** | `MemorySearchHit[]` |

```ts
interface MemorySearchRequest {
  threadId: string;
  query: string;
  maxResults?: number;           // default: 8; MCP tool cap: 25
  minScore?: number;             // default: 0.5 (raised from 0.1 to filter noise)
  source?: 'all' | 'memory' | 'sessions';
}

interface MemorySearchHit {
  id: string;
  source: 'memory' | 'sessions';
  path: string;
  title: string;
  score: number;
  snippet: string;               // up to 300 chars surrounding the match
  startLine?: number;
  endLine?: number;
  threadId?: string;
  timestamp?: number;
  entities?: string[];           // entity names associated with this chunk (inline enrichment)
}
```

---

#### `memory:get`

Retrieves a specific memory entry by ID or path.

| | |
|---|---|
| **Input** | `MemoryGetRequest` |
| **Output** | `MemoryEntryRecord \| null` |

```ts
interface MemoryGetRequest {
  threadId: string;
  entryId?: string;   // look up by chunk ID
  path?: string;      // look up by relative path (e.g. 'MEMORY.md', 'memory/arch.md')
}
```

---

#### `memory:save`

Writes content to a markdown file in the project's memory directory.

| | |
|---|---|
| **Input** | `MemorySaveRequest` |
| **Output** | `{ savedPath: string; bytesWritten: number }` |

```ts
interface MemorySaveRequest {
  threadId: string;
  path: string;                   // relative: 'MEMORY.md' or 'memory/<file>.md'
  content: string;
  mode?: 'overwrite' | 'append';  // default: 'overwrite'
}
```

---

#### `memory:status`

Returns indexing statistics for the project.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `MemoryIndexStatus` |

---

#### `memory:reindex`

Forces a full re-index of the project's memory files.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `MemoryIndexStatus` |

---

#### `memory:doctor`

Runs a diagnostic check on the memory subsystem.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `MemoryDoctorResult` |

---

### Project channels

#### `project:list`

Returns all saved projects.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `SavedProject[]` |

---

#### `project:getConfig`

Reads and validates the `.agentos/config.json` config file for a given project path.

| | |
|---|---|
| **Input** | `{ projectPath: string }` |
| **Output** | `ProjectConfigLookup` |

```ts
interface ProjectConfigLookup {
  config: ProjectConfig | null;
  exists: boolean;
  path: string;
  warnings: string[];
}
```

---

#### `project:initConfig`

Creates a default `.agentos/config.json` in the given project directory.

| | |
|---|---|
| **Input** | `{ projectPath: string }` |
| **Output** | `ProjectConfigInitResult` |

---

#### `project:openConfig`

Opens `.agentos/config.json` in the system's default editor.

| | |
|---|---|
| **Input** | `{ projectPath: string }` |
| **Output** | `ProjectConfigOpenResult` |

---

### Settings channels

#### `settings:get`

Returns the current `AppSettings`.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `AppSettings` |

---

#### `settings:set`

Merges a partial settings patch and returns the new `AppSettings`.

| | |
|---|---|
| **Input** | `Partial<AppSettings>` |
| **Output** | `AppSettings` |

**Side effects:** Emits `settingsEvents.change`; SlackBridge re-applies settings.

---

### Automation channels

#### `automation:create`

Creates a new automation job.

| | |
|---|---|
| **Input** | `AutomationCreateRequest` |
| **Output** | `AutomationJob` |

```ts
interface AutomationCreateRequest {
  name: string;
  description?: string;
  projectId: string;
  trigger: AutomationTrigger;
  instructions: string;
  notification?: AutomationNotification;
  enabled?: boolean;          // default: true
  deleteAfterRun?: boolean;   // default: false
}

type AutomationTrigger =
  | { kind: 'schedule'; schedule: AutomationSchedule }
  | { kind: 'manual' };

type AutomationSchedule =
  | { kind: 'cron'; expr: string }   // standard 5-field cron
  | { kind: 'every'; ms: number }    // interval in milliseconds
  | { kind: 'at'; iso: string };     // one-shot ISO 8601 timestamp
```

---

#### `automation:run`

Executes an automation immediately (manual trigger).

| | |
|---|---|
| **Input** | `{ id: string }` |
| **Output** | `{ ok: boolean; error?: string }` |

---

### Sandbox channels

#### `sandbox:checkDocker`

Checks whether Docker is available and whether the sandbox image exists.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `{ available: boolean; imageBuilt: boolean }` |

---

#### `sandbox:listContainers`

Lists all `agentos-managed` Docker containers with their registry metadata.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `ContainerSummary[]` |

---

#### `sandbox:pruneContainers`

Removes idle/old containers according to the `containers` prune settings.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `{ pruned: string[]; errors: string[] }` |

---

### Messages channels

#### `messages:list`

Returns all persisted structured messages for a thread (from `~/.agentos/messages/<threadId>.jsonl`).

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `Message[]` |

---

#### `messages:pending`

Returns any accumulated assistant output not yet flushed as a complete message.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `string` |

---

#### `messages:clear`

Clears pending assistant output for a thread.

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `void` |

---

#### `threadPosts:list`

Returns in-app Thread view posts saved by `agentos-thread` MCP (`post_update`, `ask_clarification`, uploaded-file comments).

| | |
|---|---|
| **Input** | `{ threadId: string }` |
| **Output** | `ThreadPost[]` |

---

### Audio channels

#### `audio:transcribe`

Transcribes an audio buffer (PCM/WAV) to text using the local model.

| | |
|---|---|
| **Input** | `ArrayBuffer` |
| **Output** | `{ text: string }` |

---

#### `audio:playTTS`

Plays text-to-speech audio for the given text.

| | |
|---|---|
| **Input** | `{ text: string }` |
| **Output** | `void` |

---

#### `audio:modelReady`

Returns whether the local transcription model is ready.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `{ ready: boolean }` |

---

#### `audio:stopTTS`

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `void` |

---

#### `desktop:getSources`

Returns Electron desktop capture sources for meeting/system-audio capture.

#### Recording channels

| Channel | Purpose |
|---|---|
| `recording:save` | Persist a manual recording or rolling segment (`kind?: 'segment'`) with transcript and audio bytes. |
| `recording:setThread` | Link a recording to its generated thread. |
| `recording:setTitle` | Rename a recording. |
| `recording:delete` | Delete a recording and its files. |
| `recording:read` | Read recording audio bytes. |
| `recording:list` | List manual recordings. |
| `recording:segments` | List rolling segments overlapping a time window. |

---

### Wiki channels

#### `wiki:list`

Lists all wiki pages for a project.

| | |
|---|---|
| **Input** | `{ projectPath: string }` |
| **Output** | `WikiPage[]` |

---

#### `wiki:get`

Fetches a single wiki page by page ID.

| | |
|---|---|
| **Input** | `{ projectPath: string; pageId: string }` |
| **Output** | `WikiPage \| null` |

---

#### `wiki:save`

Creates or updates a wiki page.

| | |
|---|---|
| **Input** | `WikiSaveRequest` |
| **Output** | `WikiPage` |

---

#### `wiki:delete`

Deletes a wiki page by page ID.

| | |
|---|---|
| **Input** | `{ projectPath: string; pageId: string }` |
| **Output** | `void` |

---

### Window channels

| Channel | Input | Output | Description |
|---|---|---|---|
| `window:minimize` | `undefined` | `void` | Minimise the window |
| `window:maximize` | `undefined` | `void` | Maximise or restore the window |
| `window:close` | `undefined` | `void` | Close the window |
| `window:isMaximized` | `undefined` | `boolean` | Returns current maximised state |

---

### Health & Log channels

#### `health:run`

Runs all health checks (Docker, Claude binary, memory DB, etc.) and returns a report.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `HealthReport` |

```ts
interface HealthReport {
  checks: HealthCheck[];
  ranAt: number;
}

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message?: string;
}
```

---

#### `log:getHistory`

Returns the in-memory event log ring buffer.

| | |
|---|---|
| **Input** | `undefined` |
| **Output** | `AppLogEntry[]` |

---

## IPC Push Events

The main process broadcasts these events to the renderer without a request. Subscribe via `window.electronAPI.on.<eventName>(callback)`.

| Event constant | Payload type | Description |
|---|---|---|
| `event:terminal:data` | `TerminalDataEvent` | Raw ANSI chunk from a running thread |
| `event:thread:status` | `ThreadStatusEvent` | Thread status change (running/stopped/error/autopilot state) |
| `event:thread:renamed` | `ThreadRenamedEvent` | Thread was renamed |
| `event:thread:created` | `Thread` | New thread was created (e.g., from Slack) |
| `event:message:appended` | `MessageAppendedEvent` | A structured Message was finalised and appended |
| `event:log` | `AppLogEntry` | New event log entry |
| `event:sandbox:imageBuilding` | `{ progress: string }` | Docker image build progress update |

```ts
interface TerminalDataEvent   { threadId: string; data: string; }
interface ThreadStatusEvent   { threadId: string; status: ThreadStatus; provider?: Provider;
                                pid?: number; exitCode?: number; queueDepth?: number;
                                autopilotEnabled?: boolean; autopilotState?: AutopilotThreadState;
                                autopilotLastReason?: string; autopilotConsecutiveTurns?: number; }
interface ThreadRenamedEvent  { threadId: string; name: string; }
interface MessageAppendedEvent{ threadId: string; message: Message; }
```

---

## ThreadManager Public API

`threadManager` is a singleton exported from `src/main/sessions/ThreadManager.ts`. IPC handlers delegate to these methods.

```ts
class ThreadManager {
  // Lifecycle
  createThread(req: CreateThreadRequest): Promise<Thread>
  startThread(threadId: string, options?: { forceClaudePlainText?: boolean }): Promise<void>
  stopThread(threadId: string): Promise<void>
  deleteThread(threadId: string): void
  archiveThread(threadId: string): void
  killAll(): void

  // Query
  getThreads(): Thread[]
  getThread(threadId: string): Thread | null

  // I/O
  sendInput(threadId: string, input: string, source?: QueueSource, options?: { timeoutMs?: number }): Promise<void>
  resizeTerminal(threadId: string, cols: number, rows: number): void
  getLogHistory(threadId: string): ThreadLogEntry[]
  getPendingOutput(threadId: string): string
  listMessages(threadId: string): Message[]
  clearMessages(threadId: string): void

  // Status
  getInjectionStatus(threadId: string): ThreadInjectionStatus
  setThreadAutopilot(threadId: string, enabled: boolean): Thread

  // Integration context
  setSlackContext(threadId: string, ctx: { channelId: string; threadTs: string | null }): void

  // Projects
  getProjectConfig(projectPath: string): Promise<ProjectConfigLookup>

  // Docker
  pruneContainers(opts?: { force?: boolean }): Promise<{ pruned: string[]; errors: string[] }>
  removeContainer(containerName: string): Promise<void>
  listContainerSummaries(): Promise<ContainerSummary[]>

  // Personality
  derivePersonalityProfile(threadId: string): DerivePersonalityProfileResult

  // Internal (used by loadFromStore)
  loadFromStore(): void
}
```

**`QueueSource`** = `'user' | 'automation' | 'autopilot'`

---

## AgentOSMemoryService Public API

`agentOSMemoryService` is a singleton exported from `src/main/memory/service.ts`.

```ts
class AgentOSMemoryService {
  init(homeDir: string): void
  status(projectId?: string | null, threadId?: string | null): Promise<MemoryIndexStatus>
  reindex(projectId?: string | null, threadId?: string | null): Promise<MemoryIndexStatus>
  doctor(projectId?: string | null, threadId?: string | null): Promise<MemoryDoctorResult>
  save(params: {
    projectId?: string | null;
    threadId?: string | null;
    path: string;
    content: string;
    mode?: 'overwrite' | 'append';
  }): Promise<{ savedPath: string; bytesWritten: number }>
  search(params: {
    projectId?: string | null;
    threadId?: string | null;
    query: string;
    maxResults?: number;
    minScore?: number;
    source?: 'all' | 'memory' | 'sessions';
  }): Promise<MemorySearchHit[]>
  get(params: {
    projectId?: string | null;
    threadId?: string | null;
    entryId?: string;
    path?: string;
  }): Promise<MemoryEntryRecord | null>
}
```

---

## AutomationService Public API

`automationService` is a singleton exported from `src/main/automations/service.ts`.

```ts
class AutomationService {
  start(): void
  stop(): void
  list(): AutomationJob[]
  create(req: AutomationCreateRequest): AutomationJob
  update(id: string, patch: Partial<Omit<AutomationJob, 'id' | 'createdAt'>>): AutomationJob
  toggle(id: string, enabled: boolean): AutomationJob
  remove(id: string): void
  runNow(id: string): Promise<{ ok: boolean; error?: string }>
  get(id: string): AutomationJob   // throws if not found
}
```

---

## Shared Types Reference

### Thread

```ts
type ThreadStatus = 'running' | 'idle' | 'error' | 'stopped' | 'archived';
type AutopilotThreadState = 'idle' | 'thinking' | 'sent' | 'stopped' | 'blocked';

interface Thread {
  id: string;
  name: string;
  projectId: string;
  workingDirectory: string;   // path to git worktree (or project root if no worktree)
  projectPath?: string;       // canonical project root path
  usingWorktree?: boolean;
  provider?: Provider;
  status: ThreadStatus;
  createdAt: number;          // unix ms
  lastActiveAt: number;
  pid?: number;               // PID of the docker process (when running)
  exitCode?: number;
  queueDepth?: number;
  logBuffer: ThreadLogEntry[];  // in-memory; not persisted
  promptHistory: string[];      // last 100 user inputs
  autopilotEnabled?: boolean;
  autopilotState?: AutopilotThreadState;
  autopilotLastReason?: string;
  autopilotConsecutiveTurns?: number;
  claudeSessionId?: string;   // for --resume
  codexSessionId?: string;
  geminiSessionId?: string;
  archivedAt?: number;
}
```

### Message

```ts
type MessageRole = 'user' | 'assistant' | 'tool';

interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  source?: 'human' | 'automation' | 'autopilot';
  content: string;                       // raw text content
  normalized?: MessageNormalizedPayload; // structured blocks (if parsing succeeded)
  timestamp: number;
}

interface MessageNormalizedPayload {
  schemaVersion: 1;
  provider: Provider;
  role: MessageRole;
  blocks: MessageContentBlock[];
  raw?: { source: 'plain_text' | 'stream_json'; payload: unknown };
}

type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
```

### AppSettings

```ts
interface AppSettings {
  claudeStreamJson: boolean;           // use --output-format stream-json
  skipPermissions: boolean;            // pass --dangerously-skip-permissions
  agents: AgentsConfig;                // providerOrder, lastProvider, commandOverrides, autopilot
  runOnHost?: boolean;
  maxLogBufferSize: number;            // default: 2000
  logRetentionDays?: number;
  persistDebugLogs: boolean;
  devMode: boolean;
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  webhookPort?: number;
  apiKeys?: ApiKeys;
  tailscale?: TailscaleSettings;
  memory?: MemoryConfig;
  slack?: SlackSettings;
  mcpRequireAuth?: boolean;       // default: false; when true, loopback requests to MCP servers must carry bearer token
  sandbox?: SandboxSecuritySettings;
  containers?: ContainersConfig;
  worktree?: WorktreeSettings;
  voice?: VoiceSettings;          // TTS
  voiceFlow?: VoiceFlowSettings;  // global hotkey transcription
  env?: EnvConfig;
  personality?: PersonalitySettings;
  recording?: RecordingSettings;        // global recording templates; per-project override in ProjectConfig.recording
  meetingProjectPath?: string;
  continuousCaptureEnabled?: boolean;
  editor?: { label: string; command: string; args?: string };
}
```

**`SlackSettings` (relevant fields):**

```ts
interface SlackSettings {
  enabled: boolean;
  botToken: string | null;
  appToken: string | null;
  watchedChannelIds: string[];
  channelWorkspaceMap: Record<string, string>;
  requireMention: boolean;       // default: false; when true, new root-thread messages without @mention are dropped
  defaultWorkingDirectory: string | null;
  // Removed fields (were persisted but never enforced): commandPrefix, agentPrompt, postThreadStatusUpdates, mcpPort
}
```

---

## window.electronAPI (Renderer)

The renderer accesses all main-process functionality through `window.electronAPI`, which is populated by the preload script.

```ts
window.electronAPI = {
  thread: {
    create(req: CreateThreadRequest): Promise<Thread>
    start(threadId: string): Promise<void>
    stop(threadId: string): Promise<void>
    delete(threadId: string): Promise<void>
    archive(threadId: string): Promise<void>
    list(): Promise<Thread[]>
    rename(threadId: string, name: string): Promise<Thread>
    getInjectionStatus(threadId: string): Promise<ThreadInjectionStatus>
    setAutopilot(threadId: string, enabled: boolean): Promise<Thread>
    derivePersonality(threadId: string): Promise<DerivePersonalityProfileResult>
  },
  memory: {
    status(threadId: string): Promise<MemoryIndexStatus>
    reindex(threadId: string): Promise<MemoryIndexStatus>
    doctor(threadId: string): Promise<MemoryDoctorResult>
    search(req: MemorySearchRequest): Promise<MemorySearchHit[]>
    get(req: MemoryGetRequest): Promise<MemoryEntryRecord | null>
    save(req: MemorySaveRequest): Promise<{ savedPath: string; bytesWritten: number }>
  },
  terminal: {
    sendInput(req: SendInputRequest): Promise<void>
    resize(req: ResizeTerminalRequest): Promise<void>
    getHistory(threadId: string): Promise<ThreadLogEntry[]>
  },
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  },
  project: {
    list(): Promise<SavedProject[]>
    save(req: SaveProjectRequest): Promise<SavedProject>
    delete(projectId: string): Promise<void>
    getConfig(projectPath: string): Promise<ProjectConfigLookup>
    initConfig(projectPath: string): Promise<ProjectConfigInitResult>
    openConfig(projectPath: string): Promise<ProjectConfigOpenResult>
  },
  automation: {
    list(): Promise<AutomationJob[]>
    create(req: AutomationCreateRequest): Promise<AutomationJob>
    update(req: AutomationUpdateRequest): Promise<AutomationJob>
    delete(id: string): Promise<void>
    run(id: string): Promise<{ ok: boolean; error?: string }>
    toggle(id: string, enabled: boolean): Promise<AutomationJob>
  },
  sandbox: {
    checkDocker(): Promise<{ available: boolean; imageBuilt: boolean }>
    openDocker(): Promise<void>
    listContainers(): Promise<ContainerSummary[]>
    pruneContainers(): Promise<{ pruned: string[]; errors: string[] }>
    removeContainer(containerName: string): Promise<void>
  },
  messages: {
    list(threadId: string): Promise<Message[]>
    pending(threadId: string): Promise<string>
    clear(threadId: string): Promise<void>
  },
  audio: {
    transcribe(audioBuffer: ArrayBuffer): Promise<{ text: string }>
    playTTS(text: string): Promise<void>
    stopTTS(): Promise<void>
  },
  wiki: {
    list(projectPath: string): Promise<WikiPage[]>
    get(projectPath: string, pageId: string): Promise<WikiPage | null>
    save(projectPath: string, page: WikiPage): Promise<WikiPage>
    delete(projectPath: string, pageId: string): Promise<void>
  },
  win: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  },
  health: { run(): Promise<HealthReport> },
  log: { getHistory(): Promise<AppLogEntry[]> },
  slack: { listChannels(): Promise<SlackChannelOption[]> },
  dialog: { openDirectory(): Promise<string | null> },
  platform: NodeJS.Platform,
  on: {
    terminalData(cb: (e: TerminalDataEvent) => void): () => void
    threadStatus(cb: (e: ThreadStatusEvent) => void): () => void
    messageAppended(cb: (e: MessageAppendedEvent) => void): () => void
    threadRenamed(cb: (e: ThreadRenamedEvent) => void): () => void
    threadCreated(cb: (thread: Thread) => void): () => void
    sandboxImageBuilding(cb: (e: { progress: string }) => void): () => void
    logEntry(cb: (entry: AppLogEntry) => void): () => void
  }
}
```

Each `on.*` method returns an unsubscribe function. Call it in a `useEffect` cleanup to avoid memory leaks.

**Example:**

```ts
useEffect(() => {
  const unsub = window.electronAPI.on.threadStatus((event) => {
    console.log(event.threadId, event.status);
  });
  return unsub; // cleanup on unmount
}, []);
```
