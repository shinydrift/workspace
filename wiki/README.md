# AgentOS Wiki

AgentOS is a macOS-first Electron desktop application that provides a unified control plane for AI coding assistants — Claude Code, OpenAI Codex, and Google Gemini CLI. Every conversation runs in an isolated Docker container. AgentOS adds project management, persistent hybrid-search memory, scheduled automations, Slack integration, multi-turn autopilot, and a project wiki on top of these CLIs through a React-based GUI, without replacing the underlying tools.

## Table of Contents

| # | Document | Description |
|---|---|---|
| 1 | [Project Overview](./01-overview.md) | What AgentOS is, key features, tech stack, repository structure, and glossary |
| 2 | [Architecture Deep Dive](./02-architecture.md) | System diagram, component catalog, data flow, design patterns, state management, error handling |
| 3 | [Module & API Reference](./03-api-reference.md) | Every IPC channel, push event, ThreadManager API, MemoryService API, and shared types |
| 4 | [Developer Onboarding Guide](./04-onboarding.md) | Prerequisites, setup steps, build/run commands, testing, debugging, code style, PR workflow |
| 5 | [Data Model & Storage](./05-data-model.md) | ER diagram, electron-store schema, file-based storage, SQLite schema, caching, migrations |
| 6 | [Configuration & Infrastructure](./06-infrastructure.md) | Environment variables, config files, Docker sandbox, packaging, security |
| 7 | [Cross-Cutting Concerns](./07-cross-cutting.md) | Auth, background queues, real-time IPC, failover, autopilot, Slack, memory, audio, theming, wiki |

---

*Last generated: 2026-05-22*
