import path from 'path';
import { normalizeSubdir } from '../../shared/utils/subdir';

/**
 * Where the provider CLI should actually run for a thread.
 *
 * On host execution the CLI runs in the real directory, so descend into the project's repo-root-
 * relative subdir when one is set. Under Docker the cwd is irrelevant — the container's workdir
 * is fixed to /workspace/<subdir> at `docker run` and `docker exec` inherits it — so the mount
 * root is returned unchanged. `subdir` is normalized defensively (rejects `..`/absolute escapes)
 * even though callers pass an already-normalized snapshot.
 */
export function effectiveHostCwd(workingDirectory: string, subdir: string | undefined, runOnHost: boolean): string {
  const norm = normalizeSubdir(subdir);
  return runOnHost && norm ? path.join(workingDirectory, norm) : workingDirectory;
}

/**
 * Claude derives its session-JSONL project dir from its cwd, replacing every non-alphanumeric
 * char with '-'. The watcher and the headless resume pre-check must target that exact dir, so the
 * name has to track wherever claude actually runs: the host cwd on host, or /workspace/<subdir>
 * inside the container. Keep this in lockstep with the workdir set in buildDockerRunArgs.
 */
export function claudeProjectDirName(workingDirectory: string, subdir: string | undefined, runOnHost: boolean): string {
  const norm = normalizeSubdir(subdir);
  const cwd = runOnHost
    ? effectiveHostCwd(workingDirectory, norm, true)
    : norm
      ? path.posix.join('/workspace', norm)
      : '/workspace';
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
