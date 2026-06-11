import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebClient } from '@slack/web-api';
import { open } from 'fs/promises';
import { basename } from 'path';
import { z } from 'zod';
import { clampSlackText, convertMarkdownToMrkdwn } from './slackFormatting';
import { validateSlackUploadPath } from './slackUploadWorkspace';
import { BaseMcpServer } from '../mcp/BaseMcpServer';

/** Tools in this server that send messages externally. Import this in toolResolver to keep names in sync. */
export const SLACK_EXTERNAL_TOOLS = ['post_update', 'ask_clarification', 'upload_file'] as const;

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const slackTarget = {
  channel_id: z.string().describe('Slack channel ID — use the value of env var SLACK_CHANNEL_ID'),
  thread_ts: z
    .string()
    .optional()
    .describe(
      'Slack thread timestamp — use the value of env var SLACK_THREAD_TS when responding to an inbound thread message; omit only for new top-level channel posts (e.g. automation summaries)'
    ),
};

/**
 * Resolves the host filesystem path corresponding to the sandboxed agent's `/workspace` mount
 * for a given Slack (channel, thread) pair. Returns null when no binding (or thread) is found.
 */
export type WorkspacePathResolver = (channelId: string, threadTs: string | undefined) => string | null;

class SlackMcpServer extends BaseMcpServer {
  private webClient: WebClient | null = null;
  private resolveWorkspacePath: WorkspacePathResolver | null = null;

  init(webClient: WebClient, resolveWorkspacePath: WorkspacePathResolver): void {
    this.webClient = webClient;
    this.resolveWorkspacePath = resolveWorkspacePath;
  }

  start(): void {
    this.startHttpServer('slack', 'Slack MCP sidecar');
  }

  stop(): void {
    this.webClient = null;
    this.resolveWorkspacePath = null;
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-slack';
  }

  private postToSlack(channel_id: string, thread_ts: string | undefined, text: string, successMsg = 'Posted.') {
    const webClient = this.webClient;
    return this.runTool(async () => {
      if (!webClient) throw new Error('Slack not connected.');
      await webClient.chat.postMessage({
        channel: channel_id,
        text: clampSlackText(convertMarkdownToMrkdwn(text)),
        ...(thread_ts ? { thread_ts } : {}),
      });
      return successMsg;
    });
  }

  protected async registerTools(server: McpServer): Promise<void> {
    server.tool(
      'post_update',
      'Post a progress update or final result back to the originating Slack thread',
      { ...slackTarget, message: z.string().describe('Message to post to Slack') },
      ({ channel_id, thread_ts, message }) => this.postToSlack(channel_id, thread_ts, message)
    );

    server.tool(
      'ask_clarification',
      'Post clarifying questions to the originating Slack thread',
      { ...slackTarget, questions: z.string().describe('Questions to post to Slack') },
      ({ channel_id, thread_ts, questions }) => this.postToSlack(channel_id, thread_ts, questions, 'Questions posted.')
    );

    server.tool(
      'upload_file',
      'Upload a file to the originating Slack thread',
      {
        ...slackTarget,
        file_path: z.string().describe('Absolute path to the file to upload'),
        filename: z
          .string()
          .min(1)
          .optional()
          .describe('Display name for the file (defaults to the basename of file_path)'),
        initial_comment: z.string().optional().describe('Optional message to accompany the file'),
      },
      ({ channel_id, thread_ts, file_path, filename, initial_comment }) => {
        const webClient = this.webClient;
        const resolver = this.resolveWorkspacePath;
        return this.runTool(async () => {
          if (!webClient) throw new Error('Slack not connected.');
          if (!resolver) throw new Error('Slack MCP server not initialized.');

          // Agents run in a sandbox container where the project lives at /workspace, but this MCP
          // server runs on the host where that path doesn't exist. Translate to the host workingDir
          // bound to this Slack thread.
          const hostWorkingDir = resolver(channel_id, thread_ts);
          if (!hostWorkingDir) {
            throw new Error(`No workspace bound to channel ${channel_id} / thread ${thread_ts ?? '(none)'}`);
          }
          // Validates the sandbox prefix, ensures the host uploads dir exists, then realpath-
          // checks containment so `..`/symlink escapes outside `.agentos/uploads/` are rejected.
          const resolved = await validateSlackUploadPath(file_path, hostWorkingDir);

          // Open once, then stat + read against the same fd so a swap between checks can't bypass
          // the type guard or the size cap.
          const fd = await open(resolved, 'r');
          let file: Buffer;
          try {
            const stats = await fd.stat();
            if (!stats.isFile()) {
              throw new Error(`file_path is not a regular file: ${file_path}`);
            }
            if (stats.size > MAX_UPLOAD_BYTES) {
              throw new Error(`File too large: ${stats.size} bytes (max ${MAX_UPLOAD_BYTES} bytes)`);
            }
            file = await fd.readFile();
          } finally {
            await fd.close();
          }

          const name = filename ?? basename(resolved);
          const initial = initial_comment
            ? { initial_comment: clampSlackText(convertMarkdownToMrkdwn(initial_comment)) }
            : {};
          const args =
            thread_ts === undefined
              ? { channel_id, file, filename: name, ...initial }
              : { channel_id, thread_ts, file, filename: name, ...initial };
          await webClient.files.uploadV2(args);
          return 'File uploaded.';
        });
      }
    );
  }
}

export const slackMcpServer = new SlackMcpServer();
