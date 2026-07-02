---
name: meeting-notes
description: Produce structured meeting notes from a recording using agentos-recordings MCP
metadata:
  agentos:
    emoji: "📝"
---

You have been given EITHER a `recording_id` (a single manual recording) OR a `window_from` / `window_to` pair (unix ms — a time slot of continuous-capture segments). Produce structured meeting notes:

**If given a `recording_id`:**

1. Call `mcp__agentos-recordings__get_recording_meta` with the recording_id to get `duration_seconds` and `created_at` (unix ms).
2. Call `mcp__agentos-recordings__get_transcript` with the recording_id to get the raw transcript text.

**If given `window_from` / `window_to`:**

1. Call `mcp__agentos-recordings__list_segments` with `from` = window_from and `to` = window_to to see which segments cover the slot. Derive the date from window_from and the duration from (window_to − window_from).
2. Call `mcp__agentos-recordings__get_window_transcript` with the same `from` / `to` to get the merged transcript across the slot. This is your transcript for the notes.

**Then, for either case:**

3. Call `mcp__agentos-thread__get_app_settings` to check `settings.recording` for an `activeTemplateId` and `templates` array. If an active template exists, use its `content` as the notes template. Replace any `{date}`, `{duration}`, `{transcript}` placeholders with the values from steps 1–2.

If no custom template is set, use this format:

**Title:** (infer a concise title from the discussion)
**Date:** (ISO date derived from created_at)
**Duration:** (duration_seconds formatted as M:SS)

## Summary
(3–5 sentences summarizing what was discussed)

## Key Decisions
- (bullet list of decisions made; omit section if none)

## Action Items
- [ ] Task description — Owner: (person if mentioned) | Due: (date if mentioned)

## Open Questions
- (unresolved items or follow-ups; omit section if none)

After producing the notes: if you were given a `recording_id`, call `mcp__agentos-thread__set_recording_title` with the recording_id and the inferred title to update the recording and rename this thread. (In window mode there is no single recording to title — skip this call.) Then feel free to answer follow-up questions about this meeting.
