/**
 * Tests for utils/worktree.ts — pure helpers used by worktree management and git summary rendering.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// ── Inlined from worktree.ts ──────────────────────────────────────────────────

function sanitizeName(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session'
  );
}

function ensureGitignoreEntry(repoRoot, entry) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  try {
    let existing = '';
    try {
      existing = fs.readFileSync(gitignorePath, 'utf8');
    } catch {
      /* file doesn't exist yet */
    }
    if (!existing.split('\n').some((line) => line.trim() === entry)) {
      fs.writeFileSync(
        gitignorePath,
        existing.endsWith('\n') || existing === '' ? `${existing}${entry}\n` : `${existing}\n${entry}\n`
      );
    }
  } catch {
    /* best-effort */
  }
}

function normalizeChangeStatus(raw) {
  const code = raw[0] ?? raw;
  if (code === 'A') return 'added';
  if (code === 'M') return 'modified';
  if (code === 'D') return 'deleted';
  if (code === 'R') return 'renamed';
  if (code === 'C') return 'copied';
  if (code === 'T') return 'type-changed';
  if (code === 'U') return 'conflicted';
  return raw.toLowerCase();
}

function parseNameStatus(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const rawStatus = parts[0] ?? '';
      if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
        const from = parts[1] ?? '';
        const to = parts[2] ?? from;
        return { path: `${from} -> ${to}`.trim(), status: normalizeChangeStatus(rawStatus) };
      }
      return { path: parts[1] ?? '', status: normalizeChangeStatus(rawStatus) };
    })
    .filter((entry) => entry.path);
}

// ── sanitizeName ──────────────────────────────────────────────────────────────

test('sanitizeName lowercases input', () => {
  assert.equal(sanitizeName('MySession'), 'mysession');
});

test('sanitizeName replaces spaces with dashes', () => {
  assert.equal(sanitizeName('my session name'), 'my-session-name');
});

test('sanitizeName removes leading and trailing dashes', () => {
  assert.equal(sanitizeName('-leading-trailing-'), 'leading-trailing');
});

test('sanitizeName collapses multiple separators', () => {
  assert.equal(sanitizeName('a  b__c'), 'a-b-c');
});

test('sanitizeName truncates to 40 characters', () => {
  const result = sanitizeName('a'.repeat(50));
  assert.equal(result.length, 40);
});

test('sanitizeName returns "session" for empty result', () => {
  assert.equal(sanitizeName('!!!'), 'session');
});

test('sanitizeName keeps hyphens', () => {
  assert.equal(sanitizeName('feature-branch'), 'feature-branch');
});

test('sanitizeName keeps numbers', () => {
  assert.equal(sanitizeName('release-v2-0'), 'release-v2-0');
});

test('sanitizeName strips special characters', () => {
  assert.equal(sanitizeName('feat: add thing'), 'feat-add-thing');
});

test('sanitizeName returns empty-string fallback as "session"', () => {
  assert.equal(sanitizeName(''), 'session');
});

// ── ensureGitignoreEntry ──────────────────────────────────────────────────────

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-worktree-test-'));
}

test('ensureGitignoreEntry creates .gitignore when missing', () => {
  const dir = makeTmp();
  try {
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('.agentos/worktrees/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureGitignoreEntry appends entry to existing .gitignore', () => {
  const dir = makeTmp();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('node_modules/'));
    assert.ok(content.includes('.agentos/worktrees/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureGitignoreEntry is idempotent — does not add duplicate', () => {
  const dir = makeTmp();
  try {
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const lines = content.split('\n').filter((l) => l.trim() === '.agentos/worktrees/');
    assert.equal(lines.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureGitignoreEntry adds newline separator when existing content lacks trailing newline', () => {
  const dir = makeTmp();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist');
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('\n.agentos/worktrees/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureGitignoreEntry written entry ends with newline', () => {
  const dir = makeTmp();
  try {
    ensureGitignoreEntry(dir, '.agentos/worktrees/');
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(content.endsWith('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('parseNameStatus maps standard file statuses', () => {
  const parsed = parseNameStatus(['A\tnew.ts', 'M\tsrc/app.ts', 'D\told.ts'].join('\n'));
  assert.deepEqual(parsed, [
    { path: 'new.ts', status: 'added' },
    { path: 'src/app.ts', status: 'modified' },
    { path: 'old.ts', status: 'deleted' },
  ]);
});

test('parseNameStatus formats rename entries', () => {
  const parsed = parseNameStatus('R100\told-name.ts\tnew-name.ts');
  assert.deepEqual(parsed, [{ path: 'old-name.ts -> new-name.ts', status: 'renamed' }]);
});

test('parseNameStatus ignores empty lines', () => {
  const parsed = parseNameStatus('\n\nM\tsrc/app.ts\n');
  assert.deepEqual(parsed, [{ path: 'src/app.ts', status: 'modified' }]);
});

// ── isBranchSyncedWithRemote (integration) ────────────────────────────────────

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function isBranchSyncedWithRemote(worktreePath) {
  try {
    const ahead = runGit(['-C', worktreePath, 'rev-list', '--count', '@{u}..HEAD']);
    const behind = runGit(['-C', worktreePath, 'rev-list', '--count', 'HEAD..@{u}']);
    return ahead === '0' && behind === '0';
  } catch {
    return false;
  }
}

function makeTrackedRepo() {
  const remote = makeTmp();
  const local = makeTmp();
  runGit(['init', '--bare', remote]);
  runGit(['init', local]);
  runGit(['-C', local, 'config', 'user.email', 'test@test.com']);
  runGit(['-C', local, 'config', 'user.name', 'Test']);
  runGit(['-C', local, 'commit', '--allow-empty', '-m', 'init']);
  runGit(['-C', local, 'remote', 'add', 'origin', remote]);
  runGit(['-C', local, 'push', '-u', 'origin', 'HEAD']);
  return { remote, local };
}

test('isBranchSyncedWithRemote returns true when fully in sync', () => {
  const { remote, local } = makeTrackedRepo();
  try {
    assert.equal(isBranchSyncedWithRemote(local), true);
  } finally {
    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test('isBranchSyncedWithRemote returns false when local has unpushed commits', () => {
  const { remote, local } = makeTrackedRepo();
  try {
    fs.writeFileSync(path.join(local, 'new.txt'), 'data');
    runGit(['-C', local, 'add', 'new.txt']);
    runGit(['-C', local, 'commit', '-m', 'unpushed']);
    assert.equal(isBranchSyncedWithRemote(local), false);
  } finally {
    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test('isBranchSyncedWithRemote returns false when remote is ahead of local', () => {
  const { remote, local } = makeTrackedRepo();
  const local2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-worktree-test-'));
  try {
    runGit(['clone', remote, local2]);
    runGit(['-C', local2, 'config', 'user.email', 'test@test.com']);
    runGit(['-C', local2, 'config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(local2, 'remote.txt'), 'data');
    runGit(['-C', local2, 'add', 'remote.txt']);
    runGit(['-C', local2, 'commit', '-m', 'remote-commit']);
    runGit(['-C', local2, 'push']);
    // fetch so the tracking ref in local1 sees the new commit
    runGit(['-C', local, 'fetch', 'origin']);
    assert.equal(isBranchSyncedWithRemote(local), false);
  } finally {
    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(local, { recursive: true, force: true });
    fs.rmSync(local2, { recursive: true, force: true });
  }
});

test('isBranchSyncedWithRemote returns false when no upstream configured', () => {
  const dir = makeTmp();
  try {
    runGit(['init', dir]);
    runGit(['-C', dir, 'config', 'user.email', 'test@test.com']);
    runGit(['-C', dir, 'config', 'user.name', 'Test']);
    runGit(['-C', dir, 'commit', '--allow-empty', '-m', 'init']);
    assert.equal(isBranchSyncedWithRemote(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
