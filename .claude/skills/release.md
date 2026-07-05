---
name: release
description: Bump the app version and push a new release tag to trigger the GitHub Actions build
metadata:
  agentos:
    emoji: "🚀"
    requires:
      bins: ["git", "npm"]
---

# Release Skill

Use this skill when the user asks to "do a release", "ship a new version", or "bump the version".

## Context

- App lives in `agentos/` (Electron + Vite). Releases are driven by GitHub Actions on a new tag.
- Release script: `agentos/scripts/release.sh [patch|minor|major]` — defaults to `patch`.
- The script requires being on `main`. If running from a worktree on a feature branch, perform the steps manually.

## Workflow

1. Check current version: `grep '"version"' agentos/package.json`
2. Check recent commits since last version bump to confirm there's something to release.
3. Confirm with the user: bump type (patch/minor/major) and new version number.
4. **If on `main`:** run `cd agentos && bash scripts/release.sh patch` (or minor/major).
5. **If on a feature branch / worktree where `main` is checked out elsewhere:**
   - `cd agentos && npm version patch --no-git-tag-version` → outputs the new version (e.g. `<new version>`)
   - `git add agentos/package.json agentos/package-lock.json`
   - `git commit -m "chore: bump version to <new version>"`
   - `git tag <new version>`
   - `git push origin HEAD:main`
   - `git push origin <new version>`
6. Confirm push succeeded and share the Actions URL: `https://github.com/shinydrift/workspace/actions`

## Notes

- Always confirm the bump type before writing any files.
- Do not skip the user confirmation step — pushing a tag is irreversible.
