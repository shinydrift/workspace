---
name: git
description: Safe, explicit git workflows for branching, commits, rebases, and reviews
metadata:
  agentos:
    emoji: "🌿"
    requires:
      bins: ["git"]
---

# Git Skill

Use explicit git commands and confirm branch context before mutating history.

- Check status: `git status -sb`
- Review diff: `git diff --stat` and `git diff`
- Commit clearly: `git add -p` then `git commit -m "..."`
- Rebase safely: `git fetch --all` then `git rebase origin/<base>`

Avoid destructive history edits unless explicitly requested.
