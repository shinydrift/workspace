# AgentOS — Cross-Cutting Concerns

## Table of Contents

- [Authentication & Authorization](#authentication--authorization)
- [Background Jobs / Task Queues](#background-jobs--task-queues)
- [Real-Time Communication (IPC & Push Events)](#real-time-communication-ipc--push-events)
- [Autopilot Mode](#autopilot-mode)
- [Slack Integration](#slack-integration)
- [Memory & Embeddings](#memory--embeddings)
- [Audio (TTS & STT)](#audio-tts--stt)
- [Voice Flow](#voice-flow)
- [Personality Profiles](#personality-profiles)
- [Bundled Skills](#bundled-skills)
- [Tailscale Networking](#tailscale-networking)
- [Theming & Dark Mode](#theming--dark-mode)
- [Wiki Feature](#wiki-feature)
- [Agent Insights & Cost Dashboard](#agent-insights--cost-dashboard)
- [agentos-thread MCP Server](#agentos-thread-mcp-server)
- [Menubar Status Overlay](#menubar-status-overlay)
- [Meeting Recording & AI Notes](#meeting-recording--ai-notes)
- [Sandbox Domain Allowlist](#sandbox-domain-allowlist)
- [Kanban Multi-Agent Orchestration](#kanban-multi-agent-orchestration)
- [Council Multi-Provider Dispatch](#council-multi-provider-dispatch)

---

## Authentication & Authorization

### Claude Code (primary provider)

AgentOS does not manage its own Claude authentication. It reads the existing Claude Code OAuth credential from the macOS Keychain:

```
security find-generic-password -s "Claude Code-credentials" -w
```

This returns a JSON string containing `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, ... } }`. AgentOS extracts `accessToken` and passes it to Docker containers as `CLAUDE_CODE_OAUTH_TOKEN`.

**Code:** `src/main/sessions/threadAuth.ts` — `readClaudeOauthToken()`

If `CLAUDE_CODE_OAUTH_TOKEN` is set as a host environment variable, it is used directly (useful for CI or non-macOS environments).

### Per-turn token refresh

`readClaudeOauthToken()` is called before every headless `docker exec` turn (not just at thread start). It:
- Returns the cached token if it is still fresh (expires more than 5 minutes away).
- Re-reads the Keychain if the cached token is close to expiry, ensuring long-running sessions never hit a mid-session auth failure.
- The in-memory cache uses the constant `CLAUDE_CODE_OAUTH_TOKEN_ENV` (avoids scattered magic strings across `buildDockerRunArgs` and `buildDockerExecArgs`).

### Codex (OpenAI)

- If `settings.apiKeys.openai` is set: passed as `OPENAI_API_KEY` inside the container.
- Otherwise: AgentOS copies the user's Codex auth files from `~/.codex/auth.json` on the host into `~/.agentos/sessions/<threadId>/` and mounts that directory into the container. If the Codex auth is expired, `refreshCodexAuthIfNeeded()` runs `codex auth --refresh` on the host first.

**Code:** `src/main/sessions/threadAuth.ts` — `seedCodexAuthFromHost()`, `refreshCodexAuthIfNeeded()`

### Gemini (Google)

- If `settings.apiKeys.google` is set: passed as `GOOGLE_API_KEY` inside the container.
- Otherwise: AgentOS copies `~/.gemini/` auth files from the host into the session data directory and mounts them into the container.

**Code:** `src/main/sessions/threadAuth.ts` — `seedGeminiAuthFromHost()`

### Per-project API keys

Project-level config (`.agentos/config.json`) does not support per-project API keys. Keys are global in `AppSettings`.

### No user accounts

AgentOS has no user accounts, login screen, or server-side authentication. It is a local desktop application. All credentials are the user's own CLI credentials.

### Storage hardening

**API key encryption (P0):** `settings.apiKeys.*` values are encrypted at rest via `electron.safeStorage` using serialize/deserialize hooks in `electron-store`. Values stored on disk are opaque blobs decrypted only at read time in-process.

**Cascade deletes:** Deleting a thread removes its associated `session_metrics` and `automation_runs` rows. Deleting a project cascades through all threads and then deletes the project's analytics and memory SQLite files from disk.

**Sensitive file skip:** The memory sync pipeline skips sensitive files (e.g. credential files, `.env` files) during workspace indexing to avoid accidentally embedding secrets.

---

## Background Jobs / Task Queues

### ThreadInputQueue

**File:** `src/main/sessions/ThreadInputQueue.ts`

A per-thread FIFO queue that prevents concurrent execution of user/automation/autopilot inputs. At most one item executes at a time per thread.

Queue item structure:
```ts
{
  threadId: string;
  input: string;
  source: 'user' | 'automation' | 'autopilot';
  timeoutMs: number;
  dropPolicy: 'timeout' | 'never';
  execute: (item) => Promise<void>;
  enqueuedAt: number;
  onDepthChange: (id, depth) => void;
}
```

- **`'never'` drop policy** (default for all sources): items wait indefinitely in the queue. User inputs, automation, and autopilot all use this policy by default.
- **`'timeout'` drop policy** (opt-in): items are dropped if they spend longer than `timeoutMs` in the queue without executing. Only applied when an explicit non-zero `timeoutMs` is passed to `sendInput()` via `options.timeoutMs`.

When a new user message arrives while a headless turn is executing, `ThreadManager.sendInput()` interrupts the running `docker exec` process (kills it) and combines the two messages into a single prompt for the next turn, preserving context.

### AutomationService scheduler

**File:** `src/main/automations/service.ts`

Uses three scheduling mechanisms:
1. **`node-cron`** — for `{ kind: 'cron' }` schedules
2. **`setInterval`** — for `{ kind: 'every' }` schedules
3. **`setTimeout`** — for `{ kind: 'at' }` one-shot schedules

All scheduled tasks are stored in `this.tasks: Map<string, ScheduledHandle>`. The service stops all tasks on `app:before-quit`.

Run status is stored directly on each `AutomationJob` in electron-store (`lastRunAt`, `lastRunStatus`, `lastRunError`, `runCountOk`, `runCountError`). Each execution creates a fresh thread named `⚡ <job.name>` and can attach Slack integration context before dispatching the prompt.

The automation runner waits for completion by subscribing to the internal `message:appended` bus before it calls `threadManager.sendInput()`. That ordering matters because `sendInput()` executes the full turn synchronously enough that the assistant message can be flushed before the promise resolves; registering the listener afterward would miss the completion event and incorrectly hit the 5-minute response timeout.

When the automation job has a previous run (`lastRunAt` is set), the runner prepends a context prefix to the instructions before dispatch: `[Context: last run at <ISO>. Focus on activity since then.]` This gives the agent temporal grounding without modifying the stored instruction text.

**Code:** `src/main/automations/runner.ts`

### Automations list UI

The automations list (renderer) groups jobs by project — each project appears as a collapsible section header. The row-level click feedback animation has been removed (rows no longer scale/flash on click). The template picker has also been removed from the creation form.

**System automations** (e.g. daily personality refresh, daily sandbox image rebuild) are now visible in the automations list with a **System** badge. Users can edit the instructions of system automations; AgentOS reconciles edits on upgrade, preserving user changes. The delete confirmation dialog uses the in-app dialog component instead of the native `confirm()` call; deleting an automation navigates back to the list.

**Webhook trigger:** Automations support a `webhook` trigger type that queues an incoming HTTP payload into the normal execution pipeline (backed by a persistent queue, requires Tailscale Funnel for external access).

---

## Real-Time Communication (IPC & Push Events)

AgentOS uses Electron's IPC system for all communication between main and renderer processes.

### Request/response (invoke)

The renderer calls `window.electronAPI.<domain>.<method>(...)` which calls `ipcRenderer.invoke(channel, payload)`. The main process registers handlers with `ipcMain.handle(channel, handler)`. Every handler wraps its response in `{ ok: boolean, data?: T, error?: string }`.

The preload's `unwrap()` function throws if `ok === false`.

### Push events (one-way from main to renderer)

Main pushes events to the renderer via `BrowserWindow.getAllWindows()[0].webContents.send(channel, payload)`.

**`broadcaster.ts` functions:**

| Function | Event channel | Payload | When |
|---|---|---|---|
| `broadcastTerminalData` | `event:terminal:data` | `{ threadId, data }` | Every PTY output chunk |
| `broadcastStatus` | `event:thread:status` | `ThreadStatusEvent` | Thread state change |
| `broadcastRename` | `event:thread:renamed` | `{ threadId, name }` | Thread renamed |
| `broadcastThreadCreated` | `event:thread:created` | `Thread` | New thread created |
| `broadcastLogEntry` | `event:log` | `AppLogEntry` | New event log entry |
| `broadcastMessageAppended` | `event:message:appended` | `{ threadId, message }` | Structured message finalised |
| `broadcastSandboxImageBuilding` | `event:sandbox:imageBuilding` | `{ progress }` | Docker build progress |

### Renderer subscriptions

The `useAppSync` hook (called once in `App.tsx`) subscribes to all push events on mount and returns unsubscribe functions. Each subscription is cleaned up in the `useEffect` return.

---

## Autopilot Mode

**File:** `src/main/autopilot/service.ts`

Autopilot allows AgentOS to operate a thread autonomously for multiple consecutive turns without human input.

### How it works

After every assistant turn (in `TurnExecutor`), `autopilot.maybeRunAfterTurn(threadId, source)` is called. If autopilot is enabled on the thread:

1. The `ClaudeCodeAutopilotAdapter` runs `docker exec` with a strict system prompt that instructs Claude to return one of three JSON actions:
   - `{ "action": "send_message", "message": "...", "reason": "..." }` — send this as the next user message
   - `{ "action": "stop", "reason": "..." }` — stop autopilot
   - `{ "action": "noop", "reason": "..." }` — wait, do nothing

2. The adapter builds a transcript of the last N messages (`autopilot.transcriptMessages` setting, default 25).

3. If the action is `send_message`, it is enqueued via `sendInput(threadId, message, 'autopilot')`.

4. The consecutive turn counter increments. When it reaches `agents.autopilot.maxConsecutiveTurns` (default 10), autopilot stops with state `'stopped'`.

5. Autopilot stops when the assistant asks for human input, authorization, destructive actions, secrets, or ambiguous product decisions — the system prompt lists these stopping conditions explicitly.

6. Noop, stop, turn-cap, and missing-adapter cases are logged via `eventLogger` for observability.

### Activation

Autopilot is **enabled at thread start** (set in `ThreadLifecycle` when `agents.autopilot.enabled` is true in effective settings). The previous pattern of requiring the agent to call `set_autopilot` via the `agentos-thread` MCP server on its first turn is no longer used for initial activation. Autopilot can still be toggled at any time via `setThreadAutopilot(threadId, enabled)` from the UI.

### States

```
idle → thinking → sent → idle (loop)
                       → stopped (max turns / stop action)
                       → blocked (error)
```

### Personality injection

If a personality profile string is set, it is appended to the autopilot system prompt as "User style profile". This makes generated user-behalf messages follow the configured project style.

### Decision reasoning

When autopilot acts or stops, the reason is surfaced in the UI and in Slack:

- In the chat panel: the `AutopilotThinkingBubble` component renders the last reason beneath the most recent autopilot message (left-aligned, capped at 80% width).
- In Slack: the reason is posted inline as `[reasoning] <text>` or `[noop] <text>` alongside the bot message.

The reason is stored in `thread.autopilotLastReason` and broadcast via `ThreadStatusEvent`.

### Interrupted turns

If a new user input arrives while the autopilot planner is evaluating, autopilot aborts the current planning cycle (`interruptedThreads` flag) to avoid sending a stale follow-up message on top of the user's fresh input.

### Stalled turn recovery

If a headless turn produces no output for 60 seconds (`HEADLESS_STALL_MS`), AgentOS kills the process and re-queues the last input with a recovery message: `"The previous turn stalled. Continue with what you were working on."` The recovery is skipped if the thread has already been interrupted by a new user message.

**Code:** `src/main/sessions/turnExecution.ts`

### Autopilot and Slack

Threads created from inbound Slack messages have autopilot **automatically enabled** at thread creation. The ✅ reaction is deferred until autopilot finishes evaluating after each turn (tracked in `pendingAutopilotChecks` map on `SlackBridge`), ensuring the reaction is posted only once the agent has actually completed its work.

Autopilot behavior in Slack is also gated by global `settings.agents.autopilot.enabled` — if autopilot is globally disabled, Slack threads do not auto-enable it.

### Configurable planner provider and model

The autopilot planner runs a secondary `docker exec` using a separate provider/model that can be configured independently of the thread's own provider. Settings:

- **Global:** `AppSettings.autopilot.plannerProvider` and `AppSettings.autopilot.plannerModel` — applies to all threads without a project override.
- **Per-project:** `kanban.plannerProvider` / `kanban.plannerModel` in `.agentos/config.json`.

The planner provider/model picker uses the shared `ProviderModelBadges` Popover in both the global Settings → Autopilot tab and the per-project settings UI, matching the look of council member configuration.

### Turn configuration

When autopilot is disabled in `AppSettings`, turn configuration controls (max consecutive turns, transcript length) are hidden in the Settings UI.

### UI

- The autopilot toggle is visible in the composer (bottom of `ThreadDetail`) **for all providers** (Claude, Codex, Gemini), rendered as a robot icon.
- A pulsing badge in the thread list indicates when autopilot is in the `thinking` state.
- A robot icon is shown below messages that were posted by autopilot (`source: 'autopilot'`).
- When autopilot is in the `thinking` state, the thread list shows a robot icon instead of the badge.

---

## Slack Integration

**Files:** `src/main/integrations/slackBridge.ts`, `threadMcpServer.ts`, `slackWorkspaces.ts`, `mediumPosters.ts`

### Connection

Uses Slack Socket Mode (`@slack/socket-mode`) — the app connects outbound to Slack's API over WebSocket; no inbound port is needed.

**Required Slack app scopes:** `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`.

**App tokens:** A bot token (`xoxb-*`) is enough for channel discovery and outbound echoing. Socket Mode event ingestion additionally requires an app token (`xapp-*`) and at least one watched channel.

### Message routing

1. Inbound `message` event arrives via Socket Mode.
2. SlackBridge ignores bot/subtype traffic, deduplicates by `channelId:ts`, updates a per-channel cursor, and accepts both `message` and `app_mention` events.
3. Looks up `slackBindings[channelId:threadTs]` to find an existing AgentOS thread.
4. If no binding exists: creates a new thread with `threadManager.createThread()`.
5. Sends the message text to the thread via `threadManager.sendInput(threadId, text, 'user')`.
6. Persists a `slack_thread_bindings` row so `agentos-thread` post tools can save to the Thread view and mirror replies to Slack.

### Coding task approval

Before the agent begins any coding task, it must call `ask_clarification` to confirm the scope with the user. The SlackBridge requires explicit approval from this tool call before allowing the agent to proceed with implementation. Keyword-based command interception from inbound messages has been removed — all task routing goes through the standard agent flow.

### Wake catch-up

On macOS system wake (resume from sleep), SlackBridge performs a catch-up sweep to process any Slack messages that arrived while the system was asleep, using stored `slackChannelCursors`. Catch-up sweeps are throttled to avoid Slack API rate limiting.

### requireMention toggle

When `settings.slack.requireMention = true` (default `false`), the SlackBridge drops new root-thread messages that do not contain an @mention of the bot. Replies in existing bound threads always pass through regardless of this setting. This prevents the bot from responding to all channel noise when deployed in a busy public channel.

The dead settings fields (`commandPrefix`, `agentPrompt`, `postThreadStatusUpdates`, `mcpPort`) have been removed from `SlackSettings` — they were persisted and rendered in the UI but never enforced at runtime.

### Thread MCP messaging tools

Slack-specific MCP posting was folded into `agentos-thread`. Running agents always address the AgentOS thread by `thread_id`; Slack echoing is derived from the persisted binding.

**`post_update(thread_id, message)`**
Saves an update to the in-app Thread view and mirrors it to the bound Slack thread when connected.

**`ask_clarification(thread_id, questions)`**
Saves questions to the Thread view and mirrors them to Slack when connected. The agent should stop and wait for the user to reply. Required before beginning coding tasks.

**`upload_file(thread_id, file_path, filename?, initial_comment?)`**
Attaches a file from `/workspace/.agentos/uploads/` to the Thread view and mirrors it to Slack when connected. Paths outside that upload folder are rejected.

### 🤖 Autopilot message prefix

Messages posted by autopilot on behalf of the user are prefixed with a 🤖 emoji for visual distinction from user-typed messages. Autopilot toggle announcements are no longer posted to Slack threads — toggle state changes are silent.

### ✅ Reaction timing

The ✅ reaction is deferred until autopilot finishes evaluating after the agent's turn completes. This prevents premature reactions when the task is not yet fully done. Pending checks are tracked per thread in `pendingAutopilotChecks` on `SlackBridge`.

### Skill-based task delegation

Skill-based tasks (those matched to a bundled skill) are delegated to a subagent to prevent `post_update` calls from being lost during skill execution.

### Markdown → mrkdwn conversion

Before posting any message to Slack, AgentOS converts standard Markdown to Slack's `mrkdwn` dialect (e.g., `**bold**` → `*bold*`, backtick code blocks, link formatting). This ensures agent output renders correctly in Slack clients.

**File:** `src/main/integrations/slackFormatting.ts`

### Deduplication

Inbound Slack messages are deduplicated by `channelId:ts` using a short-lived in-memory cache (`DedupCache`). This prevents a message from being processed twice if the Socket Mode event is delivered more than once.

### File attachments

When a Slack event includes a file attachment, AgentOS downloads the file via the Slack Web API (using `file.info` to resolve the private URL when not present in the event) and makes it available inside the agent's container. Files uploaded to the chat UI are similarly forwarded to the agent. Resolved worktree paths are used for file placement inside the container.

### Optional updates

If `settings.slack.postAssistantUpdates = true`, AgentOS parses the assistant's output for structured sections (`Final Update:`, `Summary:`, `Questions:`) and posts curated updates to Slack automatically, without the agent needing to call the MCP tool.

> **Note:** `postThreadStatusUpdates` and `mcpPort` have been removed from `SlackSettings` — these were stored and rendered in the UI but never enforced at runtime. Catch-up on startup uses `slackChannelCursors` regardless of any setting.

### Slack task planning

For threads initiated via Slack, AgentOS skips the `EnterPlanMode` prompt step (which asks the agent to plan before coding). These are treated as direct task threads where speed matters over interactive planning.

### Workspace binding

Each Slack channel can be bound to a specific project working directory (`channelWorkspaceMap`). AgentOS uses this to create new threads in the right directory when a message arrives in that channel.

---

## Memory & Embeddings

**Files:** `src/main/memory/`

### Indexing pipeline

When `search()` is called for a project that has not been synced yet (or is dirty from a file change):

1. `syncProject(scope, provider)` scans:
   - `<settings.memory.rootPath>/<projectId>/MEMORY.md` and `memory/*.md`
   - `~/.agentos/messages/<threadId>.jsonl` (session transcripts)
   - Paths in `settings.memory.extraPaths`
   - **Workspace code files** — after the extra-memory-paths pass, `codeChunking.ts` indexes `.ts/.tsx/.js/.jsx/.mjs/.cjs/.py` files from the project workspace directory using web-tree-sitter (lazy WASM init). Each top-level syntax node (function, class, interface, etc.) becomes a semantically coherent chunk rather than naive line-splitting. Files in `node_modules`, `dist`, `build`, and `.git` are skipped; per-file cap is 500 KB. Chunk `source` is `'code'`; IDs follow the pattern `code:<absPath>:<startLine>:<endLine>`.

2. Files are compared against the `files` table by SHA256 hash. Unchanged files are skipped.

3. Changed files are chunked (`chunking.ts`) using **structure-aware chunking**: `---` horizontal-rule delimiters in markdown files are treated as hard chunk boundaries, ensuring semantically coherent sections are never split mid-thought. Remaining content uses overlapping windows (~512 tokens, 20% overlap). Session JSONL files are chunked turn-by-turn (one chunk per assistant turn).

4. Each chunk is embedded via the configured provider (`embeddings.ts`). Results are cached in `embedding_cache` by `(provider, model, hash)`.

5. Chunks and embeddings are written to `chunks` and `chunks_vec`. **Pinned chunks** (set via `memory_pin`) receive a score boost (`pinBoost`) during search and are never evicted by automatic cleanup.

### Session auto-indexing

Session turns are automatically indexed via **LLM-summarized fork chunks**:

- When a thread goes idle, AgentOS auto-triggers the `/save-session-chunk` skill, which produces a distilled LLM summary of the current turn and saves it via `memory_save_chunk`.
- On full reindex (`memory:reindex`), entity extraction runs as a **background task** using the Claude CLI via MCP, allowing the UI to remain responsive.
- Entity extraction is now **inline** in the calling Claude session — there is no separate background process for extraction during normal operation.
- The legacy JSONL session indexing fallback (background Haiku-based chunker) has been removed.

### Entity extraction

Entity extraction is **LLM-powered** (Claude CLI + MCP), replacing the previous regex-based approach.

- During normal operation, extraction runs inline within the agent's own session as it calls `memory_link`.
- During a forced reindex, extraction runs as a background task so it does not block the main thread.
- The `resolveClaude()` result is cached at module load time to avoid repeated `execSync` calls on every chunk save.

### sqlite-vec loading

`checkVecTable` verifies that the `sqlite-vec` extension is actually loadable (not just that the table schema exists). The load result is cached and `checkVecTable` calls are deduplicated to avoid redundant extension loads on each search.

### Search pipeline

1. Query embedding is computed.
2. Cosine distance search on `chunks_vec` returns N candidates.
3. BM25 full-text search on `chunks_fts` returns M candidates.
4. Results are merged by weighted score: vector similarity contributes `vectorWeight`, BM25 rank is converted to a `[0,1]` score and contributes `textWeight`.
5. Temporal decay (`temporal-decay.ts`) multiplies scores by `exp(-λ * ageDays / halfLifeDays)`.
6. MMR re-ranking (`mmr.ts`) maximises both relevance and diversity with parameter `mmrLambda`.
7. Results below `minScore` are filtered out.
8. Top `maxResults` are returned.

### Embedding providers

| Provider | Config value | API endpoint |
|---|---|---|
| Local (llama.cpp) | `'local'` | In-process via `node-llama-cpp` |
| OpenAI | `'openai'` | `https://api.openai.com/v1/embeddings` |
| Google | `'google'` | Vertex AI Embedding API |
| Voyage AI | `'voyage'` | `https://api.voyageai.com/v1/embeddings` |
| Mistral | `'mistral'` | `https://api.mistral.ai/v1/embeddings` |
| Auto | `'auto'` | Selects first provider with a configured API key |

When no provider is configured or no API key is available, AgentOS falls back to FTS-only search (no vector component).

### Startup injection

When a thread starts, AgentOS injects a startup context message that may contain:

- **BOOT.md** — a project-level startup instructions file at `<settings.memory.rootPath>/<projectId>/BOOT.md`. Loaded by default when the file exists.
- **Personality prompt** — if a project personality profile string is set.

Memory search results are **not** injected at startup. Agents access memory on-demand via the `agentos-memory` MCP server (see below). This avoids injecting stale or irrelevant context into every turn.

### Memory panel UI

The `MemoryPanel` has been redesigned with:

- A unified search + explore view (search input, filter by source, inline chunk browsing — no separate tab required).
- A **Sheet slide-over** for chunk detail and health view, keeping the main panel focused.
- **Tailscale-style toggle buttons** for source filter selection.
- A health indicator dot that appears when the doctor has detected issues.
- The search tuning parameters (vector weight, BM25 weight, MMR lambda, etc.) are now configured via a **preset picker** rather than exposed as raw numeric fields.

### Memory inspector

The **Memory Inspector** panel lets users browse all indexed chunks for a project directly in the UI. Features:

- Search and filter chunks by content or source file.
- **Pin** a chunk — pinned chunks receive a score boost in search results and survive automatic cleanup.
- **Edit** chunk content inline and re-embed.
- **Delete** individual chunks.

These operations call `memory_pin`, `memory_delete`, and `memory_save` via IPC handlers backed by the same MCP-level tools.

### Memory health view

A diagnostics sheet (`MemoryPanel` → health icon) surfaces common index problems:

| Issue | Detection |
|---|---|
| Stale file | Source file modified on disk but not yet re-synced |
| Embedding gap | Chunk exists in `chunks` table but has no vector in `chunks_vec` |
| Duplicate chunk | Two or more chunks with identical content hash |

The health view re-runs automatically after a forced reindex (`memory:reindex`).

### Observation layer

The knowledge graph supports an **observation layer** via `assertEntityWithObservation()`: entities (files, symbols, issues, decisions, persons, concepts) can have **factual observations** (1-sentence metadata) attached atomically at upsert time. Entities track `chunkIds` (source session chunks) and timestamps. This allows the graph to accumulate structured facts about entities over time without replacing prior knowledge.

The `GraphQueryEngine` performs BFS traversal up to 2 hops: given a query and top chunk IDs, it seeds entities from file-path mentions and top-chunk associations, then traverses edges to collect related chunks for context boosting.

**Code:** `src/main/memory/graph.ts` — `assertEntityWithObservation()`, `GraphQueryEngine`

### Entities in search hits

`MemorySearchHit` now includes an `entities` field (array of entity names) derived inline during search, allowing callers to see which named entities were associated with a result without a separate graph query.

### Search defaults

- **`min_score` default:** `0.5` (raised from `0.1`). Stop-word-only queries produce vector candidates in the 0.27–0.47 range; the new default cleanly separates this noise floor from legitimate semantic hits. Callers passing an explicit `min_score` are unaffected.
- **`max_results` cap (MCP):** `25` (raised from `20`). The cap applies only to the MCP tool; internal IPC calls are not affected.

### agentos-memory MCP server

Running agents access memory via the `agentos-memory` MCP server (dynamic port). The URL is injected at thread-start via the MCP client config (for Claude: `-c mcp_servers.agentos-memory.url=...`; for Codex/Gemini: a JSON config file passed via `--mcp-config`). The system prompt instructs agents to invoke the `/memory-search` skill instead of calling `memory_search`, `code_search`, or `memory_graph_query` directly — the skill delegates to an Explore subagent that runs all three in parallel, keeping the main context clean and improving result quality.

- Call `memory_search` before answering questions that may have prior context.
- Call `memory_save` when discovering durable knowledge (architecture decisions, deploy steps, conventions).
- Call `memory_save_chunk(summary, text, project_id, thread_id)` to persist a distilled chunk directly to the search index with embeddings. Returns a `chunk_id`. Use for decisions made, bugs fixed, code produced.
- Call `memory_link(entities, edges, chunk_id, project_id, thread_id)` to assert entities (files, symbols, issues, decisions) and relationships (fixes, modifies, depends_on, related_to) into the knowledge graph after a `memory_save_chunk`.
- Call `memory_add_observation(entity, observation, project_id, thread_id)` to add a factual observation to an existing entity without replacing other data.
- Call `memory_graph_query(entity)` to traverse the knowledge graph for a named entity and return connected nodes and edges.
- Call `memory_pin` to protect a chunk from future eviction.
- Call `memory_delete` to remove a specific chunk by ID.
- Call `memory_list_projects()` to retrieve all projects (id, name, path) — useful for cross-project memory queries.

The `/save-session-chunk` bundled skill guides agents through calling `memory_save_chunk` + `memory_link` at the end of each significant turn. It is also auto-triggered on thread idle.

### AgentOSMemoryService internal decomposition

`AgentOSMemoryService` remains the stable IPC/MCP facade (singleton at `src/main/memory/service.ts`). Its internals have been split into focused sub-modules:

| Module | Responsibility |
|---|---|
| `schema.ts` | `SCHEMA_SQL`, `SCHEMA_VERSION`, `EMBEDDING_DIMS` constants |
| `vecSupport.ts` | sqlite-vec loading, `checkVecTable`, `ensureVecTable`, `ensureObsVecTable` |
| `projectDb.ts` | `getProjectDb`, DB cache lifecycle, `runMigrations` |
| `db.ts` | Re-export shim for backwards compatibility |
| `MemoryStatsService` | `projectStatsCache`, `expansionCountsCache`, unified `invalidate()` |
| `MemoryContentService` | save / get / saveChunk / listChunks / delete / update / pin + stats invalidation |
| `MemoryGraphService` | `linkEntities`, `addObservation`, `graphQuery`, `graphAll`, `getEntityChunks` |
| `MemorySyncCoordinator` | configure / warmup, watcher registry, search, reindex |
| `codeChunking.ts` | `listCodeFiles()` + `splitCodeBySymbols()` (Tree-sitter code indexing) |

### memory_get parameters removed

The `from` and `lines` parameters have been removed from `memory_get` and from `MemoryGetRequest`. These fields synthesized a fake chunk ID that was never stored in the database and produced unreliable results. Use `entryId` or `path` to retrieve entries.

### memory_graph_query changes

- Node cap raised from 200 to **2000**.
- Added **type filters** — filter graph results by entity type.
- Added **orphan toggle** — show or hide entities with no edges.

---

## Agent Insights & Cost Dashboard

**Files:** `src/renderer/components/insights/`, `src/renderer/hooks/useInsights.ts`

The Insights tab (visible on a thread once data is available) surfaces per-thread analytics:

| Panel | Content |
|---|---|
| Overview stats | Total tokens, estimated cost, turn count, average turn latency; week-over-week comparison |
| Tool category breakdown | Spider/radar chart for tool categories (replacing stacked bar) |
| Tool call breakdown | Count and success/error rate per tool name |
| Response time | Per-turn latency chart (`TurnMetricChart`) |
| Files touched | Files read or written by the agent with access counts |
| Shell commands | Collapsible list of shell commands run during the session |
| Web activity | Web searches and HTTP fetches with icons |
| Memory section | `memory_search` hit rate, average score, save count; plus a `MemorySavedSection` showing memory saves made during the session |
| Debug viewer | Expandable list of individual tool calls and memory operations with full request/response payloads |
| Year heatmap | GitHub-style activity heatmap showing daily usage over the past year; popover shows enriched day details |

**Cache token tracking:** Daily stats and model breakdowns now separately track `cacheReadTokens` and `cacheCreationTokens` (Anthropic prompt caching) in dedicated `cache_read_tokens` and `cache_creation_tokens` DB columns. The daily cost chart merges with the token chart, showing cache breakdown as distinct segments alongside input and output tokens.

**Memory recall tracking:** `memory_get` call counts are tracked at thread, project, and app level. The memory recall panel groups results by search query, showing input snippets and memory usefulness gaps to surface where memory is underperforming.

**TTFT / streaming metrics:** Time-to-first-token and streaming speed are tracked and surfaced in the Insights panel.

**Tool success rates:** Tool call breakdown now includes success/error rates per tool and a category-level breakdown.

**Weekly insight windows:** Weekly aggregation windows are now derived locally from the all-time daily series rather than issued as separate polling queries, eliminating duplicate API calls.

**Automation run history removed from project insights:** The automation run history section has been removed from the project-level Insights panel; run history is accessible only from the Automations panel. `MemoryActivityBar` has been repositioned to appear adjacent to the success rate and categories charts.

**Provider rate limits:** API probes check current rate-limit status for Codex (via OAuth API) and Gemini (via local JSONL). Rate limit information is surfaced at the **top of the global usage panel** so users can see at a glance whether any provider is currently throttled before sending requests.

**Expand/collapse consistency:** All collapsible sections in the Insights panel now follow the same expand/collapse animation pattern (Radix `CollapsibleContent` + chevron rotation) for visual consistency.

**Local timezone date boundaries:** All date calculations in the analytics pipeline (day/week boundaries, daily rollup timestamps, SQLite `strftime` queries) now use the host's local timezone rather than UTC. A shared `localDateString()` utility in `src/shared/utils/date.ts` is used throughout. Users outside UTC previously saw day boundaries at the wrong hour (e.g. 4 pm–4 pm instead of midnight–midnight).

Project-level insights now use a **donut pie chart** for per-project usage distribution (replacing the per-project bar chart). The global and project insights layouts mirror each other for consistency.

Project-level and global rollup views aggregate data across all threads in a project or across all projects respectively.

The Insights tab is hidden until at least one data point is recorded for the thread, avoiding empty-state clutter.

---

## agentos-thread MCP Server

**File:** `src/main/integrations/threadMcpServer.ts`

A lightweight MCP server (dynamic port, URL injected via the MCP client config at thread start) that allows running agents to modify settings of their own thread at runtime.

**Tool: `set_autopilot(thread_id, enabled)`**
Enables or disables autopilot for the specified thread. Agents use the `AGENTOS_THREAD_ID` environment variable (injected by AgentOS at thread start) to identify themselves. This allows an agent to turn autopilot on or off mid-conversation based on task complexity.

**Tool: `update_personality(agent_style, autopilot_instructions, big_five)`**
Updates the personality profile for the current project at runtime. Accepts `agent_style` (string), `autopilot_instructions` (string), and `big_five` (object with trait scores). All fields are optional; omitted fields are left unchanged.

**Tool: `get_app_settings()`**
Returns the full `AppSettings` object as JSON. Call this before `update_app_settings` to inspect current values.

**Tool: `update_app_settings(patch)`**
Shallow-merges `patch` (a JSON object) into `AppSettings`. The tool description enumerates all patchable top-level keys (scalars and nested objects) so the model knows what is settable without a round-trip.

**Tool: `get_project_config(thread_id)`**
Reads and returns `.agentos/config.json` for the project associated with the given thread.

**Tool: `update_project_config(thread_id, key, updates)`**
Merges `updates` into a top-level key of `.agentos/config.json`. The `version` key is excluded from the mergeable set to prevent corruption. Supported keys: `apiKeys`, `sandbox`, `memory`, `worktree`, `kanban`, `agents`, `containers`, `env`, `personality`, and `recording`.

**Tool: `set_recording_title(recording_id, title)`**
Persists a title to the `recordings` DB row for the given recording ID and renames the linked thread. Used by the `meeting-notes` bundled skill to auto-title recordings after generating notes.

**Tool: `list_project_messages(thread_id, limit?)`**
Lists recent user and assistant messages for the project associated with the given thread. Used by the `personality-refresh` bundled skill to analyze writing style.

---

## Menubar Status Overlay

**File:** `src/main/tray/trayManager.ts`

AgentOS installs a system tray icon on macOS that reflects the aggregate status of all active threads:

- **Idle** — no threads running
- **Active** — at least one thread is processing
- **Error** — one or more threads are in an error state

Clicking the tray icon opens a live popover listing each active thread's name and current status. This allows monitoring long-running automation runs without keeping the main window visible.

The tray icon is a small programmatically-generated PNG that changes colour based on status. Thread status updates are fed to `TrayManager` via the `internalBus` `message:appended` events.

---

## Audio (TTS & STT)

**File:** `src/main/audio/audioService.ts`

### Text-to-Speech

When `settings.voice.ttsEnabled = true`, the renderer's `useAppSync` hook subscribes to `messageAppended` events and calls `window.electronAPI.audio.playTTS(text)` for every new assistant message.

The TTS implementation uses the `audio:playTTS` IPC channel handled in the main process.

⚠️ The specific TTS engine used is not defined in the explored source; the `audioService.ts` implementation details were not read in full.

### Speech-to-Text (transcription)

The `audio:transcribe` IPC channel accepts an `ArrayBuffer` and returns `{ text: string }`. This is used by the `PromptInput` component for voice input.

AgentOS transcribes audio locally using an on-device STT model (`base.en`). The audio is captured as PCM in the renderer (not WebM), encoded to WAV, and passed directly to the model without requiring `afconvert`. The model is downloaded automatically on first use. No cloud STT API is required.

---

## Voice Flow

**File:** `src/main/audio/voiceFlowHotkey.ts`

Voice Flow (renamed from WhisperFlow in #542) provides a global hotkey that triggers local speech-to-text recording without requiring AgentOS to be focused.

### How it works

1. **Global hotkey** — configured via `AppSettings.voice.hotkey`. When pressed, AgentOS starts recording from the microphone regardless of which application is in focus.
2. **Recording overlay** — an always-on-top transparent window appears showing live waveform bars (animated frequency visualization). A Whisper-style chime plays when recording stops.
3. **Tray animation** — while recording in the background, the system tray icon animates. A stop button in the tray popover allows ending the recording without switching to AgentOS.
4. **Transcript routing** — when recording stops, the transcript is routed to one of two destinations:
   - **AgentOS focused**: transcript is sent to the active thread's input, or creates a new thread if none is active.
   - **AgentOS not focused**: transcript is pasted into the active text field of the external application that currently has focus.

### Settings

| Setting | Key | Notes |
|---|---|---|
| Enable/disable | `AppSettings.voice.enabled` | Master on/off switch |
| Hotkey | `AppSettings.voice.hotkey` | Global hotkey string (e.g. `"CommandOrControl+Shift+V"`) |

### Paste to external app

When AgentOS is not the focused application, Voice Flow uses Electron's clipboard + simulated paste (`Cmd+V` / `Ctrl+V`) to insert the transcript into whatever text field the user has focused in another app (e.g. a browser address bar, a terminal, a Slack message box). This makes Voice Flow a system-wide dictation shortcut, not just an AgentOS-internal feature.

---

## Personality Profiles

**File:** `src/main/personality/styleProfile.ts`

A personality profile is a textual style description derived from analyzing a thread's user messages. It is used to make autopilot-generated user-behalf messages match the user's actual communication style.

### Derivation

Profile derivation is handled by the **`/personality-refresh` bundled skill** (`resources/bundled-skills/personality-refresh/SKILL.md`). The skill:

1. Calls `list_project_messages` (on the `agentos-thread` MCP server) to retrieve recent user messages from project threads (up to 200 messages).
2. Analyzes the messages with a writing-style analyst prompt, producing two separate profiles:
   - `agentStyle` — 4–6 line description of how the AI assistant should respond to match the user's preferred style (tone, reply length, notable habits, lexical patterns). Always begins with `"Emulate the user's communication style, not their identity. Stay truthful about being an AI."`
   - `autopilotInstructions` — 2–3 line description of how to craft messages *as* the user when sending on their behalf (phrasing patterns, tone, brevity).
3. If existing profiles are present, a separate update prompt refines both fields based on new messages rather than regenerating from scratch.
4. Stores the result via `update_personality` on the `agentos-thread` MCP server.

Profile derivation is triggered by the **built-in daily automation** (automatically created as a hidden automation in project settings when personality is enabled, runs once per day at noon). The automation now invokes the `/personality-refresh` skill rather than running inline LLM logic. Manual derivation is also available via `thread:derivePersonality`. `ThreadManager.derivePersonalityProfile()` has been removed; derivation is fully delegated to the skill.

The result is stored in `settings.personality`:
```ts
{
  enabled: true,
  agentStyle: "Emulate the user's communication style...",
  autopilotInstructions: "...",
  bigFive: {
    openness: 4,          // 1–5 scale
    conscientiousness: 3,
    extraversion: 2,
    agreeableness: 4,
    neuroticism: 2
  },
  activePresetId: "default",   // 'default' | 'custom' | user-defined preset ID
  sourceThreadCount: 3,
  sampleMessageCount: 42,
  generatedAt: 1720000000000
}
```

### Big Five trait sliders

The Settings UI exposes five personality trait sliders (openness, conscientiousness, extraversion, agreeableness, neuroticism on 1–5 scales) with preset buttons. `traitDescription(trait, value)` converts a numeric value to a human-readable descriptor (e.g., openness 4–5 → "curious, explores unconventional angles"). Presets allow saving and switching named personality configurations.

### Project-level personality config

Personality settings are scoped to the project (`settings.personality` in the per-project config context). The built-in personality refresh automation is a hidden, project-bound automation (stable ID, `personalityRefresh: true` flag) — it is created automatically when personality is enabled for a project and deleted when it is disabled.

### Usage

- **`agentStyle`** is injected into the agent's conversation system prompt (via `buildPersonalityPrompt`) when a project personality profile is set, shaping how the AI assistant responds in chat.
- **`autopilotInstructions`** is appended to the autopilot system prompt when composing user-behalf messages, making autopilot-generated inputs match the user's actual writing style.

Personality settings are accessible in their own dedicated tab/section in the Settings UI (separated from the Agents section). The `autopilotInstructions` field is also directly editable via a textarea in the `PersonalitySection` UI component (`src/renderer/components/project/sections/PersonalitySection.tsx`), allowing quick edits without re-deriving the full profile.

The `update_personality` MCP tool (on the `agentos-thread` MCP server) allows running agents to update the personality profile programmatically — for example, to refine their own style mid-session.

---

## Bundled Skills

**Directory:** `resources/bundled-skills/`

AgentOS ships fourteen built-in Claude Code skills (slash commands). On app startup, `ensureBundledClaudePlugins(homeDir, bundledSkillsDir)` copies these to `~/.claude/plugins/agentos-bundled/skills/`:

| Skill directory | Slash command | Purpose |
|---|---|---|
| `agentos-settings/` | `/agentos-settings` | Allow agent to read/modify AgentOS app settings |
| `council-review/` | `/council-review` | Run a council of multiple LLM provider/model combinations against a prompt and synthesize their answers |
| `diagnose/` | `/diagnose` | Diagnose session tool failures: checks debug log, scans session history, searches memory for prior resolutions, categorises root cause (permission gap, MCP unavailable, deferred tool, bad path, rate limit), and outputs a fix table |
| `docker/` | `/docker` | Docker operations within the container |
| `git/` | `/git` | Git operations and worktree management |
| `github/` | `/github` | GitHub CLI (`gh`) operations |
| `kanban-orchestrator/` | `/kanban-orchestrator` | Drive one kanban task end-to-end — decide the current stage, spawn a stage worker, wait for its result, then advance, retry, or block |
| `meeting-notes/` | `/meeting-notes` | Generate structured meeting notes from a recording transcript; calls `set_recording_title` to auto-title the thread |
| `memory-search/` | `/memory-search` | Delegate `memory_search`, `code_search`, and `memory_graph_query` to an isolated Explore subagent — keeps main context clean and runs all three in parallel |
| `personality-refresh/` | `/personality-refresh` | Analyze recent user messages via `list_project_messages` and update the personality profile |
| `save-session-chunk/` | `/save-session-chunk` | Distil and save a memory chunk from the current turn; calls `memory_save_chunk` + `memory_link` |
| `tailscale/` | `/tailscale` | Tailscale networking within the container |
| `test-webhook/` | `/test-webhook` | Test how an automation job processes a webhook event by enqueuing a sample payload through the real queue pipeline |
| `youtube-summary/` | `/youtube-summary` | Fetch YouTube captions via `youtube-transcript-api` (no ffmpeg required) and produce title, summary, key points, and topics |

Each skill is a `SKILL.md` file (Claude Code plugin format). The copy is idempotent — existing files are not overwritten unless the bundled version changes.

### Provider injection for Codex and Gemini

When a thread uses the Codex or Gemini provider, AgentOS injects the bundled skill definitions and global `CLAUDE.md` content directly into the system prompt (since those providers do not read from `~/.claude/plugins/`). This gives Codex and Gemini sessions access to the same skill guidance that Claude Code sessions get natively.

**Code:** `src/main/sessions/threadLaunchBuilder.ts` — `buildHeadlessSystemPrompt()`

---

## Tailscale Networking

AgentOS supports optional Tailscale integration for exposing services running inside Docker containers to a Tailscale network.

### Configuration

Set `settings.tailscale.authKey` to a Tailscale auth key. Optionally set `settings.tailscale.funnel = true` to expose a port via Tailscale Funnel.

### Container behaviour

If `TS_AUTHKEY` is set in the container environment, the entrypoint script (`resources/entrypoint.sh`):
1. Starts `tailscaled` in userspace networking mode (no `NET_ADMIN` capability required).
2. Runs `tailscale up --authkey=<TS_AUTHKEY> --hostname=agentos-<shortId>`.
3. If `TS_FUNNEL_PORT` is set, enables Tailscale Funnel on that port.
4. Writes the public Funnel URL to `/tmp/tailscale-url`.

The container then executes the AI CLI as normal.

---

## Theming & Dark Mode

AgentOS supports three theme modes: `'dark'`, `'light'`, `'system'`.

**File:** `src/renderer/hooks/useTheme.ts`

The hook reads `settings.theme` from the backend on mount and applies the appropriate class (`dark` or `light`) to the document root. It listens for OS-level `prefers-color-scheme` changes when `theme = 'system'`.

Tailwind CSS v4's dark mode is class-based (`dark:`). All UI components use semantic color tokens (`bg-background`, `text-foreground`, etc.) defined in `src/renderer/styles/globals.css`.

Font size is configurable via `settings.fontSize` (default 14px), applied as a CSS variable to the root element.

### Design system

- **Color tokens** — all color values use OKLch (`oklch(...)`) rather than hex or Tailwind zinc references, providing perceptually uniform colour manipulation across themes.
- **Border radius** — base radius is `0.5rem` (8 px). Tightened from a previous 10 px base to match a denser, more intentional aesthetic.
- **Typography** — Geist variable font is loaded via `@font-face` from bundled font files; no external CDN required.
- **Depth & surfaces** — layered surface backgrounds (`--surface-1`, `--surface-2`) provide visual hierarchy without requiring explicit shadow tokens.
- **Micro-interactions** — buttons scale down slightly on press (`scale-[0.97]`) and use smooth hover transitions; sidebar selection indicators animate in.
- **Primary button accent** — gradient accent applied to primary action buttons.
- **New-thread background** — an animated block grid canvas replaces the previous static dot grid on the new-thread page.

### Color themes

The default color theme is **Violet**. Available themes:

| Theme | Config value |
|---|---|
| Violet (default) | `'violet'` |
| Violet Midnight | `'violet-midnight'` |
| Emerald Slate | `'emerald-slate'` |
| Sunrise Amber | `'sunrise-amber'` |
| Grey | `'grey'` |
| … others | — |

The default color theme constant lives in `src/renderer/hooks/useTheme.ts` as `DEFAULT_COLOR_THEME`.

---

## Wiki Feature

**Files:** `src/main/ipc/handlers/wikiHandlers.ts`, `src/renderer/components/wiki/WikiPanel.tsx`, `src/shared/types/wiki.ts`

Each project has a lightweight built-in wiki stored as Markdown files with frontmatter:

```ts
interface WikiPage {
  id: string;
  title: string;
  content: string;    // markdown
  createdAt: number;
  updatedAt: number;
}
```

Pages are stored at `<projectPath>/wiki/<pageId>.md`. The file begins with a frontmatter block containing `id`, `title`, `createdAt`, and `updatedAt`, followed by Markdown content. The wiki panel in the UI provides a lightweight autosaving editor. Pages are not indexed by the memory system by default and are a separate user-managed knowledge base.

### IPC operations

| Channel | Action |
|---|---|
| `wiki:list` | List all pages for a project |
| `wiki:get` | Fetch a single page |
| `wiki:save` | Create or update a page |
| `wiki:delete` | Delete a page |

---

## Meeting Recording & AI Notes

**Files:** `src/renderer/components/meetings/MeetingRecorder.tsx`, `src/renderer/components/meetings/MeetingPanel.tsx`, `src/main/integrations/recordingsMcpServer.ts`, `src/main/threads/db.ts`

> **Feature flag:** The meeting feature is gated by `FEATURES.MEETINGS` in `src/shared/features.ts`; it currently defaults to `true`. When disabled, the Meetings nav item is hidden from `AppSidebar` and `MeetingPanel` is not rendered by `MainContentRouter`.

Allows users to record meetings and generate structured AI notes automatically. It also supports continuous capture: rolling 5-minute segments can be summarized by selecting a time window.

### Auto-detect browser meetings

AgentOS polls the active browser tab URL at a regular interval and detects when the user enters a Google Meet, Zoom, or Teams meeting. When detected, AgentOS prompts to start recording (or auto-starts if configured). This removes the need to manually trigger recording from within AgentOS.

### Recording pipeline

1. **Audio capture** — `MeetingRecorder` uses the Web Audio API (`ScriptProcessorNode`) to capture raw PCM from the microphone. System audio (for loopback capture) is optionally mixed in via `getDisplayMedia` / Electron `desktopCapturer` (`desktop:getSources` IPC channel); AgentOS falls back to mic-only if Screen Recording permission is absent.
2. **Encoding** — PCM samples are encoded to WAV in the renderer.
3. **Fire-and-forget processing** — when recording stops, transcription, DB persistence, and thread creation all happen in a background task. The recording tab shows in-flight status rather than blocking the UI. The user can switch to other threads while processing completes.
4. **Transcription** — the `audio:transcribe` IPC channel transcribes the WAV locally using an on-device STT model (`base.en`).
5. **Storage** — the recording and transcript are persisted to the `recordings` table in the threads SQLite DB (`src/main/threads/db.ts`).
6. **Note generation** — the bundled `meeting-notes` skill (`resources/bundled-skills/meeting-notes/SKILL.md`) generates structured notes (title, summary, decisions, action items, open questions) from the transcript. The skill calls `set_recording_title` (on `agentos-thread` MCP) to auto-title both the recording row and the linked thread.
7. **Follow-up** — the resulting thread is a fully normal AgentOS thread; users can ask follow-up questions in the chat pane.

### agentos-recordings MCP server

**File:** `src/main/integrations/recordingsMcpServer.ts` — dynamic MCP port

Exposes recording and window-transcript tools to running agents:

**`get_recording_meta(recording_id)`**
Returns metadata (title, status, created_at, thread_id) for a recording.

**`get_transcript(recording_id)`**
Returns the full transcript text for a recording.

**`list_recordings(limit?, offset?)`**
Lists manual recordings, newest first.

**`list_segments(from, to)`**
Lists continuous-capture segments overlapping a selected time window.

**`get_window_transcript(from, to)`**
Returns the merged transcript for all continuous-capture segments overlapping the selected window.

### Recording pill

A bottom-left pill indicator persists across tab switches to track the active recording thread. This allows the user to navigate away from the meeting thread without losing track of an ongoing or just-completed recording.

### Recording templates

The meeting notes prompt template is configurable. Multiple templates are supported:

- **Global templates** — stored in `AppSettings.recording.templates: RecordingTemplate[]`. Configurable in Settings → Recording.
- **Per-project templates** — stored in `ProjectConfig.recording.templates`. Configurable in Project Settings → Recording.
- **Active template** — set via `recording.activeTemplateId`. When `undefined`, the built-in default template is used.

```ts
interface RecordingTemplate {
  id: string;
  name: string;
  content: string; // the structured-notes prompt injected into the meeting thread
}
```

Per-project templates take precedence over global templates when both are defined.

### UI

- The past-meetings sidebar has been removed. Recordings are accessible as ordinary AgentOS threads (identified via the `recordings` table link).
- `MeetingRecorder` shows a pulsing recording indicator, elapsed timer, and start/stop controls.
- `AppShell` keeps the panel mounted when a meeting thread is selected so `ThreadDetail` renders inside the panel.
- A **Recording** section in Project Settings lets per-project templates be created, edited, and selected.
- A **Recording** tab in the global Settings modal manages global templates.

---

## Sandbox Domain Allowlist

**Files:** `src/main/proxy/filteringProxy.ts`, Settings → Sandbox → "Domain Allowlist"

When enabled, AgentOS runs a host-side HTTP/HTTPS filtering proxy and restricts which domains container agents can reach.

### Configuration

Enable via Settings → Sandbox and add domains to the allowlist (one per line; wildcards like `*.anthropic.com` are supported). The setting maps to `settings.sandbox.allowedDomains: string[]`.

### How it works

1. AgentOS starts a `FilteringProxy` HTTP server on a random host port when `allowedDomains` is non-empty.
2. `buildDockerRunArgs` injects `HTTP_PROXY=http://host.docker.internal:<port>` and `HTTPS_PROXY=...` into every container.
3. For HTTPS, the proxy handles CONNECT tunnel requests — allowed hosts get a tunnel, blocked hosts get a 403.
4. For plain HTTP, the proxy forwards allowed requests and blocks others.
5. The allowlist is evaluated live on each request; changes in Settings take effect immediately without restarting containers.

**Purpose:** Mitigates context-injection / exfiltration attacks where a malicious webpage or file could instruct the agent to POST data to an attacker-controlled host.

---

## Sandbox Seccomp Profile

**File:** `resources/seccomp-sandbox.json`

AgentOS applies a custom Linux seccomp (Secure Computing Mode) profile to Docker containers to restrict the syscalls available to AI agents.

### Profile

The profile (`seccomp-sandbox.json`) uses a default action of `SCMP_ACT_ERRNO` (return an error) and allows only the syscalls explicitly needed by the AI CLIs and standard Unix tools. Key exceptions:

- **`clone3` → `ENOSYS`** — returns `ENOSYS` (not `EPERM`) so that glibc's `fork()` can fall back to the older `clone` syscall automatically without crashing. Without this, processes using glibc 2.34+ would fail to fork inside the container.
- Dangerous syscalls (`kexec_load`, `ptrace`, `mount`, `setns`, `unshare`, `pivot_root`, etc.) are blocked entirely.

### How it is applied

`buildDockerRunArgs` passes `--security-opt seccomp=<path>` using the bundled profile path from `app.getAppPath()`. The profile is bundled in `resources/` and shipped with the app; it cannot be user-edited at runtime.

**Purpose:** Defense-in-depth against container breakout attempts via kernel-level attack vectors.

---

## Kanban Multi-Agent Orchestration

**Files:** `src/main/kanban/`, `src/renderer/components/board/`, `src/shared/types/kanban.ts`

The Kanban board enables fully autonomous multi-agent workflows where specialist AI threads collaborate on a project without human dispatch.

### Enabling the board

Set `kanban.enabled = true` in `.agentos/config.json`. The Board tab then appears on the project's `ProjectDetail` view. The board is also gated by the `FEATURES.KANBAN` compile-time flag in `src/shared/features.ts`.

### Pipeline

Tasks flow through a 6-stage pipeline: `backlog → researching → planning → implementing → reviewing → done` (plus `blocked` and `archived`).

- **Backlog**: landing zone for new tasks. The coordinator thread is **not** spawned until a task moves out of `backlog` for the first time. This keeps the board clean during triage.
- **Researching → Planning → Implementing → Reviewing → Done**: the active work stages, each seeded with a configurable agent prompt.
- **Archived**: terminal state for completed tasks that have been cleared from the board. Tasks auto-archive 5 days after moving to `done` (a background hourly sweeper handles this); users can also archive manually via the `archive_task` MCP tool or per-row action in list view. Archived tasks appear in a collapsed section at the bottom of list view and are hidden from the kanban columns.

**Task types removed (schema migration 0004):** `KanbanTaskType` (`dev | research | review | refine`) has been removed from the task model and DB. All tasks are now generic. The `saveToMemory` flag on each `KanbanStage` replaces the old task-type-based auto-save: when true, the event router saves the stage's output to memory after completion (previously triggered only for `research`-type tasks).

**Stage configuration** (schema v11): Pipeline stages are stored in the `kanban_stages` DB table (`id`, `label`, `prompt`, `save_to_memory`, `order`, `projectId`). The `description` column has been dropped; the full agent prompt is now stored in `prompt` and exposed directly via `update_stage`. Default stages (`backlog → researching → planning → implementing → reviewing → done`) are seeded per project on first access. Stages are configurable via the project settings UI or the `list_stages`/`update_stage` MCP tools. The `agentRole` field has been removed from `KanbanStage`; role is resolved live from the DB on each task move.

### Coordinator thread

`KanbanCoordinatorService.ensureCoordinator(projectId, workingDirectory)` creates a persistent coordinator thread (autopilot always on) that:
- Lists the board via `list_tasks`.
- Moves tasks through the pipeline based on their readiness.
- Calls `create_task` / `assign_task` as needed.
- Responds to `[KANBAN EVENT]` messages broadcast by `eventRouter.ts` when tasks change status.

The coordinator prompt can be overridden per-project in `.agentos/config.json` under `kanban.agents.coordinator`.

### Specialist threads

When a task enters `in_progress`, the coordinator spawns a specialist thread via `KanbanCoordinatorService.spawnSpecialist()`:

- **Dev agents** get an isolated git worktree (`feature/<slug>-<taskId[:8]>`); the branch name is stored on the task record.
- **Refiner, reviewer, researcher** agents can be reused across tasks if they have overlapping `skillTags` and are currently idle (status `stopped`).
- All specialists have autopilot enabled and begin work by consuming the injected task context prompt.

### Class of service

Each task has a `classOfService` field: `'expedite' | 'standard' | 'intangible'`.

- **Expedite** tasks bypass WIP limits and are rendered in a fixed swimlane above all board columns, making them immediately visible regardless of stage.
- **Standard** (default) tasks respect WIP limits and flow through the normal pipeline.
- **Intangible** tasks represent non-feature work (tech debt, tooling) and are visually de-emphasized.

### Inter-task dependency graph

Tasks can declare dependencies on one another via the `kanban_task_deps` table (schema v17). The coordinator can detect transitive blocks and surface them via the `get_blocked_tasks` tool.

| MCP tool | Description |
|---|---|
| `add_dependency(from_task_id, to_task_id)` | Declares that `from_task_id` depends on (is blocked by) `to_task_id` |
| `get_blocked_tasks(task_id)` | Returns all tasks transitively blocked by the given task |

### Due dates & SLA badges

Tasks have an optional `dueAt: number | null` field (unix ms). The board renders SLA badges on overdue tasks. The `list_overdue_tasks` MCP tool returns all tasks past their due date for the coordinator's triage.

### Slack context propagation

When a Kanban task is initiated from a Slack message, the originating Slack `channelId` and `threadTs` are propagated to the task's main thread. This allows stage workers to post progress updates directly back to the Slack thread that created the task.

### WIP limits

`kanban_wip_limits` rows cap how many tasks can be in a given status simultaneously. The `KanbanService` enforces limits before accepting a `move` operation. Expedite tasks bypass WIP limit checks.

### AgentOS Kanban MCP server

Agents communicate with the board through the AgentOS Kanban MCP server (dynamic port, URL injected via `ARC_KANBAN_MCP_URL` env var). Tools:

| Tool | Description |
|---|---|
| `list_tasks` | List all tasks, optionally filtered by status |
| `create_task` | Create a new task with title, description, priority, type, skill tags |
| `move_task` | Move a task to a new status with an optional reason |
| `assign_task` | Assign a task to a specific thread ID |
| `update_progress` | Set task progress (0–100) with an optional note |
| `add_note` | Append a note (agent reasoning, review findings, research report) to a task |
| `list_stages` | List pipeline stages for a project |
| `update_stage` | Update label, description, or agent_role for a stage |
| `list_overdue_tasks` | List all tasks past their `dueAt` date |
| `add_dependency` | Declare a dependency between two tasks |
| `get_blocked_tasks` | Return all tasks transitively blocked by a given task |
| `archive_task` | Move a task to `archived` status (any task can be archived) |
| `spawn_stage_worker` | Spawn a stage worker thread for a task (managed by `StageWorkerService`) |
| `report_stage_result` | Report the result of a completed stage worker (success/failure + notes) |

### Board redesign (P1–P15, Linear+Multica style)

**P1–P3 — Task card and slide-over redesign:**
- `TaskCard` fully redesigned: status dot, priority badge, due-date chip, agent avatar, WIP fraction.
- Inline pickers on the card: `PriorityPicker` (popover with keyboard support), `DueDatePicker` (local-timezone-aware), `AgentAssignPicker` (per-role avatar colors match `AgentAvatar`).
- `TaskSlideOver` uses a two-column sheet layout (left: properties + git diff; right: activity + notes).

**P4 — Live agent execution indicator:**
Cards show a pulsing live-execution indicator while the assigned agent thread is in the `running` state.

**P5 — Configurable card display preferences:**
`DisplayOptionsPopover` in `CoordinatorBar` provides 8 card-field toggles and 2 column-field toggles persisted per project in localStorage (key `agentos.kanban.cardPrefs.<projectId>`). Fields include: description preview, task ID, due date, progress bar, subtask count, agent avatar, class-of-service badge, notes count. Task count and WIP fraction per column are similarly prefs-gated (always shown in red when at limit). `CardPrefsContext.tsx` exports `CardDisplayPrefs`, `CardPrefsProvider`, and `useCardPrefs`.

**P6 — Blocked as first-class column:**
`BLOCKED_COLUMN_ID` is a dedicated column that appears at the far left of the board. Dragging a task into it sets `status='blocked'`; dragging out removes the block dependency. A `'__manual__'` sentinel distinguishes manually-blocked tasks from dependency-blocked ones; the `TaskPropertiesSidebar` renders a "Manually blocked" pill for this case. `boardStore.tasksByStatus` builds the blocked array in a single pass.

**P7 — Subtask progress badge:**
Cards show a `X/N` badge (e.g., `2/5 ✓`) reflecting subtask completion. `list_subtasks` MCP tool count drives the badge. Badge is prefs-gated.

**P8 — Activity timeline redesign:**
The sheet's activity panel now shows structured event cards (move events, notes, review verdicts, blockers) with avatars, timestamps, and collapsible detail. Replaces the flat chronological list.

**P9 — List view:**
`BoardListView` renders a compact table with columns: checkbox, status dot, title, priority, assignee, due date, progress. Toggled via a view-switcher in `CoordinatorBar`. Prefs from `CardPrefsContext` control which columns are visible.

**P10 — Batch operations:**
Multi-select via `SelectionCheckbox` on each card. `BatchActionBar` (sticky bottom bar) appears when `selectionActive = true` and offers: bulk move to status, bulk assign agent, bulk delete. Selection state lives in `boardStore`.

**P11–P15 — UI primitive extraction:**
Reusable primitives extracted from board components: `SelectionCheckbox`, typed `ToggleGroup` guard, `PropGroupHeader` (title + count; API unchanged across 8 call sites), shared `applyPriority` callback in `PriorityPicker`. `TaskPropertiesSidebar` drops `Collapsible*` / `CaretRight` imports; git-summary section uses `DisclosureSection`.

### Stage config — ProviderModelBadges

The stage provider/model configuration in the project settings and the kanban stage editor now uses the shared `ProviderModelBadges` Popover (matching the provider priority list and council member form) instead of inline `<Select>` dropdowns for provider, model, effort, and reasoning fields.

### Stage approval gate

After the `planning` stage completes, the kanban-orchestrator skill instructs the coordinator to call `ask_clarification` to post the plan summary (including a **high-level plan** — ordered steps at the component/module level, no code) to Slack and wait for user confirmation before implementation begins. If the user approves, the coordinator advances to `implementing`. If they request changes, the coordinator retries the planning stage (up to two retries).

This is entirely coordinator-prompt behavior in `kanban-orchestrator/SKILL.md` — no new MCP tools, IPC channels, or DB state changes.

### Task sheet

`TaskSlideOver` (`src/renderer/components/board/TaskSlideOver.tsx`) has been upgraded to a Sheet-based two-column task detail panel. Content is loaded asynchronously by the `useTaskSheetDetails` hook (`src/renderer/components/board/useTaskSheetDetails.ts`), which fetches events, subtasks, and a live git diff summary (`getTaskGitSummary` from `src/main/utils/worktree.ts`).

The sheet provides:
- **Activity timeline** — redesigned (P8) structured event cards for moves, notes, review/blocker changes.
- **Git summary** — live `git diff --name-status` via `getTaskGitSummary`; returns `baseRef`, `totalChangedFiles`, and a `changedFiles` list.
- **Review/blocker cards** — `TaskDecisionComposer` (`src/renderer/components/board/TaskDecisionComposer.tsx`) allows posting review verdicts and setting/clearing blocker state. Review and blocker events are stored as first-class kanban events (not inferred from move history).
- **Comment composer** — free-form notes attached to the task.

`taskSheetUtils.ts` (`src/renderer/components/board/taskSheetUtils.ts`) summarizes explicit review/blocker events with fallback to move history when no explicit event is present.

---

## Council Multi-Provider Dispatch

**Files:** `src/main/council/service.ts`, `src/main/mcp/councilMcpServer.ts`, `src/shared/types/council.ts`

A Council is a saved configuration consisting of a name and a list of members, where each member is a `(provider, model)` pair. When dispatched, AgentOS runs the same prompt across all members simultaneously in isolated child sub-threads, then synthesizes their outcomes via a judge prompt.

### Flow

1. User dispatches a council prompt from the UI or via IPC.
2. `CouncilService` (`src/main/council/service.ts`) spawns one child sub-thread per council member in parallel. Each child thread carries `parentThreadId` and `councilRunId` fields linking it back to the council run.
3. Each child thread receives the `agentos-council` MCP server in its MCP config. When the child has a result, it calls the `council_submit_outcome` MCP tool.
4. `CouncilService` receives the submission and kills the child process immediately (first submission per child wins; subsequent calls are ignored).
5. Once all outcomes are collected (or a timeout is reached), the judge prompt is dispatched to synthesize the outcomes into a unified answer.
6. The synthesized result is broadcast to the renderer.

Child threads stream live output using the `stream-json` output format.

### Settings

Councils are managed in Settings → Council tab, implemented by the `CouncilDraftForm` component (`src/renderer/components/settings/CouncilDraftForm.tsx`) and the `useCouncilConfigs` hook (`src/renderer/hooks/settings/useCouncilConfigs.ts`). 7 IPC channels handle council CRUD operations.

**Member selection UI:** The per-member provider/model/effort/reasoning form now uses the shared `ProviderModelBadges` Popover pill (matching the ProviderPriorityList and Kanban stage config), replacing inline `<Select>` dropdowns. Changing the provider clears effort and reasoning fields automatically.

**Types:** `CouncilConfig`, `CouncilRun`, `CouncilMember`, `OutcomeRecord`, `Synthesis` — defined in `src/shared/types/council.ts`.

### Synthesis enqueue fix

Previously, the judge synthesis turn was only enqueued when the council run transitioned to `complete` status and an autopilot check was pending. This caused synthesis to be silently dropped in headless/automated contexts. `CouncilService` now calls `threadManager.sendInput` to enqueue the synthesis turn directly on council completion, independent of any pending autopilot state.

### UI

Council runs are surfaced in the chat thread UI:

- **Thread list sidebar** — child sub-threads appear as expandable rows nested under their parent thread, grouped by council run. The expand caret is at the row end. Each child shows its provider/model badge and live status.
- **Council run detail sheet** — clicking a council run opens a Sheet slide-over (`CouncilRunDetail`) showing each member's outcome, the synthesized result, and run metadata. Replaces the previous inline expand pattern.
- **Chat message** — once synthesis completes, the result is posted as an assistant message in the parent thread's chat pane so the user can follow up conversationally.
