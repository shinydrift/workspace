#!/usr/bin/env bash
set -e

# Usage: ./scripts/release.sh [patch|minor|major|current]
# Defaults to patch if no argument given.

MODE=${1:-patch}

# Validate release mode
if [[ "$MODE" != "patch" && "$MODE" != "minor" && "$MODE" != "major" && "$MODE" != "current" ]]; then
  echo "Usage: $0 [patch|minor|major|current]"
  exit 1
fi

# Must be run from inside agentos/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load secrets
if [[ -f release.env ]]; then
  set -a
  source release.env
  set +a
else
  echo "Error: agentos/release.env not found. Create it with GITHUB_TOKEN, CSC_LINK, etc."
  exit 1
fi

# GITHUB_TOKEN comes from the shell env (e.g. exported in ~/.zshrc),
# not release.env, so it can be rotated in one place.
if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "Error: GITHUB_TOKEN is not set. Export it in ~/.zshrc (or your shell env) before running."
  exit 1
fi

# appdmg's native deps (macos-alias via nan) don't compile on Node > 22.
# If the active node is missing/broken/too new, auto-switch to NODE_22_BIN
# (configurable via release.env; defaults to brew's node@22 on Apple Silicon).
if [[ "$(uname -s)" == "Darwin" ]]; then
  NODE_22_BIN="${NODE_22_BIN:-/opt/homebrew/opt/node@22/bin}"
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
  if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -gt 22 ]]; then
    if [[ -x "$NODE_22_BIN/node" ]]; then
      echo "Switching to node@22 at $NODE_22_BIN (appdmg native deps don't build on Node > 22)"
      export PATH="$NODE_22_BIN:$PATH"
    else
      echo "Error: DMG build requires Node 22 at \$NODE_22_BIN (currently: $NODE_22_BIN)."
      echo "       Install with 'brew install node@22', or set NODE_22_BIN in agentos/release.env to the bin directory of your node@22 install."
      exit 1
    fi
  fi

  # macos-alias (appdmg's native dep) compiles against the active SDK's libc++
  # headers. A new SDK (e.g. macOS 26) uses builtins like __builtin_ctzg that an
  # older active clang (e.g. an outdated Xcode.app) can't parse. If the active
  # toolchain doesn't know that builtin but the Command Line Tools clang does,
  # point native builds at the Command Line Tools for this run. The probe uses
  # no headers so it doesn't depend on SDK/sysroot resolution.
  probe_cxx() { echo 'unsigned f(unsigned x){return __builtin_ctzg(x);}' | "$1" -x c++ -std=c++20 -fsyntax-only - >/dev/null 2>&1; }
  if ! probe_cxx "$(command -v clang)"; then
    CLT_CLANG=/Library/Developer/CommandLineTools/usr/bin/clang
    if [[ -x "$CLT_CLANG" ]] && probe_cxx "$CLT_CLANG"; then
      echo "Switching native builds to Command Line Tools (active clang can't compile the current SDK headers)"
      export DEVELOPER_DIR=/Library/Developer/CommandLineTools
    else
      echo "Error: no working C++ toolchain for the current SDK. Update Xcode/Command Line Tools (xcode-select --install)."
      exit 1
    fi
  fi
fi

ensure_appdmg() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return
  fi

  npm install --include=optional --no-save
  if ! node -e "require.resolve('appdmg')" >/dev/null 2>&1; then
    APPDMG_VERSION=$(node -p "require('./package.json').optionalDependencies?.appdmg || ''")
    if [[ -z "$APPDMG_VERSION" ]]; then
      echo "Error: package.json must declare optionalDependencies.appdmg to build the DMG release asset"
      exit 1
    fi

    echo "Installing appdmg@$APPDMG_VERSION..."
    npm install --no-save --no-package-lock "appdmg@$APPDMG_VERSION"
  fi

  node -e "require.resolve('appdmg')" >/dev/null || {
    echo "Error: appdmg is required to build the DMG release asset"
    exit 1
  }
}

# Ensure on main and up to date
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: not on main (currently on $BRANCH). Checkout main first."
  exit 1
fi

git pull origin main
ensure_appdmg

if [[ "$MODE" == "current" ]]; then
  VERSION="v$(node -p "require('./package.json').version")"
  TAG="$VERSION"
else
  # Bump version without letting npm create its own commit/tag
  VERSION=$(npm version "$MODE" --no-git-tag-version)
  TAG="v${VERSION#v}"

  # Commit the version bump from repo root
  cd "$(git rev-parse --show-toplevel)"
  git add agentos/package.json agentos/package-lock.json
  git commit -m "chore: bump version to $VERSION"
fi

cd "$(git rev-parse --show-toplevel)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  if [[ "$(git rev-list -n 1 "$TAG")" != "$(git rev-parse HEAD)" ]]; then
    echo "Error: local tag $TAG points at a different commit"
    exit 1
  fi
else
  git tag "$TAG"
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: remote tag $TAG already exists"
  exit 1
fi

# Push commit only — tag pushed after successful publish
git push origin main

# Build, sign, notarize, and publish to GitHub Releases (draft)
cd agentos
echo ""
echo "Publishing $TAG..."
ensure_appdmg

# Regenerate DMG backgrounds (ensures @2x retina assets are current)
node scripts/generate-dmg-background.js

npm run publish -- --arch arm64

# Tag only after publish succeeds — clean retry if publish fails
cd "$(git rev-parse --show-toplevel)"
git push origin "$TAG"

echo ""
echo "Done — draft release $TAG at https://github.com/shinydrift/workspace/releases"
