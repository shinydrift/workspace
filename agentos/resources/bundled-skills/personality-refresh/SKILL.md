---
name: personality-refresh
description: Analyze recent user messages across all project threads and update the personality profile
metadata:
  agentos:
    emoji: '✨'
---

Refresh the personality profile for this project by analyzing recent user messages.

## Steps

1. Compute `since_ms` = current Unix timestamp in milliseconds minus 90 days (90 × 24 × 60 × 60 × 1000).
   Call `list_project_messages` with `role: "user"`, `limit: 100`, and `since_ms` set to that value.
   Pass `$AGENTOS_THREAD_ID` as `thread_id`.

2. If fewer than 3 messages are returned, stop — not enough data to derive a profile.

3. Call `get_project_config` with `$AGENTOS_THREAD_ID` to read existing `personality.agentStyle`,
   `personality.autopilotInstructions`, and `personality.bigFive`, if present.

4. Analyze the user messages for:
   - Tone: terse/casual/formal, lowercase preference, question-driven vs imperative
   - Reply length: short one-liners, bullets, fuller sentences
   - Habits: emoji, ellipsis, greetings — only if clearly recurring
   - Domain vocabulary: technical terms or phrases that appear repeatedly

5. Derive two text profiles:

   **agent_style** (4–6 lines): how the AI should respond to match this user's preferred style.
   Must begin with exactly: `Emulate the user's communication style, not their identity. Stay truthful about being an AI.`
   If an existing agentStyle was found, update it — keep stable patterns, incorporate new ones.

   **autopilot_instructions** (2–3 lines): how to compose messages _as_ this user when acting on their behalf.
   Cover: how the user phrases requests, their tone and brevity, any recurring structural patterns.

6. Derive Big Five trait scores (1–5 scale each) from message patterns:
   - **openness** (1 = conventional/literal, 5 = exploratory/imaginative): high if user asks open-ended or speculative questions; low if requests are concrete and narrow.
   - **conscientiousness** (1 = flexible/brief, 5 = thorough/structured): high if user asks for step-by-step plans, verifies edge cases, or uses checklists; low if messages are casual and ad-hoc.
   - **extraversion** (1 = reserved, 5 = expressive): high if user uses greetings, affirmations, or conversational filler; low if messages are pure imperatives with no social content.
   - **agreeableness** (1 = direct/blunt, 5 = empathetic/softening): high if user hedges disagreement or uses polite phrasing; low if user states corrections plainly without softening.
   - **neuroticism** (1 = stable, 5 = reactive): high if user expresses frustration, urgency, or uncertainty frequently; low if tone is consistently steady regardless of outcomes.

   If an existing `bigFive` was found, update scores where the evidence is clear; otherwise keep the prior value for that dimension.

7. Call `update_personality` with:
   - `thread_id`: `$AGENTOS_THREAD_ID`
   - `agent_style`: derived profile
   - `autopilot_instructions`: derived profile
   - `big_five`: derived trait scores
   - `active_preset_id`: `'custom'` (derived traits no longer match a named preset)
   - `generated_at`: current Unix timestamp in milliseconds
   - `message_count`: number of user messages returned in step 1 (the count actually analysed)

Done — no further output needed.
