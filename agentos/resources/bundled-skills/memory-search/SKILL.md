---
name: memory-search
description: Search project memory, source code, and knowledge graph via an isolated Explore subagent — call this instead of memory_search/code_search/memory_graph_query directly
metadata:
  agentos:
    emoji: "🔍"
---

Delegate memory and code searches to an isolated Explore subagent. **Always use this skill instead of calling memory_search, code_search, or memory_graph_query directly from the main agent.**

## When to invoke

- At the start of any non-trivial task to surface prior decisions and context
- When you encounter something unexpected mid-task and need more context
- Args: one or more search queries as natural language (e.g. `/memory-search AuthService token validation`)

## Multiple queries

If a task needs multiple distinct lookups (e.g. prior decisions about a feature AND code for a symbol), invoke `/memory-search` once per query — or combine them into one subagent prompt that runs all searches in parallel. Never skip searching because you think you already know the answer.

## Steps

1. Spawn an Explore subagent via the Agent tool with `subagent_type=Explore`. In the prompt, substitute your known `project_id` and `thread_id` values (from `$AGENTOS_PROJECT_ID` and `$AGENTOS_THREAD_ID`) directly into each tool call. Run all relevant searches in parallel:
   - `memory_search(query="…", project_id="<project_id>", thread_id="<thread_id>", max_results=5)` — saved knowledge, session history, decisions
   - `code_search(query="…", project_id="<project_id>", thread_id="<thread_id>", max_results=5)` — indexed source code
   - `memory_graph_query(entity="…", project_id="<project_id>", thread_id="<thread_id>")` — entity relationships and dependencies (include this when exploring unfamiliar code or tracing what depends on what)

   Ask the subagent to call `memory_get(entry_id)` on any relevant but truncated results, and to return only the findings that are relevant: file paths with line numbers, key decisions, code snippets, and graph edges.

2. Pull only the relevant findings back into your context. Do not copy raw tool output wholesale.

3. If results are insufficient or unexpected, invoke `/memory-search` again with a narrower or different query.
