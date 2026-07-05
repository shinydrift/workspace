# Wiki Changelog

## [2026-07-05]

### Refresh
- Updated documentation after code changed through `f251105` (`Guard capture playlist stale loads`).
- Replaced stale Slack-only MCP references with the current `agentos-thread` MCP messaging/file-upload surface.
- Refreshed meeting recording coverage for enabled feature flags, continuous 5-minute capture segments, time-window transcript tools, and recording templates.
- Refreshed configuration docs around the canonical shared schema: `agents.providerOrder`, `agents.autopilot`, `runOnHost`, `tailscale`, `containers`, `personality`, and `recording`.
- Updated Kanban docs for configurable stages, generic tasks, stage workers, dependencies, class of service, due dates, and `saveToMemory`.
- Updated README metadata and MCP server inventory.

## [2026-05-22]

### Baseline
This repository history was consolidated into a May 22 initial baseline. Earlier development notes were folded into the current wiki pages rather than preserved as dated incremental history.

### Current Coverage
- `01-overview.md` covers the product surface, key features, repository structure, and glossary.
- `02-architecture.md` covers the process model, major services, renderer components, and data flow.
- `03-api-reference.md` covers IPC channels, runtime APIs, memory APIs, and shared types.
- `04-onboarding.md` covers setup, build, run, debugging, testing, and contribution workflow.
- `05-data-model.md` covers persisted settings, file storage, SQLite tables, and migrations.
- `06-infrastructure.md` covers Docker sandboxing, packaging, security, config, and environment variables.
- `07-cross-cutting.md` covers auth, automations, memory, Slack, autopilot, audio, theming, and wiki behavior.

### Summary
The baseline includes the Electron/React desktop app, Docker-backed assistant sessions, Claude/Codex/Gemini provider support, Slack integration, persistent memory and code search, automations, Kanban orchestration, meeting and voice workflows, analytics, bundled skills, and the project wiki system.
