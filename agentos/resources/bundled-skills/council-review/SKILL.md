---
name: council-review
description: Run a council of multiple LLMs against a prompt, then synthesize their answers — similarities, differences, and a recommendation
metadata:
  agentos:
    emoji: "⚖️"
---

# Council Review Skill

Use this skill when the user asks to "run this by the council", "ask the council",
"get a second opinion from other models", or otherwise wants the same prompt
evaluated by multiple LLM provider/model combinations in parallel and a synthesis.

## Tools

The `agentos-council` MCP sidecar exposes two tools for dispatching and reading:

- `council_list_configs()` — list stored councils. Each has `id`, `name`, `members[]`.
- `council_dispatch({ config_id, parent_thread_id, prompt })` — spawn one child sub-thread per
  member. Returns `{ runId, status }` immediately. Pass `AGENTOS_THREAD_ID` as `parent_thread_id`.
- `council_read_outcomes({ run_id })` — returns `{ status, complete, members[], outcomes[] }` where
  each outcome has `member`, `status` (`submitted` | `invalid` | `error` | `timeout`), `summary`,
  `answer`, `confidence`, `caveats`, `error`.

## Workflow

1. Call `council_list_configs`. If there are zero configs or the user hasn't named one, ask
   the user which council to use.
2. Call `council_dispatch` with the chosen `config_id`, `AGENTOS_THREAD_ID`, and the prompt to
   evaluate. Capture `runId`.
3. Stop after dispatching. Do not poll, do not call `council_read_outcomes`, do not disable
   autopilot. When all members complete, a synthesis message is automatically appended to
   this thread — that message is your cue to synthesize.
4. When the synthesis message arrives, call `council_read_outcomes({ run_id: runId })` once
   to fetch all outcomes, then write your synthesis as your normal next assistant message. Cover:
   - **Similarities**: points every (or most) member agreed on
   - **Differences**: where members diverged, and what each said
   - **Confidence**: which members reported high vs. low confidence
   - **Recommendation**: your judgement on the best path forward, citing members by name
5. Do NOT just dump the raw outcomes — synthesize. The user wants your reading of the
   disagreement, not a transcript.

## Failure handling

- If `complete=true` but every outcome is `error`/`invalid`/`timeout`, tell the user the
  council failed and surface the `error` strings.
- If only some members succeeded, synthesize the successful ones and note which members
  did not return a usable answer.
