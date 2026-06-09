# Phase 4: Indexer in `utilityProcess`

Move all heavyweight memory work (better-sqlite3 transactions, tree-sitter WASM parsing, local llama embedding) off the Electron main process into a dedicated `utilityProcess.fork()` child. The main process becomes a thin IPC proxy.

Phases 1–3 (already landed in this PR) removed the cold-start hang, decoupled `saveChunk` from the embedding call, and parallelized local embeds. Phase 4 attacks what remains: synchronous `db.transaction()` blocks during code indexing and synchronous `parser.parse()` during tree-sitter chunking. Both still stall the main loop on large projects.

## Goals

1. No DB work (better-sqlite3) runs on the main process.
2. No tree-sitter `parser.parse()` runs on the main process.
3. No local llama inference runs on the main process.
4. Renderer ↔ main IPC latency for memory operations is unchanged in the happy path (target: <5ms overhead per call).
5. Worker crash is recoverable — main respawns; in-flight requests reject with a clear error.

## Non-goals

- Multi-worker fan-out. One indexer worker per app instance is enough; per-project parallelism stays inside the worker.
- Streaming partial results back to the renderer. Existing API is request/response; keep it that way for now.
- Migration of the graph subsystem in the first cut — graph stays main-process behind the same proxy boundary if it complicates the seam.

## Architecture

```
┌─────────────────────────┐         ┌─────────────────────────────┐
│  Electron main process  │  IPC    │  utilityProcess (indexer)   │
│                         │ ◄────► │                              │
│ AgentOSMemoryService    │         │  better-sqlite3              │
│   (proxy — async only)  │         │  tree-sitter WASM            │
│                         │         │  node-llama-cpp              │
│ MCP / IPC handlers      │         │  embedQueue                  │
└─────────────────────────┘         └─────────────────────────────┘
```

### Worker entry

`src/main/memory/worker/indexer.ts` — bootstrapped by `utilityProcess.fork()`. Owns:

- `getProjectDb()` / `closeProjectDb()` (better-sqlite3 instances)
- `MemoryContentService`, `MemorySyncCoordinator`, `MemoryStatsService`, `MemoryGraphService`
- `getProvider()` (embedding provider cache, including local llama load)
- `embedQueue`
- File watchers (still in the worker — they only mark dirty Set state, which lives there too)

### IPC protocol

Message envelope:

```ts
type Request = { id: string; method: string; args: unknown };
type Response = { id: string; result?: unknown; error?: { message: string; code?: string } };
type Event = { event: string; payload: unknown }; // server → client only
```

- Correlation id matches request to response.
- One method per existing `AgentOSMemoryService` public method (`saveChunk`, `search`, `searchCode`, `status`, `reindex`, `doctor`, `healthCheck`, `linkEntities`, `addObservation`, `graphAll`, `graphAllPage`, `graphQuery`, `getEntityChunks`, `save`, `get`, `listChunks`, `deleteChunk`, `deleteFile`, `updateChunk`, `pinChunk`, `getThreadChunks`, `getGlobalExpansionCounts`, `getProjectStats`, `invalidateProject`, `resetEmbeddings`, `deleteData`, `flushPending`, `configure`, `warmup`).
- `Event` channel pushes existing broadcasts (`IPC_EVENTS.MEMORY_INDEX_STATUS`) — main forwards them to renderer.

### Proxy

`AgentOSMemoryService` keeps its public shape but every method becomes `async` and forwards via the IPC envelope. Sync methods (e.g. `linkEntities`, `getEntityChunks`) become async — callers already await most of them; the rest get an `await` added.

### Lifecycle

- `configure()` spawns the worker if absent, awaits a `ready` handshake.
- On worker `exit`: respawn once with backoff (1s). In-flight requests reject with `MemoryIndexerCrashed`. Renderer surfaces a non-blocking error toast.
- App quit: send `shutdown` message, await drain (`flushPending()`), then `kill()`.

## Migration strategy

Big-bang is risky. Land incrementally over 3 PRs:

**4a — scaffolding.** Add `worker/indexer.ts`, IPC framing, lifecycle, no method routing yet. Tests cover spawn/respawn/shutdown only. ~200 LOC.

**4b — route everything.** Move every `AgentOSMemoryService` method to the worker. Sync methods become async. Existing IPC handlers and the MCP server get `await` adjustments. This is the bulk of the work — ~800–1200 LOC, mostly mechanical. Tests: run the existing memory test suite against the proxy (most tests already only touch the public service API, so they should pass unchanged).

**4c — kill the redundancy.** Once the proxy is the only entry point, drop the in-process imports of `getProjectDb`, `MemoryContentService`, etc. from anywhere outside `src/main/memory/worker/`. Add an ESLint boundary rule. ~50 LOC.

## Risks

1. **Sync API → async API churn.** Several existing methods are synchronous (`linkEntities`, `getEntityChunks`, `listChunks`, `getThreadChunks`, `getProjectStats`, `getGlobalExpansionCounts`, `deleteChunk`, `deleteFile`, `updateChunk`, `pinChunk`, `invalidateProject`). Every caller — including renderer-side via preload — must be checked. Tractable but tedious.

2. **Test ergonomics.** Memory tests today import `getProjectDb` directly and poke the schema. After 4c that import is forbidden. Either keep an in-process backdoor under `NODE_ENV=test`, or route tests through the proxy. Prefer the latter; document the seam.

3. **Worker crash blast radius.** If the worker dies mid-transaction, the WAL recovers cleanly on respawn. Verify with a kill-9 test.

4. **Renderer broadcast latency.** `MEMORY_INDEX_STATUS` events go renderer ← main ← worker. Extra hop adds ~1ms; acceptable.

5. **Native module bundling.** `electron-forge` packages better-sqlite3 / node-llama-cpp / sqlite-vec for the main process. Confirm they're reachable from `utilityProcess` (same require resolution as main — should be fine, but verify).

## Open questions

- Should `MemoryStatsService` (small, in-memory cache) stay in main as a façade, or move into the worker? Leaning move — keeps the seam pure.
- Tree-sitter WASM parsers cache per language; reloading them in the worker after a respawn is a few hundred ms. Acceptable cold start.
- Does the renderer ever need synchronous read access to memory data (e.g. for initial paint)? Audit before 4b.
