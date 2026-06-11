import { mkdir, realpath } from 'fs/promises';
import { isAbsolute, join, relative } from 'path';
import { translateContainerPath } from '../mcp/sandboxPath';
import type { SlackBinding } from './slackWorkspaces';

/**
 * Relative path (under a thread's workingDirectory) where Slack files live in both
 * directions — inbound attachments are saved here, and outbound uploads must originate
 * here. Locking the location to a single folder lets the upload_file MCP tool hard-
 * validate the agent-supplied path without ambiguity.
 */
export const SLACK_UPLOADS_RELATIVE = '.agentos/uploads';
export const SLACK_UPLOADS_CONTAINER_PATH = `/workspace/${SLACK_UPLOADS_RELATIVE}`;

/**
 * Resolves the host workspace path for a Slack-bound thread when the upload_file MCP tool
 * needs to translate a sandbox `/workspace/...` path back to the host filesystem.
 *
 * The agent's `/workspace` is bind-mounted from `thread.workingDirectory` — including
 * worktree paths for branch-isolated threads — so it is the single source of truth.
 * upload_file is only callable from a running agent, so a bound thread always exists.
 */
export function resolveSlackUploadWorkspace(
  binding: Pick<SlackBinding, 'threadId'> | null,
  threadWorkingDirectoryFor: (threadId: string) => string | null
): string | null {
  if (!binding?.threadId) return null;
  return threadWorkingDirectoryFor(binding.threadId);
}

/**
 * Idempotently creates the `.agentos/uploads/` directory inside a thread's workingDirectory
 * on the host. Called when a Slack-routed thread is established so the agent can write
 * outbound files without first having to `mkdir -p` itself, and also reused by the inbound
 * file downloader so both directions share one source of truth.
 */
export async function ensureSlackUploadsDir(workingDirectory: string): Promise<string> {
  const dir = join(workingDirectory, SLACK_UPLOADS_RELATIVE);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Validate an agent-supplied `file_path` for the upload_file MCP tool and return the
 * resolved host path. The check is two-layered:
 *
 *   1. Sandbox-path prefix: the literal string must start with `/workspace/.agentos/uploads/`.
 *      Catches the obvious "wrong folder" case with a clear error before any filesystem work.
 *   2. Realpath containment: after translating the container path to the host and resolving
 *      symlinks (via translateContainerPath), the result must still sit under the realpath of
 *      `<hostWorkingDir>/.agentos/uploads/`. Defeats `..` traversal and symlink escapes that
 *      the prefix check alone cannot — e.g. `/workspace/.agentos/uploads/../docs/secret.png`
 *      passes the prefix but resolves outside uploads/.
 *
 * Throws on rejection. Returns the resolved host filesystem path on success.
 */
export async function validateSlackUploadPath(file_path: string, hostWorkingDir: string): Promise<string> {
  if (!file_path.startsWith(`${SLACK_UPLOADS_CONTAINER_PATH}/`)) {
    throw new Error(`file_path must be under ${SLACK_UPLOADS_CONTAINER_PATH}/`);
  }
  const uploadsDir = await ensureSlackUploadsDir(hostWorkingDir);
  const uploadsRealpath = await realpath(uploadsDir);
  const resolved = translateContainerPath(file_path, hostWorkingDir);
  const rel = relative(uploadsRealpath, resolved);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`file_path must resolve to a file under ${SLACK_UPLOADS_CONTAINER_PATH}/`);
  }
  return resolved;
}
