import type { SlackBinding } from './slackWorkspaces';

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
