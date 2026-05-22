# AgentOS — Agent Instructions

## Project

Electron + Vite + React + TypeScript. Main process: `src/main/`, renderer: `src/renderer/`, shared types: `src/shared/types.ts`.

**Do NOT** start a preview/dev server. This is an Electron app — Vite alone renders nothing.

**Ignore the `[Preview Required]` stop hook entirely.** It fires from the Claude Preview MCP plugin which does not apply to Electron apps. Never call `preview_start` or any `preview_*` tool for this project.

## Verification (required before every commit)

After any TypeScript or TSX edit, run both checks and fix all issues before committing:

```
npx tsc --noEmit          # must produce zero output
npx eslint --ext .ts,.tsx .  # must produce zero errors (warnings are ok only if pre-existing)
```

If either fails, fix the issues — do not commit with errors.

## Formatting

Prettier is configured. Run on files you edited:

```
npx prettier --write "src/**/*.{ts,tsx}"
```

Or for a single file: `npx prettier --write <path>`

## Dependency pins

- `sqlite-vec` is intentionally pinned to an exact version (no `^`). It is a native extension shipped in packaged binaries — silent upgrades could break vector similarity silently. Before bumping, run `tests/main/memory/sqliteVec.test.mjs` in an Electron context to verify cosine similarity correctness.
- `web-tree-sitter` is capped at `^0.25.x`. Version 0.26+ requires WASM files built with the `dylink.0` format, but `tree-sitter-wasms` ships the old `dylink` format. Do not bump past 0.25.x until `tree-sitter-wasms` is updated to match.

## Known pre-existing issues to leave alone

- ESLint warning in `ThreadManager.ts` (control chars in `stripAnsi` regex) — do not touch.

## Style

- Single quotes, 120 char print width, trailing commas (ES5) — see `.prettierrc.json`.
- Match the surrounding code's style. Do not reformat untouched lines.
