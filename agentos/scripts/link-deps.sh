#!/usr/bin/env bash
#
# link-deps.sh — symlink agentos/node_modules in the current git worktree to the
# root repository's install, so you can run the app from a worktree without a
# per-worktree `npm install` (~1.2G). Run from anywhere inside a linked worktree:
#
#   ./link-deps.sh          # from the worktree top
#   ../link-deps.sh         # or from inside agentos/
#
# Safe to re-run. Only valid while the worktree's dependencies match root; if a
# branch changes deps, do a real `npm install` in that worktree instead.
set -euo pipefail

APP_DIR="agentos"   # subdir holding package.json + node_modules

# Resolve the current worktree and the main (root) worktree via git.
worktree="$(git rev-parse --show-toplevel)"
common_git="$(git rev-parse --git-common-dir)"
common_git="$(cd "$(dirname "$common_git")" && pwd)/$(basename "$common_git")"
root="$(dirname "$common_git")"

if [ "$worktree" = "$root" ]; then
  echo "error: run this from inside a linked worktree, not the root repo ($root)." >&2
  exit 1
fi

src="$root/$APP_DIR/node_modules"
dest="$worktree/$APP_DIR/node_modules"

if [ ! -d "$src" ]; then
  echo "error: no install at $src — run 'npm install' in $root/$APP_DIR first." >&2
  exit 1
fi

# Warn if runtime deps differ from root (a symlink would be stale for this branch).
deps() { node -e "const d=require('$1');console.log(JSON.stringify([d.dependencies,d.optionalDependencies]))"; }
if [ "$(deps "$root/$APP_DIR/package.json")" != "$(deps "$worktree/$APP_DIR/package.json")" ]; then
  echo "warning: dependencies differ from root — the symlink may be stale for this" >&2
  echo "         branch. Consider a real 'npm install' in $worktree/$APP_DIR instead." >&2
fi

if [ -L "$dest" ]; then
  echo "already linked: $dest -> $(readlink "$dest")"
  exit 0
fi
if [ -e "$dest" ]; then
  echo "error: $dest already exists as a real directory." >&2
  echo "       Remove it first ('rm -rf \"$dest\"') if you want to symlink instead." >&2
  exit 1
fi

ln -s "$src" "$dest"
echo "linked: $dest -> $src"
echo "run the app:  (cd \"$worktree/$APP_DIR\" && npm start)"
