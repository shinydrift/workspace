# AgentOS — Developer Onboarding Guide

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Build & Run Commands](#build--run-commands)
- [Testing](#testing)
- [Debugging Tips](#debugging-tips)
- [Code Style & Linting](#code-style--linting)
- [PR / Contribution Workflow](#pr--contribution-workflow)

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| macOS | 12 (Monterey) | Primary development platform; Electron's APIs for `app.getPath('home')` are macOS-specific |
| Node.js | 20 LTS | The sandbox Dockerfile also uses `node:slim` (Node 20) |
| npm | 10+ | Ships with Node 20 |
| Docker Desktop | Latest stable | Must be running before starting any thread; install from docker.com |
| Git | Any modern | Git worktrees require git ≥ 2.15 |
| Claude Code CLI | Latest | `npm install -g @anthropic-ai/claude-code`; must be logged in with `claude auth login` |

> **Linux / Windows:** The app builds (Electron Forge supports all platforms), but the OAuth Keychain read (`security find-generic-password`) is macOS-specific. Docker sandboxing works on any platform with Docker installed.

---

## Environment Setup

### 1. Clone the repository

```bash
git clone <repo-url> agentos
cd agentos
```

### 2. Install npm dependencies

```bash
npm install
```

This installs all runtime and dev dependencies including `better-sqlite3`, `node-pty`, and `node-llama-cpp` which contain native addons.

### 3. Verify TypeScript

```bash
npx tsc --noEmit
```

No errors should be reported. There is one known pre-existing ESLint issue in `ThreadManager.ts:411` (a control character in a regex string used for ANSI stripping) — do not touch it.

### 4. (Optional) Run all steps at once

```bash
npm run setup:mac
```

This script runs `npm install` and `tsc --noEmit` in sequence.

### Environment variables (runtime)

| Variable | Purpose | Default |
|---|---|---|
| `AGENTOS_STORE_DIR` | Override the directory for `electron-store`'s config.json (useful for tests) | OS user-data dir |
| `AGENTOS_OPEN_DEVTOOLS` | Set to `1` to open DevTools on app start in dev mode | `0` |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth access token injected into Docker containers for Claude Code auth | Read from macOS Keychain at runtime |

No `.env` file is needed for development. The app reads live settings from electron-store at runtime.

---

## Build & Run Commands

| Task | Command | Notes |
|---|---|---|
| Start dev app | `npm start` | Hot-reloads renderer via Vite HMR; main process restarts on file change |
| TypeScript check | `npx tsc --noEmit` | The only supported verification method (no preview server) |
| Lint | `npm run lint` | ESLint with TypeScript rules; see `.eslintrc` |
| Run tests | `npm test` | Node built-in test runner (`node --test tests/**/*.test.mjs`) |
| Run tests (watch) | `npm run test:watch` | Re-runs tests on file changes |
| Run memory smoke test | `npm run check:memory` | Quick sanity check of the memory subsystem |
| Package macOS app | `npm run package:mac` | Produces `out/AgentOS-darwin-arm64/` |
| Make distributables | `npm run make` | Produces DMG, ZIP, DEB, RPM in `out/make/` |
| Publish | `npm run publish` | Requires forge publisher config |

### Development notes

- `npm start` uses `electron-forge start`. The Vite plugin serves the renderer over a local dev server and injects `MAIN_WINDOW_VITE_DEV_SERVER_URL`.
- The main process and preload are bundled by Vite into `.vite/build/`. After a TypeScript change in main, the app needs a full restart (`Ctrl+C` then `npm start`).
- The renderer supports Hot Module Replacement (HMR) — UI changes appear without a reload.
- Open DevTools in dev mode: set `AGENTOS_OPEN_DEVTOOLS=1` or use the `View → Developer Tools` Electron menu.

---

## Testing

### Structure

```
tests/
└── main/
    └── memory/
        ├── db.test.mjs               # SQLite schema and getProjectDb()
        ├── functional.test.mjs       # End-to-end memory service round-trips
        ├── hybrid.test.mjs           # Hybrid BM25 + vector merge logic
        ├── mmr.test.mjs              # MMR re-ranking algorithm
        ├── service.test.mjs          # AgentOSMemoryService search/save/status
        ├── session-files.test.mjs    # JSONL session file indexing
        └── temporal-decay.test.mjs   # Score decay calculation
```

All tests use the Node.js built-in test runner (`node:test`) with `assert/strict`. No Jest, Vitest, or Mocha.

### Running tests

```bash
npm test                    # run all tests once
npm run test:watch          # watch mode
npm run check:memory        # memory-specific smoke test (scripts/)
```

Tests that require SQLite use `AGENTOS_STORE_DIR` pointing to a temp directory created per test to keep electron-store isolated.

### Adding a new test

1. Create `tests/main/<subsystem>/<feature>.test.mjs`.
2. Import from `node:test` and `node:assert/strict`.
3. Use `before`/`after` hooks to set `process.env.AGENTOS_STORE_DIR` to a temp dir and clean up.

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

describe('my feature', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-test-'));
    process.env.AGENTOS_STORE_DIR = tmpDir;
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does something', () => {
    assert.equal(1 + 1, 2);
  });
});
```

### Test naming conventions

- File names use lowercase kebab-case: `my-feature.test.mjs`.
- Describe blocks name the module or concept under test.
- Test names use plain English, describing the expected behaviour: `'returns empty array when query is blank'`.

---

## Debugging Tips

### Main process

- **Event log panel:** In the running app, click the settings menu → "Event Log" to see structured log output from all subsystems (thread, docker, memory, automation, slack, etc.).
- **Persist debug logs:** Set `persistDebugLogs: true` in Settings → Developer; logs are appended to `~/.agentos/eventlog.jsonl`.
- **DevTools for main process:** Run `npm start` with `AGENTOS_OPEN_DEVTOOLS=1`; a second DevTools window opens for the renderer. The main process logs go to the terminal where `npm start` was invoked.
- **Inspect store:** `~/.agentos/` holds runtime artifacts such as logs, messages, sessions, and memory databases. The `config.json` electron-store lives in Electron's user-data directory, or under `AGENTOS_STORE_DIR` if you override it in development.

### Docker issues

- **"Docker is not available":** Start Docker Desktop. The app waits up to 30 seconds for the Docker daemon on startup.
- **Container stuck in "running":** Use `sandbox:listContainers` (Settings → Sandbox → Containers) to inspect and remove stale containers.
- **Image build failures:** Watch the "Building Docker image..." progress in the sidebar; full output is in the event log.

### Memory subsystem

- Run `npm run check:memory` for a quick smoke test.
- `memory:doctor` IPC call (accessible from the Memory panel in the UI) reports: memory directory presence, embedding provider availability, chunk count, and sqlite-vec availability.
- SQLite DBs live in `~/.agentos/memory/projects/<projectId>.sqlite`; open with any SQLite browser.

### Provider fallback

- Startup fallback is logged with `eventLogger.warn('thread', 'Claude stream-json unsupported...')`.
- Disable stream-json globally: Settings → Agents → uncheck "Stream JSON output".

### Common gotchas

| Symptom | Root cause | Fix |
|---|---|---|
| Thread stuck at "running" after crash | Docker container is still up but PTY is gone | Stop thread from UI or remove container from Sandbox tab |
| "Thread X not found" in automation run | The project backing the automation is gone, or the automation was interrupted before its fresh run thread started | Recreate the automation or restore the missing project context |
| `memory_search` returns 0 results | Memory not indexed yet | Click "Re-index" in the Memory panel |
| TypeScript error after updating types | Shared types changed; main and renderer out of sync | Run `npx tsc --noEmit` to identify the error location |

---

## Code Style & Linting

- **Language:** TypeScript strict mode. All new files should have type annotations.
- **Formatter:** No auto-formatter is configured. Match the surrounding file's indentation (2 spaces throughout).
- **Linter:** ESLint with `@typescript-eslint`. Run `npm run lint` before committing.
- **Imports:** Use named imports. Avoid default exports for modules with multiple exports. Shared types always live in `src/shared/types/`; never duplicate type definitions in main or renderer.
- **No `any`:** Avoid `any` unless wrapping a third-party API that has no types; use `unknown` + narrowing instead.
- **Comments:** Add comments only for non-obvious logic. Do not add JSDoc to every function.
- **Pre-existing ESLint issue:** `ThreadManager.ts:411` has a control character in a regex (`stripAnsi`) — do not modify it; the lint suppression is intentional.

### ESLint config (`.eslintrc.json` / `eslint.config.js`)

The config uses `@typescript-eslint/parser` with `eslint-import-resolver-typescript` for path alias resolution. Rules include `@typescript-eslint/no-explicit-any` as a warning.

---

## PR / Contribution Workflow

### Branch naming

```
<type>/<short-description>
```

Examples: `feature/slack-workspace-selector`, `fix/container-prune-race`, `refactor/thread-output-manager`.

### Commit messages

Follow the Conventional Commits convention:

```
<type>: <short imperative description>

[optional body with more context]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.

### Before opening a PR

1. `npx tsc --noEmit` — must pass with no errors.
2. `npm run lint` — no new lint errors.
3. `npm test` — all tests pass.
4. Manually verify the changed behaviour in the running app (`npm start`).

### Review checklist

- [ ] New IPC channels are added to `src/shared/ipc/registry.ts` (typed).
- [ ] New store keys are added to `StoreSchema` in `src/main/store/index.ts`.
- [ ] New settings have defaults in the `defaults` object in `store/index.ts`.
- [ ] Docker image changes (e.g., new tools) are reflected in `resources/Dockerfile.sandbox`.
- [ ] No secrets or API keys committed.
- [ ] Worktree cleanup (if adding new thread operations that reference `workingDirectory`).
