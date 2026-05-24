import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import type { KanbanTaskGitSummary } from '../../shared/types/kanban';
import { eventLogger } from './eventLog';

const execFileAsync = promisify(execFile);

function runGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function runGitAsync(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { encoding: 'utf8' });
  return stdout.trim();
}

function resolveMainRepoRoot(baseDir: string): string {
  const commonDir = runGit(['-C', baseDir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  return path.dirname(commonDir);
}

async function resolveMainRepoRootAsync(baseDir: string): Promise<string> {
  const commonDir = await runGitAsync(['-C', baseDir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  return path.dirname(commonDir);
}

async function ensureGitRepo(projectPath: string): Promise<void> {
  try {
    await runGitAsync(['-C', projectPath, 'rev-parse', '--git-dir']);
  } catch {
    await runGitAsync(['init', projectPath]);
    await runGitAsync(['-C', projectPath, 'config', 'user.email', 'agentos@local']);
    await runGitAsync(['-C', projectPath, 'config', 'user.name', 'AgentOS']);
    await runGitAsync(['-C', projectPath, 'commit', '--allow-empty', '-m', 'chore: initial commit']);
  }
}

function resolveBaseBranch(repoRoot: string): string {
  for (const branch of ['main', 'master']) {
    try {
      runGit(['-C', repoRoot, 'rev-parse', '--verify', branch]);
      return branch;
    } catch {
      /* try next */
    }
  }
  return 'HEAD';
}

function resolveComparisonBaseRef(repoRoot: string): string | null {
  const baseBranch = resolveBaseBranch(repoRoot);
  for (const candidate of [`origin/${baseBranch}`, baseBranch]) {
    try {
      runGit(['-C', repoRoot, 'rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizeChangeStatus(raw: string): string {
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

export function parseNameStatus(output: string): Array<{ path: string; status: string }> {
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

function sanitizeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session'
  );
}

function ensureGitignoreEntry(repoRoot: string, entry: string): void {
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

export function isWorktreeClean(worktreePath: string): boolean {
  try {
    const output = runGit(['-C', worktreePath, 'status', '--porcelain']);
    return output === '';
  } catch {
    return false;
  }
}

export async function isWorktreeCleanAsync(worktreePath: string): Promise<boolean> {
  try {
    const output = await runGitAsync(['-C', worktreePath, 'status', '--porcelain']);
    return output === '';
  } catch {
    return false;
  }
}

export function isBranchSyncedWithRemote(worktreePath: string): boolean {
  try {
    const ahead = runGit(['-C', worktreePath, 'rev-list', '--count', '@{u}..HEAD']);
    const behind = runGit(['-C', worktreePath, 'rev-list', '--count', 'HEAD..@{u}']);
    return ahead === '0' && behind === '0';
  } catch {
    return false;
  }
}

export function pruneOrphanWorktrees(activeWorktreePaths: Set<string>, projectPaths: Set<string> = new Set()): void {
  // Collect all repo roots to scan — from active worktree paths and from known project paths.
  const repoRoots = new Set<string>();
  for (const p of [...activeWorktreePaths, ...projectPaths]) {
    try {
      repoRoots.add(resolveMainRepoRoot(p));
    } catch {
      /* not a git repo */
    }
  }

  for (const repoRoot of repoRoots) {
    const worktreeParent = path.join(repoRoot, '.agentos', 'worktrees');
    if (!fs.existsSync(worktreeParent)) continue;
    for (const entry of fs.readdirSync(worktreeParent)) {
      const candidate = path.join(worktreeParent, entry);
      if (!activeWorktreePaths.has(candidate) && isBranchSyncedWithRemote(candidate)) {
        removeSessionWorktree(candidate);
      }
    }
  }
}

export function removeSessionWorktree(worktreePath: string): void {
  try {
    const repoRoot = resolveMainRepoRoot(worktreePath);
    // Determine the branch name from git worktree list
    const listOutput = runGit(['-C', repoRoot, 'worktree', 'list', '--porcelain']);
    let branchForWorktree: string | null = null;
    let currentWorktree: string | null = null;
    for (const line of listOutput.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentWorktree = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ') && currentWorktree === worktreePath) {
        branchForWorktree = line
          .slice('branch '.length)
          .trim()
          .replace(/^refs\/heads\//, '');
      }
    }
    runGit(['-C', repoRoot, 'worktree', 'remove', '--force', worktreePath]);
    if (branchForWorktree) {
      runGit(['-C', repoRoot, 'branch', '-D', branchForWorktree]);
    }
  } catch {
    // best-effort: ignore errors (worktree may already be gone)
  }
}

export function getTaskGitSummary(
  projectPath: string,
  options: { branch?: string | null; worktreePath?: string | null }
): KanbanTaskGitSummary | null {
  const baseDir = options.worktreePath || projectPath;
  try {
    const repoRoot = resolveMainRepoRoot(baseDir);
    const headBranch = runGit(['-C', baseDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
      .trim()
      .replace(/^HEAD$/, '');
    const branch = options.branch ?? (headBranch || null);
    const targetRef = branch || 'HEAD';
    const diffTargetRef = options.worktreePath ? 'HEAD' : targetRef;
    const comparisonBaseRef = resolveComparisonBaseRef(repoRoot);
    const formatted = runGit(['-C', baseDir, 'log', '-1', `--format=%H%x1f%h%x1f%s%x1f%an%x1f%at`, diffTargetRef]);
    const [headSha, shortSha, subject, authorName, authoredAtRaw] = formatted.split('\x1f');
    if (!headSha || !shortSha || !subject || !authorName || !authoredAtRaw) return null;
    let changedFiles: Array<{ path: string; status: string }> = [];
    if (comparisonBaseRef) {
      try {
        const mergeBase = runGit(['-C', baseDir, 'merge-base', comparisonBaseRef, diffTargetRef]);
        const diffOutput = runGit([
          '-C',
          baseDir,
          'diff',
          '--name-status',
          '--find-renames',
          `${mergeBase}..${diffTargetRef}`,
        ]);
        changedFiles = parseNameStatus(diffOutput);
      } catch {
        /* live diff details are best-effort */
      }
    }
    return {
      branch,
      worktreePath: options.worktreePath ?? null,
      headSha,
      shortSha,
      subject,
      authorName,
      authoredAt: Number(authoredAtRaw) * 1000,
      baseRef: comparisonBaseRef,
      totalChangedFiles: changedFiles.length,
      changedFiles: changedFiles.slice(0, 12),
      isDirty: options.worktreePath ? !isWorktreeClean(options.worktreePath) : null,
    };
  } catch {
    return null;
  }
}

export async function createSessionWorktree(
  baseDir: string,
  sessionName: string,
  sessionId: string
): Promise<string | null> {
  try {
    await ensureGitRepo(baseDir);
    const repoRoot = await resolveMainRepoRootAsync(baseDir);
    const shortId = sessionId.slice(0, 8);
    const slug = sanitizeName(sessionName);
    const branchName = `feature/${slug}-${shortId}`;
    const worktreeParent = path.join(repoRoot, '.agentos', 'worktrees');
    const worktreePath = path.join(worktreeParent, `${slug}-${shortId}`);

    fs.mkdirSync(worktreeParent, { recursive: true });
    ensureGitignoreEntry(repoRoot, '.agentos/worktrees/');
    const baseBranch = resolveBaseBranch(repoRoot);

    // Prefer origin ref to avoid stale local tips; fall back gracefully if unavailable.
    try {
      await runGitAsync(['-C', repoRoot, 'fetch', 'origin', baseBranch]);
    } catch {
      /* network unavailable or no remote – use local */
    }

    // Use origin ref if available, otherwise fall back to local branch
    let startPoint = baseBranch;
    try {
      await runGitAsync(['-C', repoRoot, 'rev-parse', '--verify', `origin/${baseBranch}`]);
      startPoint = `origin/${baseBranch}`;
    } catch {
      /* origin ref not available – use local */
    }

    await runGitAsync(['-C', repoRoot, 'worktree', 'add', '-b', branchName, worktreePath, startPoint]);

    // Verify the worktree actually materialized on disk before reporting success.
    // git worktree add can claim success in edge cases (e.g. concurrent prune) where
    // the directory doesn't end up present, and downstream callers will mount this
    // path into a docker container — a missing source becomes a phantom mount that
    // breaks every subsequent `docker exec`.
    if (!fs.existsSync(worktreePath)) {
      eventLogger.warn('worktree', 'createSessionWorktree: path missing after git worktree add', {
        worktreePath,
        branchName,
      });
      return null;
    }

    return worktreePath;
  } catch (err) {
    eventLogger.warn('worktree', 'createSessionWorktree failed', {
      sessionName,
      sessionId,
      error: String(err),
    });
    return null;
  }
}
