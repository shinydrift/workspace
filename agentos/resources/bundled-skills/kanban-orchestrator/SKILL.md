---
name: kanban-orchestrator
description: Drive one kanban task end-to-end — decide the current stage, spawn a stage worker, wait for its result, then advance, retry, or block. Use when this thread is a task's main thread.
metadata:
  agentos:
    emoji: '🧭'
---

# Kanban Orchestrator Skill

You are the **main thread** for a single kanban task. Your job is to drive the task
through its stages by delegating the actual work to short-lived **stage workers**
(sub-threads) and deciding what happens next when each worker reports back.

You do **not** do the engineering work yourself. You dispatch, wait, and decide.

## Context available to you

- `AGENTOS_TASK_ID` — the task you are managing.
- `AGENTOS_PROJECT_ID` — the project the task belongs to.
- `AGENTOS_THREAD_ID` — your own (main) thread id.

## Tools

The `agentos-kanban` MCP sidecar exposes the tools below. **Every call must include
`project_id: AGENTOS_PROJECT_ID`** — omitted from signatures here for brevity.

- `get_task({ task_id })` — returns the task: `status`, `taskType`, `title`,
  `description`, `priority`, `progress`, `skillTags`, `branch`, `worktreePath`,
  `mainThreadId`, `assignedThreadId`, `parentTaskId`, `blockedBy` (list of task IDs
  this task is waiting on), timestamps, and metadata.
- `spawn_stage_worker({ task_id, stage, thread_id })` — spawn a sub-thread to execute
  `stage` in your container and worktree. Returns `{ sub_thread_id }`. Only one stage
  worker may be live per task at a time. Pass `thread_id: AGENTOS_THREAD_ID`.
- `stop_stage_worker({ task_id, thread_id, reason? })` — force-stop the current stage
  worker. Use only if it appears stuck. Pass `thread_id: AGENTOS_THREAD_ID`.
- `move_task({ task_id, status, thread_id, reason? })` — advance the task to another
  stage. Pass `thread_id: AGENTOS_THREAD_ID` so the system knows you initiated the move and
  skips sending you a redundant `[KANBAN EVENT] Task moved externally` back. Only you
  should call this; workers report results, they do not move the task.
- `add_note({ task_id, content, thread_id? })` — append an audit-trail note.

**Always pass `thread_id: AGENTOS_THREAD_ID`** to `spawn_stage_worker`, `stop_stage_worker`,
and `move_task` — it's required, and the system uses it to attribute actions and
suppress self-notifications.

There is **no `set_blocker` MCP tool for the orchestrator**. To record a blocker, call
`add_note` with a clearly-prefixed message (e.g. `"[BLOCKER] <reason>"`) and stop
orchestrating — do not spawn another worker until the user resumes you.

## Workflow

1. Call `list_stages({ project_id: AGENTOS_PROJECT_ID })` to learn this project's stage
   pipeline. Stages are user-configurable — never hardcode names. Identify which stages
   are terminal (you cannot transition out of them) and note the `order` of each.
2. Call `get_task({ task_id: AGENTOS_TASK_ID })`. Note the current `status`.
   If `task.blockedBy.length > 0`, the task has unresolved dependencies — call
   `add_note({ content: "[BLOCKER] waiting on: <blockedBy task IDs>" })` and stop.
   Do not spawn a worker. The system will send `[KANBAN EVENT] Task unblocked` (see
   Failure handling) when the last dependency resolves; resume from step 1 at that point.
3. Call `spawn_stage_worker({ task_id: AGENTOS_TASK_ID, stage: <current status>, thread_id: AGENTOS_THREAD_ID })`.
4. **Stop.** Do not poll, do not call `get_task` in a loop, do not disable autopilot.
   When the worker finishes, a `[STAGE COMPLETE]` message is automatically appended
   to this thread — that message is your cue to decide the next action.
5. When `[STAGE COMPLETE]` arrives, read its `summary` and `suggested_next_stage`.

   **Approval gate before long-running work**: if the next stage (per the order-based
   advance below) is a heavy execution stage — typically the first stage where the
   worker writes code or makes destructive changes — call `ask_clarification` posting
   the prior stage's summary so the user can confirm the scope and plan before that
   work begins. Wait for their reply.
   - If they approve or have no objections → proceed to **Advance** below.
   - If they request changes → **Retry** the prior stage with a note describing what
     to adjust (counts toward the two-retry limit).

   Use judgment: the gate exists to protect the user from unbounded work that's
   expensive to undo. In a default pipeline this lands between the plan-shaped stages
   and the code-writing stage. If the project's stages don't have a clear "before code"
   point, skip the gate.

   Then choose one:
   - **Advance**: the work looks complete. Refresh the stage list via `list_stages` if
     more than one stage has been completed since you last fetched it (projects can be
     reconfigured mid-flight). Find the current stage's `order` and advance to the
     **next non-terminal stage** with a higher `order` value (skip any terminal stages
     when scanning). **Exception**: if `suggested_next_stage` refers to a stage with a
     *lower* order than the current stage (a backward move, e.g. routing back to an
     earlier stage after a changes-requested review), honor that instead of the
     order-based next stage. Call
     `move_task({ task_id: AGENTOS_TASK_ID, status: <next stage>, thread_id: AGENTOS_THREAD_ID })`,
     then go to step 3 with the new stage.
   - **Retry**: the worker reported insufficient progress or the result is unusable.
     Call `add_note` first explaining what needs to differ, then `spawn_stage_worker`
     for the **same** stage. Do not loop more than twice on the same stage without
     escalating — after two retries on the same stage, treat it as a Block.
   - **Block**: the worker hit something you can't resolve (missing context, external
     dependency, ambiguous requirements). Call `add_note({ content: "[BLOCKER] <reason>" })`
     and stop. Do not spawn another worker.
   - **Done**: no non-terminal stage has a higher `order` than the current stage —
     i.e. the current stage is the last non-terminal one. Move to a terminal stage
     (`done` in default pipelines; consult `list_stages` for the project's terminal
     stages) and stop. Do not spawn another worker.
6. The `[STAGE COMPLETE]` message may also arrive with status `blocker` or
   `error` — treat those as Block (step 5, "Block").

## Stage progression

**Always derive the pipeline from `list_stages`** — stage ids, labels, and orderings
are user-configurable per project. Never hardcode stage names or counts in your
reasoning; never assume a particular id (`planning`, `reviewing`, etc.) exists.

For reference, a default project ships with `backlog (-1) → researching (0) → planning
(1) → implementing (2) → reviewing (3) → done (4)`, but any of these can be renamed,
reordered, or have custom stages inserted (e.g. a "Create PR" stage between reviewing
and done). Treat that list as illustrative, not authoritative.

New tasks land at whatever the project defines as the starting stage. The pipeline
is **not auto-collapsed** by `taskType` — the orchestrator decides the path based on
the task, the stage list, and worker feedback:

- `dev` tasks: walk the full stage list in order.
- `research` tasks: walk the full stage list. The execution stage is the research
  phase; the review stage is the report writeup. (When a research task moves into the
  review stage, the system persists a research report to memory automatically.)
- `review` tasks: skip from the early refinement stages directly into a review stage
  once scope is clear.
- `refine` tasks: end after the refinement step lands — move directly to a terminal
  stage.

Always start from the task's current `status` (per `get_task`) and advance by stage
`order` (via `list_stages`). Only honor `suggested_next_stage` when it is a backward
move (lower order than the current stage), such as routing back to an earlier stage
after a changes-requested review.

## Things NOT to do

- Do not do the engineering work yourself. If you find yourself reading code, writing
  code, or running commands, stop — that's a stage worker's job. Spawn one.
- Do not spawn more than one stage worker at a time for the same task.
- Do not call `move_task` preemptively before a worker reports. The worker may be
  mid-flight; moving the task under it causes confusion.
- Do not ignore `[STAGE COMPLETE]` messages. Every one requires a decision.

## Failure handling

- If `spawn_stage_worker` returns an error, read the error, `add_note` with what
  went wrong, and retry once. If it fails twice, record `add_note({ content: "[BLOCKER] ..." })`
  and stop.
- If you receive a `[STAGE COMPLETE]` but `get_task` shows the task status already
  matches the `suggested_next_stage`, someone (a human, another process) already
  moved it — just spawn the worker for the new stage and continue.
- If you receive a `[STAGE WORKER EXITED]` message, the worker process died without
  reporting a stage result (crash or container kill). Inspect recent task notes/events
  via `get_task` for clues, then either retry the stage once or block.
- If you receive a `[STAGE WORKER STOPPED]` message, the worker was force-stopped
  externally. Wait for user input before spawning again.
- If you receive a `[KANBAN EVENT] Task moved externally` message, a human or another
  process changed the task's status out from under you. Re-read with `get_task` and
  resume from the new `status` (do not blindly continue with the stage you were on).
- If you receive a `[KANBAN EVENT] Task unblocked` message, a dependency has resolved.
  Call `get_task` to confirm `blockedBy` is now empty. If it is, resume from step 1
  (do not assume the stage is unchanged — re-read it). If `blockedBy` is still non-empty,
  other dependencies remain; add a note and stop again.
