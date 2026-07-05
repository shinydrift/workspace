# AgentOS

**AgentOS** is an open-source macOS desktop application that gives developers a unified control plane for AI coding assistants. Each conversation runs inside an isolated Docker container — fully observable, interruptible, and scriptable.

AgentOS does not replace Claude Code, OpenAI Codex, or Google Gemini CLI. It orchestrates them: adding persistent memory, scheduled automations, multi-agent coordination, Slack integration, and an autopilot mode that lets agents drive themselves to completion.

*Last updated: 2026-07-05*

---

## Why AgentOS

AI coding assistants are powerful but stateless and isolated by default. AgentOS solves the operational layer:

- **Safety by default** — every agent runs in a Docker sandbox with configurable network and filesystem restrictions
- **Memory that persists** — knowledge extracted from sessions is indexed and fed back to agents via hybrid vector + full-text search
- **Delegation at scale** — recurring tasks (code review, dependency bumps, changelogs) run on a schedule without manual prompting
- **Observability** — live terminal output, structured message view, cost dashboard, and event log for every thread

---

## Capabilities

### Multi-Provider Threads
Choose a harness — the AI CLI that runs inside the container: **Claude Code**, **claude-interactive** (Claude TUI), **OpenAI Codex**, **Google Gemini CLI**, or the **Pi coding agent** (an alternative Claude-based CLI). Switch per-project via config file or UI. The underlying API provider (Anthropic, OpenAI, Google, **Ollama** for local models, or **OpenRouter**) is configured independently.

### Docker Sandbox
Every thread runs in an isolated `agentos-session-<id>` container. Configure capabilities, network mode, memory limits, and PIDs per project. An optional host-side HTTP/HTTPS filtering proxy enforces a domain allowlist — no container root or `NET_ADMIN` required.

### Persistent Hybrid Memory
Project knowledge is stored in per-project SQLite databases with both **vector (cosine)** and **BM25 full-text** search. Session turns are auto-summarized and indexed on thread idle. Agents query memory via an in-process MCP server. A Memory Inspector UI lets you browse, pin, edit, or delete individual chunks. The `memory_list_projects` tool returns all projects with id/name/path. Complex memory and code searches are delegated to an Explore subagent for better results.

### Autopilot Mode
A secondary Claude planner reads the conversation transcript after each assistant turn and decides whether to send the next user-behalf message — enabling multi-turn autonomous task completion. The planner provider and model are configurable independently of the thread provider. Configurable maximum consecutive turns (default: 10). Stalled turns auto-recover after 60 seconds. Visual indicators (pulsing badge, robot icon, reasoning bubble) keep you informed at a glance.

### Scheduled Automations
Define **cron**, **interval**, or **one-shot** jobs that send instructions to a thread on a schedule. Results are logged to a searchable execution log. Notifications can be sent via Slack on completion.

### Slack Integration
Inbound Slack messages create or resume AgentOS threads. The primary conversation surface is the in-app Thread view; Slack is an echo medium bound to the same thread via `slack_thread_bindings`. Agents post progress updates, ask clarification, and upload files through `agentos-thread` MCP tools; connected Slack threads receive mirrored updates. File attachments are forwarded into `/workspace/.agentos/uploads/`. Agent output is automatically converted from Markdown to Slack's mrkdwn format. An optional **requireMention** toggle drops new root-thread messages that do not @mention the bot — replies in existing threads always pass through.

### Kanban Multi-Agent Board
A project-level Kanban board (enabled via `kanban.enabled` in project config) with a 6-stage pipeline (`Backlog → Researching → Planning → Implementing → Reviewing → Done`). Specialist AI agents are coordinated via a dedicated thread backed by the `agentos-kanban` MCP server. Board UI features: redesigned task cards with inline priority/due-date/agent pickers, live agent execution indicator, subtask progress badge, configurable card display fields, list view with archived-task section, batch multi-select operations, and Blocked as a first-class column. Tasks auto-archive 5 days after reaching Done. A **stage approval gate** lets a stage worker pause and require human sign-off before advancing. Inter-task dependency graph, class-of-service swimlanes (expedite/standard/intangible), SLA badges, and overdue task listing are also supported.

### Council — Parallel Multi-Provider Evaluation
Define a named council of provider/model members. Dispatch a prompt and AgentOS spawns parallel sub-threads that each run independently and submit their outcome. Results are synthesized by a judge prompt into a unified answer.

### Per-Thread Git Worktrees
Each thread gets its own git worktree for filesystem isolation within the project repo, so concurrent threads never step on each other.

### Personality Profiles
Configure how an agent communicates — tone, verbosity, style — via Big Five trait sliders and presets. Profiles are derived from your own message history via LLM and stored per project.

### Agent Insights & Cost Dashboard
Per-thread and project-level analytics: token usage, cost, tool call breakdown, memory hit rates, files touched, shell commands run, web activity, and response times.

### Built-in Skills
Bundled Claude Code skills (`git`, `github`, `docker`, `tailscale`, `diagnose`, `save-session-chunk`, `memory-search`, `agentos-settings`, `kanban-orchestrator`, `council-review`, `meeting-notes`, `personality-refresh`, `test-webhook`, `youtube-summary`) are automatically installed into every container at startup.

### Meeting Recording & Continuous Capture
Meeting recording, Voice Flow, and Kanban are enabled by compile-time feature flags. Recordings are saved to the threads SQLite database and exposed to agents through `agentos-recordings`. Continuous capture stores rolling 5-minute segments that can be summarized by selecting a time window.

### Project Wiki
Lightweight per-project wiki pages stored as Markdown files in a `wiki/` directory, editable from the UI.

### Menubar Status Overlay
A system tray icon and live popover show active thread status without requiring the main window.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 41 |
| UI framework | React 19 + Zustand 5 |
| Styling | Tailwind CSS v4 + Radix UI (shadcn/ui) |
| Language | TypeScript 5.9 (strict) |
| Memory DB | SQLite (better-sqlite3 + sqlite-vec) |
| Terminal | node-pty + xterm.js |
| Containerization | Docker (host daemon via CLI) |
| Scheduling | node-cron |
| Agent protocol | MCP (Model Context Protocol) — 7 in-process servers |
| Slack | @slack/socket-mode (real-time) + @slack/web-api |
| Build | Electron Forge + Vite |

---

## Requirements

- macOS (arm64) — primary supported platform
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- Node.js (see `.node-version`)
- API credentials for at least one AI provider: Claude (Anthropic), OpenAI, Google, Ollama, or OpenRouter. The AI CLIs (Claude Code, Codex, Gemini) are pre-installed in the Docker sandbox image AgentOS builds automatically.

---

## Getting Started

```bash
# Clone the repo
git clone <repo-url>
cd agentos/agentos

# First-time macOS setup (Homebrew deps, Docker check)
npm run setup:mac

# Copy release env template and fill in your API keys / OAuth tokens
cp release.env.example release.env
# edit release.env before continuing

# Install dependencies
npm install

# Start the app in development mode
npm start
```

### Building a Release

```bash
npm run make
```

Produces a macOS DMG in `out/make/`. Auto-update is configured for GitHub Releases (arm64 only).

---

## Project Structure

```
agentos/
├── src/
│   ├── main/          # Electron main process — ThreadManager, Docker, MCP servers, memory
│   ├── renderer/      # React UI — threads, memory panel, settings
│   ├── preload/       # Typed IPC bridge (contextBridge)
│   └── shared/        # Types, IPC registry, utilities
├── resources/
│   ├── Dockerfile.sandbox    # Sandbox image with all AI CLIs
│   └── bundled-skills/       # Skills auto-installed into containers
├── tests/             # Node --test + Vitest test suites
└── scripts/           # Setup, build, and smoke-test scripts
wiki/
└── *.md               # Project documentation
```

See [`wiki/02-architecture.md`](wiki/02-architecture.md) for the full system diagram and component catalog.

---

## MCP Servers

AgentOS exposes in-process MCP servers that containerized agents can call at runtime:

| Server | Port | Purpose |
|---|---|---|
| `agentos-memory` | dynamic | Hybrid memory search and write |
| `agentos-thread` | dynamic | Post updates, ask clarification, upload files, and read/update thread/project settings |
| `agentos-council` | dynamic | Dispatch to and read from council runs |
| `agentos-kanban` | dynamic | Kanban board task management |
| `agentos-recordings` | dynamic | Access meeting recording transcripts |
| `agentos-autopilot` | dynamic | Private planner-only transcript and decision tools |
| `execution-log` | dynamic | Log automation run events |

All MCP servers bind to OS-assigned ports at startup (no fixed port numbers).

---

## Testing

```bash
npm test                    # Node --test (main process, shared)
npm run test:ts             # TypeScript tests (sessions, integrations, automations)
npm run test:renderer       # Vitest (renderer components, hooks)
npm run test:coverage       # Full coverage report via c8
```

---

## Configuration

Projects are configured via a `.agentos/config.json` file in the project root. A JSON schema is provided at `resources/project-config.schema.json`. Key options:

- `agents.providerOrder` — ordered harness/backend/model entries
- `agents.autopilot` — per-project autopilot turn limits and transcript length
- `sandbox` / `runOnHost` — Docker security settings or host execution
- `worktree` — per-thread worktree creation and pruning
- `memory` — project memory/search tuning overrides
- `kanban` — board enablement and stage prompt overrides
- `recording` — meeting-notes templates and active template
- `env`, `apiKeys`, `tailscale`, `containers`, `personality` — scoped runtime settings

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request. Run the full test suite and linter before pushing:

```bash
npm run test:coverage
npm run lint
```

---

## License

MIT
