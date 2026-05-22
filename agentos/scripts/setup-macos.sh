#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '%s\n' "$*"
}

section() {
  printf '\n== %s ==\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found: $1"
  fi
}

section "Checking toolchain"
require_cmd node
require_cmd npm
log "node: $(node --version)"
log "npm:  $(npm --version)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "setup:mac is intended for macOS only"
fi

section "Installing npm dependencies"
npm install


section "Verifying TypeScript"
npx tsc --noEmit

section "Next steps"
log "Start dev app:"
log "  npm start"
log ""
log "Package macOS app:"
log "  npm run package:mac"
log ""
log "Optional signing/notarization env vars:"
log "  CSC_NAME"
log "  APPLE_ID"
log "  APPLE_APP_SPECIFIC_PASSWORD"
log "  APPLE_TEAM_ID"
