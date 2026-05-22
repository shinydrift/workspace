---
name: github
description: Work with GitHub repositories, pull requests, issues, and workflows using gh CLI
metadata:
  agentos:
    emoji: "🐙"
    requires:
      bins: ["gh"]
---

# GitHub CLI Skill

Use `gh` for GitHub operations.

- List PRs: `gh pr list --repo owner/repo`
- Check PR status: `gh pr checks <number> --repo owner/repo`
- List issues: `gh issue list --repo owner/repo`
- Show run logs: `gh run view <run-id> --repo owner/repo --log`

Prefer `--repo owner/repo` when not in the target repository.
