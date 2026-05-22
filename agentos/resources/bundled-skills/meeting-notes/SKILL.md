---
name: meeting-notes
description: Produce structured meeting notes from a recording using agentos-recordings MCP
metadata:
  agentos:
    emoji: "📝"
---

You have been given a recording_id. Produce structured meeting notes:

1. Call `mcp__agentos-recordings__get_recording_meta` with the recording_id to get `duration_seconds` and `created_at` (unix ms).
2. Call `mcp__agentos-recordings__get_transcript` with the recording_id to get the raw transcript text.
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

After producing the notes, call `mcp__agentos-thread__set_recording_title` with the recording_id and the inferred title to update the recording and rename this thread. Then feel free to answer follow-up questions about this meeting.
