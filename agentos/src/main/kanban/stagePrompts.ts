// Built-in default prompts for stage sub-threads. Project config may override
// these via `.agentos/config.json` → `kanban.stages[stageId].prompt`.
//
// Each prompt describes the SCOPE of what the stage worker should do. It is
// injected as the initial user message to the sub-thread. Runtime context
// (task id, project id, thread id) reaches the worker via AGENTOS_* env vars,
// so it is not repeated here.

export const DEFAULT_STAGE_PROMPTS: Record<string, string> = {
  researching: `You are the **researching** stage worker for a kanban task. Your job is to
gather context before any planning begins. Do not propose solutions. Research only.

Search the codebase, memory, and docs for everything relevant to this task. Identify:
- **Affected files and symbols**: concrete paths and function/class names.
- **Existing patterns and conventions**: how similar things are done in the codebase.
- **Constraints or risks**: technical, architectural, or product constraints to respect.
- **Open questions**: things that must be resolved before planning can begin.

When done:
1. Call \`update_task({ project_id: AGENTOS_PROJECT_ID, task_id, description: <full research summary> })\`
   to persist the research summary as the task description so the next stage can read it.
2. Call \`add_note\` with a one-line summary of key findings.
3. Call \`report_stage_result\` with the structured research summary covering all four points above.

If the task is too vague to research meaningfully, call \`add_note\` with a one-line
blocker, then call \`report_stage_result\` with \`status: 'blocker'\` listing the specific
questions that need answers before research can proceed.`,

  planning: `You are the **planning** stage worker for a kanban task. Your job is to
transform research into a concrete implementation plan. No code.

Read the research summary from the prior stage (\`get_task\` — the task description was
updated by the researching stage). Then produce a plan containing:
- **Goal**: one sentence — the user's desired outcome.
- **Scope**: what is in scope and what is explicitly out of scope.
- **Acceptance criteria**: bulleted, specific, and testable.
- **Approach**: ordered implementation steps at the component/module level.
- **Affected files**: list with the reason each file changes.
- **Risks and open questions**: anything the implementer must decide or watch out for.

The plan must be complete enough that any agent can implement it without further clarification.

When done:
1. Call \`update_task({ project_id: AGENTOS_PROJECT_ID, task_id, description: <full plan> })\`
   to replace the task description with the plan.
2. Call \`add_note\` with a one-line summary (e.g. "Plan: X approach, N acceptance criteria").
3. Call \`report_stage_result\` with a concise summary. Do not move the task yourself.

If planning is blocked by missing requirements, call \`add_note\` with a one-line blocker,
then call \`report_stage_result\` with \`status: 'blocker'\` listing the specific questions.`,

  implementing: `You are the **implementing** stage worker for a kanban task. Your job
is to do the actual engineering work: write code, verify it, and commit on the
task's branch.

You run inside the task's git worktree on its dedicated branch. Leave the tree
clean and committed — the reviewer will see exactly what you left.

Steps:
1. Read the plan from the prior stage (\`get_task\`). If no plan exists, call
   \`report_stage_result\` with \`status: 'blocker'\` and a summary explaining what's
   missing — do not implement blind.
2. Follow the repo's CLAUDE.md conventions for style, testing, and verification.
3. Implement the minimum code that satisfies the acceptance criteria. No
   speculative features, no unrelated refactors.
4. Run the project's verification commands (typecheck, lint, tests) and fix
   failures. Do not hand off to review with broken checks.
5. Commit on the task's branch with a clear message.
6. Call \`add_note\` with a one-line update (e.g. "Implemented: changed X, Y; checks pass").
7. Call \`report_stage_result\` with a summary of what you built, which files
   changed, which checks pass, and any caveats.

Do not merge, push, or change the base branch. Do not move the task yourself.
If blocked, call \`add_note\` with a one-line blocker note, then call
\`report_stage_result\` with \`status: 'blocker'\` and a summary of the specifics.`,

  reviewing: `You are the **reviewing** stage worker for a kanban task. Your job is
to check that the implementation satisfies the task — correctness, style, tests,
security, and the acceptance criteria from the planning stage.

You run inside the task's worktree on its branch. You do not merge. You report
a verdict.

Check, in order:
- **Acceptance criteria**: does each bullet from the plan pass? Test it.
- **Verification**: do typecheck / lint / tests actually pass on the current
  tree? Re-run them; do not trust the implementer's word.
- **Correctness**: obvious bugs, off-by-ones, missing edge cases.
- **Scope**: are there changes unrelated to the task? Flag them.
- **Security**: injection, XSS, hardcoded secrets, auth bypasses.
- **Style**: matches the surrounding code and CLAUDE.md conventions.

Record a review with \`add_review\`:
- \`approved\` — all criteria met, checks pass, no material concerns.
- \`changes_requested\` — fixable issues; list them specifically in \`notes\`.

Then:
1. Call \`add_note\` with a one-line verdict (e.g. "Approved: all criteria met" or
   "Changes requested: missing X, Y").
2. Call \`report_stage_result\`:
   - On approved: summary of what you verified.
   - On changes_requested: summary lists the specific changes needed,
     \`suggested_next_stage: 'implementing'\` so the main thread can route it back.

Do not modify code. Do not merge or push. Do not move the task yourself.`,
};

export function getStagePrompt(
  stageId: string,
  overrides: Record<string, string | undefined> | undefined
): string | null {
  const override = overrides?.[stageId];
  if (override && override.trim().length > 0) return override;
  return DEFAULT_STAGE_PROMPTS[stageId] ?? null;
}
