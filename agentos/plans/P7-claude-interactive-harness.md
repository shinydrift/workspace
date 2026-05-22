# P7 — Claude Interactive Harness (Wrapper)

## Goal

Offer Claude in **interactive mode** (persistent in-container PTY + JSONL-tailed output) as a selectable harness in the model popover, without disturbing the existing **headless Claude** code path. The interactive integration is implemented as a *wrapper* that presents the same function signature as `execHeadlessTurn`, so the dispatch site is a single ternary — no `else` branch, no edits to headless internals.

Prior attempts (PRs #980–#982, reverted) modified core session code in-place. This plan keeps interactive isolated to its own module so headless remains byte-identical.

---

## Non-Goals

- Replacing the headless path. Headless stays the default for Claude.
- Touching non-Claude providers (codex, gemini, pi).
- Modifying `headlessRunner.ts`, `threadOutput.ts`, `ThreadManager.ts`, `ThreadInputService.ts`, `sandbox.ts`, or `buildDockerExecArgs`.

---

## Architecture

### Dispatch (single seam)

`src/main/sessions/turnExecution.ts` — at the existing headless call site (~line 373):

```ts
const runner =
  provider === 'claude-interactive' ? execClaudeInteractiveTurn : execHeadlessTurn;
return runner(threadId, input, source, deps, options);
```

Both functions share the exact signature:

```ts
(threadId: string,
 input: string,
 source: QueueSource,
 deps: HeadlessTurnDeps,
 options?: { timeoutMs?: number; persistInput?: boolean; systemPromptSuffix?: string }
) => Promise<TurnExecutionResult>
```

`HeadlessTurnDeps` and `TurnExecutionResult` are reused as-is from `headlessRunner.ts` — the wrapper does not introduce a parallel type hierarchy.

### Wrapper module

`src/main/sessions/claudeInteractive/`

| File | Responsibility |
|---|---|
| `execClaudeInteractiveTurn.ts` | Public entry. Matches `execHeadlessTurn` signature. Gets-or-creates the per-thread `ClaudeInteractiveSession`, writes input, awaits turn completion, returns `TurnExecutionResult`. |
| `ClaudeInteractiveSession.ts` | Per-thread singleton holding the persistent PTY and JSONL tailer. Lifecycle: `ensureStarted()`, `sendTurn(input)`, `dispose()`. Idle teardown after 30m (mirrors current container idle timing). |
| `ClaudeJsonlTailer.ts` | Tails `~/.claude/projects/-workspace/<session-id>.jsonl`. Emits a single `turn-complete` per turn boundary (detected from JSONL message types). |
| `sessionRegistry.ts` | Map<threadId, ClaudeInteractiveSession>. Survives turn-to-turn; cleared on thread stop. |

All complexity (PTY boot, ready-signal detection, paste handling, dedup, idle teardown, JSONL parsing) is contained inside this module.

### Container interaction

The wrapper runs `claude` inside the **same per-thread container** that headless uses, via `docker exec -it <containerName> claude --session-id <preallocated> [flags…]`. Container provisioning is delegated to `deps.containers` (`ContainerManager`) — same instance headless receives. No new container management code.

CLI invocation copies whatever flags `buildDockerExecArgs` produces for headless `claude`, **minus** the one-shot `--print` / single-prompt flags. The wrapper does not call `buildDockerExecArgs` — it has its own minimal arg builder that reuses the same flag-resolution helpers (`resolveEffectiveModel`, `resolveEffectiveEffort`, `resolveDisallowedTools`) imported from existing locations.

### Session ID

Reuse the `--session-id` pre-allocation pattern from the reverted `ce50d337`: the wrapper generates a UUID up-front, passes it to claude on launch, and uses it to locate the JSONL file. Stored on the thread as `claudeSessionId` (existing field — no schema change).

### Output broadcasting

JSONL-derived assistant turns are written to `ThreadOutputManager` via the existing `deps.output` interface, same way headless writes its captured stdout. The renderer sees no difference in event shape. (No raw PTY broadcast — the JSONL tail is the source of truth for interactive turns, avoiding the duplicate-broadcast bug fixed in reverted #982.)

---

## Data Model

### `src/shared/types/provider.ts`

Add `claude-interactive` to the `Provider` union and the six derived tables:

```ts
export type Provider = 'claude' | 'claude-interactive' | 'codex' | 'gemini' | 'pi';

PROVIDER_LABEL['claude-interactive'] = 'Claude (interactive)';
PROVIDERS.push('claude-interactive');
HARNESS_BACKENDS['claude-interactive'] = ['anthropic'];
DEFAULT_BACKEND['claude-interactive'] = 'anthropic';
PROVIDER_MODELS['claude-interactive'] = PROVIDER_MODELS.claude; // same models
VALID_PROVIDERS.add('claude-interactive');
```

Effort flag (`CLAUDE_EFFORT_*`) — extend the `provider === 'claude'` guard in `normalizeProviderOrder` to also accept `claude-interactive`.

### Thread storage

No schema migration. The existing `thread.provider` field already accepts the union. `thread.claudeSessionId` is reused for the pre-allocated interactive session id.

### Renderer

`ProviderModelBadges.tsx` — picks up the new option automatically from `PROVIDERS` + `PROVIDER_MODELS`. Visual treatment: same as `claude` (or add a small "interactive" suffix in the label only — TBD on review).

---

## Selection Flow

1. User opens model popover in `NewThreadComposer` → selects "Claude (interactive)".
2. `useNewThreadSubmit` writes `provider: 'claude-interactive'` via `window.electronAPI.thread.create`.
3. Thread starts. `ContainerManager` provisions container as it does for `claude`.
4. First user input → `turnExecution.ts` dispatch → `execClaudeInteractiveTurn`.
5. Wrapper lazily starts the persistent PTY + JSONL tailer for this thread.
6. Input written to PTY, JSONL tailer awaits assistant turn complete, output returned.
7. Subsequent turns reuse the same PTY (no spawn cost).
8. On thread stop or 30m idle → wrapper disposes PTY, tailer, registry entry.

---

## Phasing

### Phase 1 — Plumbing only (this PR)
- Provider type changes
- Wrapper module scaffold (files exist, methods throw `Error('not implemented')`)
- Dispatch ternary in `turnExecution.ts`
- UI option appears, selecting it produces a clear "not implemented yet" error at first turn

**Acceptance:** Headless Claude unchanged (regression test the existing flow). New option visible. Selecting it fails loudly, not silently.

### Phase 2 — PTY + JSONL implementation
- `ClaudeInteractiveSession` real lifecycle
- `ClaudeJsonlTailer` real implementation (port from `backup/pre-revert-interactive-mode` for reference, but rewrite to live entirely inside the wrapper module)
- Session-id pre-allocation
- First-turn end-to-end works

### Phase 3 — Polish
- Idle teardown
- Ready-signal detection refinements
- Paste handling
- Dedup
- Error/recovery paths matching headless robustness

Each phase is independently shippable.

---

## Risk & Mitigation

- **Risk:** Interactive PTY in container desyncs from JSONL file (e.g. claude crashes mid-turn). **Mitigation:** Tailer has a watchdog timeout; on timeout, dispose session and fail the turn with an actionable error. User can re-send; next turn spawns a fresh PTY.
- **Risk:** JSONL file path assumptions break across Claude CLI versions. **Mitigation:** Path resolution centralized in `ClaudeJsonlTailer`. Single place to patch.
- **Risk:** Two providers (`claude`, `claude-interactive`) cause confusion. **Mitigation:** Clear label "Claude (interactive)". Documented in P7 itself. Default remains `claude`.
- **Risk:** Wrapper drifts from `execHeadlessTurn` signature over time. **Mitigation:** Both reference the same `HeadlessTurnDeps` / `TurnExecutionResult` types — type checker catches drift.

---

## Reference: backup branch

The previous (reverted) implementation lives on `backup/pre-revert-interactive-mode`. Useful for porting JSONL parsing logic and ready-signal detection. Do **not** cherry-pick wholesale — it embedded interactive logic inside `turnExecution.ts` and `ThreadManager.ts`, which is exactly what this plan avoids.
