---
name: save-session-chunk
description: Distill and save a memory chunk from the current turn to the session index
metadata:
  agentos:
    emoji: "🧠"
---

Review the work you just completed in this turn.

Worth saving: decisions made, user preferences stated, facts about the project, problems solved, code or config produced, bugs fixed.
Not worth saving: clarifications, greetings, retries, intermediate tool steps.

If nothing is worth saving, stop here.

For each distinct topic worth saving:
1. Write distilled, indexable prose — not raw conversation, no speaker labels.
2. One topic per call. Under 1400 characters.
3. Call memory_save_chunk with:
   - summary: one sentence describing what this chunk is about
   - text: the distilled prose
   - project_id: $AGENTOS_PROJECT_ID
   - thread_id: $AGENTOS_THREAD_ID
4. Note the returned chunk_id.
5. Call memory_link with the chunk_id and any entities/edges you know from this turn:
   - entities: files you created or modified (type: 'file'), functions or classes (type: 'symbol'), issues you fixed (type: 'issue'), decisions made (type: 'decision')
   - edges: explicit relationships — e.g. {from: 'fixLogin', to: '#42', relation: 'fixes'}, {from: 'auth.ts', to: 'db.ts', relation: 'depends_on'}
   - project_id: $AGENTOS_PROJECT_ID, thread_id: $AGENTOS_THREAD_ID
   Only include entities and edges you are certain about. Skip if nothing specific.

If you find existing session chunks that are now wrong or irrelevant (e.g. a decision that was reversed), call memory_search to find them and memory_delete(entry_id) to remove them.
