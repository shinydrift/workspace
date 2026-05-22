# AgentOS — Project Overview

## Table of Contents

- [Summary](#summary)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Glossary](#glossary)

---

## Summary

**AgentOS** is a macOS-first Electron desktop application that provides a unified graphical control plane for AI coding assistants — Claude Code (`@anthropic-ai/claude-code`), OpenAI Codex (`@openai/codex`), and Google Gemini CLI (`@google/gemini-cli`). Each conversation ("thread") runs inside an isolated Docker container, keeping filesystem access, network reach, and credentials scoped to a single session. AgentOS adds project management, persistent vector memory, scheduled automations, Slack integration, an autopilot mode, and a project wiki on top of these CLIs without replacing or wrapping them.

The target user is a developer or technical team that wants to delegate recurring engineering tasks — code reviews, dependency bumps, changelog generation — to AI agents that operate in reproducible, sandboxed environments while remaining observable and interruptible at any time from a desktop UI.

---

## Key Features

- **Multi-provider threads** — five harness backends are supported: **Claude Code** (headless `--headless` stream-JSON mode), **claude-interactive** (Claude Code as a persistent interactive TUI — long-lived PTY session driven by a JSONL watcher, preserving full conversation state across turns), **OpenAI Codex** (`@openai/codex`), **Google Gemini CLI** (`@google/gemini-cli`), and **Pi** (`@earendil-works/pi-coding-agent`, with session resumption via `--session <id>`). The `claude` and `codex` harnesses additionally support **Ollama** and **OpenRouter** as API backends, routing calls to a local inference server or cloud aggregator via `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` env vars. Harness and backend are switchable per-project via config or UI.
- **Always-on Docker sandbox** — every thread runs inside `agentos-session-<threadId>` Docker containers; security settings (capabilities, network mode, memory, PIDs limit) are configurable per project. An optional domain allowlist is enforced via a host-side HTTP/HTTPS filtering proxy (no container root or `NET_ADMIN` capability required).
- **Persistent hybrid memory** — project knowledge is stored in per-project SQLite databases with both vector (cosine) search and BM25 full-text search; available to agents via an MCP server that runs inside the host. Entity extraction is LLM-powered (Claude CLI + MCP). Session turns are auto-indexed via LLM-summarized fork chunks triggered on thread idle. **Tree-sitter code indexing** indexes workspace source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs/.py`) by top-level symbol (function, class, interface, etc.) using web-tree-sitter with lazy WASM init; chunk IDs are `code:<absPath>:<startLine>:<endLine>`. The Memory panel features a unified search/explore view with Sheet slide-overs and a preset picker for search tuning. Default `min_score` is **0.5** (raised from 0.1 to filter low-confidence noise); `max_results` cap is **25** (raised from 20). The system prompt instructs agents to invoke the `/memory-search` skill (which delegates to an Explore subagent) instead of calling `memory_search`, `code_search`, or `memory_graph_query` directly. The `memory_list_projects` MCP tool returns all projects with id/name/path.
- **Scheduled automations** — define cron, interval, or one-shot jobs that send instructions to a thread; results are logged and optionally notified via Slack. **System automations** (e.g. daily personality refresh, daily sandbox image rebuild) are visible in the automations list with a **System** badge and can have their instructions customized by the user; AgentOS reconciles edits on upgrade without overwriting them.
- **Autopilot mode** — a secondary Claude planner decides whether to send the next user-behalf message after each assistant turn, enabling multi-turn autonomous task completion with a configurable maximum consecutive-turn limit (default 10). Autopilot is enabled at thread start when `autopilot.enabled` is true; visual indicators include a pulsing badge in the thread list, a robot icon below autopilot-posted messages, and an inline reasoning bubble showing the last decision. Stalled turns (no output for 60s) are auto-recovered. Toggle is available in the composer for all providers. The **planner provider and model** are configurable independently of the thread's own provider (per-project in `.agentos/config.json` or globally in Settings → Autopilot).
- **Slack integration** — inbound Slack messages trigger thread creation; the agent can post progress updates and ask clarification back into the Slack thread via an MCP server. Supports file attachments; agent output is converted from Markdown to Slack's mrkdwn format automatically. Coding tasks require explicit `ask_clarification` approval before proceeding. Catches up missed messages on system wake. Optional **requireMention** toggle (`SlackSettings.requireMention`) drops new root-thread messages that do not contain an @mention of the bot; replies in existing threads always pass through.
- **Per-project Git worktrees** — each thread gets its own git worktree for filesystem isolation within the project repo.
- **Kanban multi-agent board** — a project-level Kanban board (gated by `FEATURES.KANBAN` compile-time flag and `kanban.enabled` project setting) with a 6-stage pipeline (`backlog → researching → planning → implementing → reviewing → done`) coordinated by a persistent coordinator thread backed by an AgentOS Kanban MCP server. **Backlog**: new tasks land here; the main thread is deferred until a task is moved out of backlog. Task types have been removed — all tasks are generic; `saveToMemory` is a per-stage flag (replaces the old research-task auto-save). **Task archiving**: done tasks can be archived manually (`archive_task` MCP tool) or automatically 5 days after completion; archived tasks appear in a collapsed section at the bottom of list view. **Board UI (Linear+Multica style):** redesigned task cards with inline priority/due-date/agent pickers, live agent execution indicator, subtask progress badge, configurable card display fields (Display popover, persisted per project in localStorage), list view alternative, batch multi-select operations (bulk move/assign/delete), and Blocked as a first-class column. Stage config uses ProviderModelBadges Popover for provider/model selection. Stage labels and agent prompts stored in the kanban DB (`kanban_stages` table) and configurable via the project settings UI or `list_stages`/`update_stage` MCP tools. **Class of service** (`expedite | standard | intangible`) allows expedite tasks to bypass WIP limits and appear in a fixed swimlane above all columns. **Inter-task dependency graph** (`kanban_task_deps` table) with `add_dependency` and `get_blocked_tasks` MCP tools lets the coordinator detect transitive blocks. **Due dates** (`dueAt` on tasks) with SLA badges and `list_overdue_tasks` MCP tool. **Stage approval gate** lets a coordinator-driven stage worker pause and require human sign-off before advancing to the next stage.
- **Council multi-provider dispatch** — define a named council of provider/model members; dispatch a prompt and AgentOS spawns parallel child sub-threads that each run independently and submit their outcome via a `council_submit_outcome` MCP tool. Results are synthesized by a judge prompt into a unified answer. Councils are managed in Settings → Council tab.
- **Voice Flow** — global hotkey triggers local voice recording; transcript routes to the active AgentOS thread when AgentOS is focused, or is pasted into the active text field of any external app when AgentOS is not focused. An always-on-top overlay shows live waveform bars and plays a chime on stop. Tray icon animates during background recording and provides a stop button. File: `src/main/audio/voiceFlowHotkey.ts`. Settings: `AppSettings.voice.hotkey`, `AppSettings.voice.enabled`.
- **Meeting recording & AI notes** — record meetings directly in the browser tab (auto-detected via Google Meet / Zoom / Teams URL polling), transcribe locally on-device via fire-and-forget background processing, and auto-generate structured notes via the bundled `meeting-notes` skill which also auto-titles the thread. Recordings are persisted to a `recordings` table in the threads DB and are accessible to agents via the `agentos-recordings` MCP server (dynamic port). A bottom-left recording pill persists across tab switches to track the active recording thread. The past-meetings sidebar has been replaced by standard threaded recordings. *Feature-flagged; disabled by default. Enable by setting `FEATURES.MEETINGS = true` in `src/shared/features.ts`.*
- **Auto-update** — packaged builds (macOS arm64 only) automatically check for new releases via GitHub Releases using `update-electron-app` and apply updates on next restart. Only one AgentOS instance can run at a time; a second launch brings the existing window to focus.
- **Project wiki** — lightweight per-project wiki pages stored as Markdown files in a project-local `wiki/` directory, editable in the UI.
- **Menubar status overlay** — a system tray icon and live popover show active thread status at a glance without bringing the main window into focus.
- **Agent Insights & Cost Dashboard** — per-thread and project-level analytics: token usage, cost, tool call breakdown (stacked bar), memory hit rates, files touched, shell commands run, web activity, and response times.
- **Memory inspector** — browse, pin, edit, and delete individual memory chunks directly from the UI; a health view surfaces stale files, embedding gaps, and duplicate chunks.
- **File attachments** — users can attach files to chat messages; attachments are forwarded into the container and, for Slack-sourced threads, downloaded automatically from Slack's API.
- **Resizable sidebars** — all secondary panels (threads, wiki, memory, automations) support drag-to-resize.

---

## Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Desktop shell | Electron | 40.6.0 | Main + renderer + preload processes |
| Build system | Electron Forge + Vite | 7.x / 7.x | `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.mts` |
| UI framework | React | 19.2 | Renderer process only |
| UI state | Zustand | 5.0 | `domainStore`, `uiStore`, `logsStore` |
| Styling | Tailwind CSS v4 + shadcn/ui primitives | 4.2 | Radix UI headless components |
| Language | TypeScript | 5.9 | Strict mode; shared types in `src/shared/types/` |
| Persistence | electron-store | 10.1 | JSON file in Electron's user-data dir, overrideable via `AGENTOS_STORE_DIR` |
| Memory DB | better-sqlite3 + sqlite-vec | 12.6 / 0.1.7-alpha | One SQLite file per project in `~/.agentos/memory/projects/` |
| Terminal emulator | node-pty + xterm.js | 1.1 / 6.0 | PTY per thread inside Docker |
| Containerisation | Docker (host daemon) | n/a | Containers managed via `docker run` / `docker exec` CLI calls |
| Scheduling | node-cron | 4.2 | Automation scheduler |
| MCP servers | @modelcontextprotocol/sdk | 1.27 | Memory, Slack, execution-log MCP servers |
| Slack SDK | @slack/socket-mode + @slack/web-api | 2.0 / 7.14 | Socket Mode for real-time events |
| Local embeddings | node-llama-cpp | 3.17 | Optional; used when `embeddingProvider = 'local'` |
| Flow builder UI | @xyflow/react | 12.10 | Automation visual flow builder |
| Markdown rendering | marked + highlight.js | 17.0 / 11.11 | Chat message rendering |
---

## Repository Structure

```
agentos/
├── index.html                    # Renderer HTML entry point (Vite injects bundle)
├── package.json                  # npm manifest; scripts: start, test, lint, package, make
├── tsconfig.json                 # TypeScript config (paths, strict)
├── forge.config.ts               # Electron Forge packaging config (makers, plugins)
├── vite.main.config.ts           # Vite config for the main (Node) process
├── vite.preload.config.ts        # Vite config for the preload script
├── vite.renderer.config.mts      # Vite config for the renderer (React)
├── Dockerfile.agentos                # Per-project override Dockerfile (user-editable)
│
├── src/
│   ├── main/                     # Electron main process (Node.js)
│   │   ├── index.ts              # App bootstrap: window creation, service start
│   │   ├── sessions/             # Core: ThreadManager, PTY, Docker lifecycle
│   │   │   ├── ThreadInputService.ts        # sendInput routing, enqueue policy, interrupt semantics
│   │   │   ├── CouncilChildThreadService.ts # spawns council child threads
│   │   │   └── StageWorkerService.ts        # spawns Kanban stage worker threads
│   │   ├── audio/
│   │   │   └── voiceFlowHotkey.ts           # global hotkey → local voice recording → transcript routing
│   │   ├── automations/          # Automation scheduler, runner, execution log MCP
│   │   ├── autopilot/            # Autopilot planner service + Claude adapter
│   │   ├── config/               # Project config loader, OAuth config
│   │   ├── health/               # Health check service
│   │   ├── integrations/         # Slack bridge, MCP servers
│   │   │   └── recordingsMcpServer.ts       # agentos-recordings MCP server (dynamic port)
│   │   ├── ipc/                  # IPC handler registration and per-domain handlers
│   │   ├── kanban/               # Kanban multi-agent orchestration (coordinator, db, service, MCP)
│   │   ├── memory/               # Hybrid memory (SQLite, embeddings, sync, search)
│   │   │   └── codeChunking.ts              # Tree-sitter code indexing (listCodeFiles, splitCodeBySymbols)
│   │   ├── normalizers/          # Provider-specific output → structured Message normalizers
│   │   │   └── codex/                       # Codex normalizer decomposed into event-family helpers
│   │   ├── personality/          # Style profile derivation from thread messages
│   │   ├── proxy/                # Host-side HTTP/HTTPS filtering proxy (filteringProxy.ts)
│   │   ├── store/                # electron-store wrapper and settings events
│   │   └── utils/                # Docker sandbox, image manager, cleanup, worktree, etc.
│   │
│   ├── preload/
│   │   └── index.ts              # contextBridge: exposes typed `window.electronAPI`
│   │
│   ├── renderer/                 # React application (browser context)
│   │   ├── index.tsx             # ReactDOM entry point
│   │   ├── App.tsx               # Root component
│   │   ├── store/                # Zustand stores (domain, ui, logs)
│   │   ├── hooks/                # Custom React hooks (useAppSync, useMessages, etc.)
│   │   ├── components/
│   │   │   ├── automations/      # Automation list, flow builder, run history
│   │   │   ├── board/            # Kanban board (BoardView, BoardColumn, TaskCard, TaskSlideOver)
│   │   │   ├── chat/             # MessageList, MessageBubble, ToolCard
│   │   │   ├── insights/         # Agent Insights & Cost Dashboard panels
│   │   │   ├── layout/           # AppShell, TitleBar, SettingsMenuDropdown
│   │   │   ├── meetings/         # MeetingPanel, MeetingRecorder
│   │   │   ├── memory/           # MemoryPanel
│   │   │   ├── settings/         # SettingsModal and per-tab setting components
│   │   │   ├── threads/          # ThreadList, ThreadDetail, ThreadComposer
│   │   │   ├── terminal/         # TerminalPane (xterm.js)
│   │   │   ├── ui/               # shadcn/ui primitives (Button, Dialog, Input…)
│   │   │   └── wiki/             # WikiPanel
│   │   └── lib/                  # markdown.ts, utils.ts (cn helper)
│   │
│   └── shared/                   # Code shared between main and renderer
│       ├── types/                # All TypeScript interfaces and enums
│       │   ├── thread.ts         # Thread, ThreadStatus, AutopilotThreadState
│       │   ├── message.ts        # Message, MessageContentBlock, MessageNormalizedPayload
│       │   ├── project.ts        # SavedProject, ProjectConfig
│       │   ├── settings.ts       # AppSettings, SlackSettings, …
│       │   ├── provider.ts       # Provider union type
│       │   ├── automation.ts     # AutomationJob, AutomationSchedule, AutomationTrigger
│       │   ├── ipc.ts            # IPC_CHANNELS, IPC_EVENTS, all request/event types
│       │   └── wiki.ts           # WikiPage
│       ├── ipc/
│       │   └── registry.ts       # IPCMap — typed channel → input/output mapping
│       ├── automationTemplates.ts
│       └── threadTitle.ts        # Derives thread name from first user message
│
├── resources/
│   ├── Dockerfile.sandbox        # Global sandbox image (Claude Code + Codex + Gemini CLIs)
│   ├── entrypoint.sh             # Container entrypoint (starts Tailscale, drops to agent user)
│   ├── bundled-skills/           # SKILL.md files copied to ~/.claude/plugins/agentos-bundled/ on startup
│   │   ├── agentos-settings/         # "agentos-settings" skill for Claude Code
│   │   ├── docker/               # docker skill
│   │   ├── git/                  # git skill
│   │   ├── github/               # github (gh CLI) skill
│   │   ├── council-review/       # run a council of LLMs and synthesize their answers
│   │   ├── diagnose/             # diagnose session tool failures
│   │   ├── kanban-orchestrator/  # drive one kanban task end-to-end through its stage machine
│   │   ├── meeting-notes/        # generate structured meeting notes from a recording
│   │   ├── memory-search/        # delegate memory/code/graph searches to an Explore subagent
│   │   ├── personality-refresh/  # derive/update personality profile via list_project_messages
│   │   ├── save-session-chunk/   # distil and save a memory chunk from the current turn
│   │   ├── tailscale/            # tailscale networking skill
│   │   ├── test-webhook/         # enqueue a sample webhook payload through the real queue pipeline
│   │   └── youtube-summary/      # fetch YouTube captions and produce structured summary
│   └── project-config.schema.json
│
├── scripts/
│   ├── check-memory-smoke.mjs    # Smoke test for the memory subsystem
│   └── setup-macos.sh            # First-run setup (homebrew deps, docker)
│
└── tests/
    └── main/memory/              # Node --test unit tests for memory subsystem
```

---

## Glossary

| Term | Definition |
|---|---|
| **Thread** | A single long-running conversation with an AI CLI. Each thread has its own Docker container, git worktree, PTY, and message log. |
| **Provider** | The AI CLI harness backing a thread: `claude` (Claude Code headless), `claude-interactive` (Claude Code TUI), `codex` (OpenAI Codex), `gemini` (Google Gemini CLI), or `pi` (Pi coding agent). The `claude` and `codex` harnesses additionally have a configurable **backend** (`native` | `ollama` | `openrouter`) that routes API calls to a local or cloud-aggregator endpoint. |
| **Sandbox** | A Docker container that isolates the AI agent's filesystem and network access. Every thread always runs in a sandbox. |
| **MCP (Model Context Protocol)** | A protocol that lets a running agent call tools exposed by an external server over HTTP. AgentOS runs several MCP servers (memory, Slack, execution log) that agents call at runtime. |
| **Worktree** | A git worktree created from the project repo for each thread, giving each thread an isolated copy of the working tree. |
| **Headless mode** | Claude Code's `--headless` flag enables programmatic turn-by-turn interaction via `docker exec` rather than a persistent interactive PTY session. Used when Slack context must be injected per-turn. |
| **Stream-JSON mode** | Claude Code's `--output-format stream-json` flag makes it emit structured JSON events. AgentOS uses this for rich message parsing; falls back to plain text if the installed Claude version does not support it. |
| **Autopilot** | An opt-in mode where a secondary Claude planner reads the conversation transcript and decides whether to send the next user-behalf message, enabling multi-turn autonomous operation. |
| **Automation** | A named job that sends instructions to a thread on a schedule (cron, interval, or one-shot) or on demand. |
| **Memory** | A per-project persistent knowledge base indexed from markdown files and session JSONL logs. Queried via hybrid vector + BM25 search; served to agents via the `agentos-memory` MCP server. |
| **Chunk** | A segment of a markdown or session file stored in the SQLite memory database, with optional vector embedding. |
| **electron-store** | The JSON-backed key-value store that persists threads, projects, automations, settings, Slack bindings, and Slack cursors across app restarts. Lives in Electron's user-data directory unless `AGENTOS_STORE_DIR` overrides it. |
| **Bundled skill** | A `SKILL.md` file from `resources/bundled-skills/` that AgentOS copies to `~/.claude/plugins/agentos-bundled/skills/` on startup, making it available inside Claude Code containers. |
| **PTY** | A pseudo-terminal (via `node-pty`) used to run the AI CLI interactively inside the Docker container and capture its output. |
| **ContainerManager** | The main-process component responsible for Docker container lifecycle: building images, tracking creation/last-used timestamps, and pruning idle containers. |
| **SlackBridge** | A Slack Socket Mode client running inside the main process that forwards inbound messages to thread input queues and posts outbound updates back to Slack channels. |
| **Personality profile** | A textual style description (two parts: `agentStyle` for AI responses, `autopilotInstructions` for user-behalf messages) derived from a thread's user messages via LLM (Claude CLI). Configurable with Big Five trait sliders and presets. Stored at project level; regenerated daily via a built-in hidden automation that is automatically managed when personality is enabled. |
| **Kanban board** | A project-level multi-agent orchestration board with a 6-stage pipeline (`backlog → researching → planning → implementing → reviewing → done`). A persistent coordinator thread uses the AgentOS Kanban MCP server to manage task lifecycle; specialist threads are spawned per task stage. Stage labels and agent prompts stored in the kanban DB (`kanban_stages` table) and configurable via the project settings UI or `list_stages`/`update_stage` MCP tools. Done tasks are auto-archived after 5 days. Gated by `kanban.enabled` in the project config. |
| **Council** | A saved configuration (name + member list, each member = provider + model) that dispatches the same prompt to multiple sub-threads in parallel and synthesizes their outcomes via a judge prompt. |
| **FilteringProxy** | A host-side HTTP/HTTPS forward proxy (`src/main/proxy/filteringProxy.ts`) that enforces `sandbox.allowedDomains` by blocking CONNECT tunnels and HTTP requests to non-allowlisted hostnames. Injected into containers via `HTTP_PROXY`/`HTTPS_PROXY` env vars. |
| **Voice Flow** | A global-hotkey-triggered local voice recording feature. After the hotkey fires, an always-on-top overlay shows live waveform bars; on stop a Whisper-style chime plays and the transcript is routed to the active AgentOS thread (if AgentOS is focused) or pasted into the active external text field. File: `src/main/audio/voiceFlowHotkey.ts`. (Renamed from WhisperFlow in #542.) |
| **agentos-recordings MCP** | An MCP server (dynamic port, `src/main/integrations/recordingsMcpServer.ts`) that exposes `get_recording_meta` and `get_transcript` tools so agents can access persisted meeting recordings. |
| **Meeting recording** | A feature that captures and transcribes meeting audio, auto-detects active browser meetings (Google Meet / Zoom / Teams via tab URL polling), and generates structured notes via the bundled `meeting-notes` skill. Processing is fire-and-forget (background transcription + thread creation); status shown in the recording tab. Recordings are stored in the threads SQLite DB (`recordings` table). Gated by `FEATURES.MEETINGS`. |
