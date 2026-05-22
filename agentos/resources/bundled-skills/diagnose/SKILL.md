---
name: diagnose
description: Diagnose session tool failures, categorize root causes, and suggest targeted fixes
metadata:
  agentos:
    emoji: "🔍"
---

# Diagnose Session Tool Failures

Work through these steps in order. Stop as soon as you have enough to give actionable recommendations.

## Step 1 — Check the debug log

The debug log is the fastest, most reliable signal. Run:

```bash
LATEST=$(ls -t ~/.claude/debug/*.txt 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then echo "No debug log found — skip to Step 2"; else grep -iE "error|denied|fail|unavailable|timeout" "$LATEST" | tail -200; fi
```

Look for:
- `permission denied` / `not allowed` → permission gap in settings.json
- `MCP.*unavailable` / `failed to connect` / `ECONNREFUSED` → MCP server down or misconfigured
- `tool not found` / `deferred` → tool schema not fetched before use
- `ENOENT` / `no such file` → bad path passed to a tool
- `429` / `rate limit` / `timeout` → throttling or slow external service
- Repeated identical failure → likely a logic bug, not env issue

## Step 2 — Scan the current session

If the debug log was unavailable or inconclusive, scan the conversation history for:
- Tool calls that returned an error or empty/unexpected result
- "permission denied" or "not allowed" responses
- MCP tool calls that failed with "server unavailable" or "tool not found"
- Bash commands that errored silently or returned unexpected exit codes
- ToolSearch calls that returned no results

Note each failure: tool name, error message (or symptom), how many times it occurred.

## Step 3 — Search memory for prior resolutions

```
memory_search("tool failure", project_id=$AGENTOS_PROJECT_ID, thread_id=$AGENTOS_THREAD_ID)
```

If similar failures have been seen before, surface the prior resolution and apply it. If memory returns nothing, continue.

## Step 4 — Check settings for permission gaps (only if permission error found)

Only run this step if Steps 1–2 revealed a permission denied error:

```bash
cat ~/.claude/settings.json | grep -A5 '"permissions"'
```

Identify the exact rule needed. Use the `update-config` skill to add it.

## Step 5 — Categorize and report

If no failures were found in any step, report: "No tool failures detected in this session."

Otherwise, for each failure found, output:

| # | Tool | Error type | Root cause | Fix |
|---|------|------------|------------|-----|
| 1 | `Bash(git push)` | permission denied | not in allow list | `/update-config` → add `Bash(git push:*)` |
| 2 | `mcp__agentos-memory__memory_save` | MCP unavailable | agentos-memory server not running | check MCP config in settings |
| 3 | `WebFetch` | deferred tool not fetched | ToolSearch not called first | call `ToolSearch(select:WebFetch)` before use |

## Fix recipes by category

**Permission denied**
→ Run `/update-config` and describe the blocked tool. It will add the right allow rule to settings.json.

**MCP server unavailable**
→ Check `~/.claude/settings.json` under `mcpServers`. Verify the server entry exists, the command/URL is correct, and the process is running.

**Deferred tool not fetched**
→ Always call `ToolSearch("select:ToolName")` before invoking a deferred tool. Add this as a first step in relevant workflows.

**ENOENT / bad path**
→ Verify paths with `Glob` before passing them to tools. Never assume a path exists.

**Rate limit / timeout**
→ Add a wait between retries. For MCP tools, check if the backing service is healthy. For Anthropic API, reduce parallel tool calls.

**Repeated identical failure**
→ Root cause is in the calling logic, not the environment. Trace back to why the same bad call is being made.

## Optimization suggestions

After diagnosing failures, check for these common inefficiencies:

- **Redundant reads**: same file read multiple times in one turn → read once, reuse result
- **Sequential independent calls**: tool calls that don't depend on each other but run one-at-a-time → batch into parallel calls
- **ToolSearch on every turn**: if a deferred tool is used repeatedly across sessions, consider adding it to a permanent allow list
- **Memory not used**: if the same context is re-derived from code each session → save with `memory_save_chunk` after first derivation
