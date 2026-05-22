import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebClient } from '@slack/web-api';
import { realpathSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { z } from 'zod';
import { clampSlackText, convertMarkdownToMrkdwn } from './slackFormatting';
import { BaseMcpServer } from '../mcp/BaseMcpServer';

/** Tools in this server that send messages externally. Import this in toolResolver to keep names in sync. */
export const SLACK_EXTERNAL_TOOLS = ['post_update', 'ask_clarification', 'upload_file'] as const;

const slackTarget = {
  channel_id: z.string().describe('Slack channel ID — use the value of env var SLACK_CHANNEL_ID'),
  thread_ts: z
    .string()
    .optional()
    .describe(
      'Slack thread timestamp — use the value of env var SLACK_THREAD_TS when responding to an inbound thread message; omit only for new top-level channel posts (e.g. automation summaries)'
    ),
};

class SlackMcpServer extends BaseMcpServer {
  private webClient: WebClient | null = null;

  init(webClient: WebClient): void {
    this.webClient = webClient;
  }

  start(): void {
    this.startHttpServer('slack', 'Slack MCP sidecar');
  }

  stop(): void {
    this.webClient = null;
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
        return this.runTool(async () => {
          if (!webClient) throw new Error('Slack not connected.');

          // Resolve symlinks and restrict to safe prefixes to prevent path traversal
          let resolved: string;
          try {
            resolved = realpathSync(file_path);
          } catch {
            throw new Error(`File not found: ${file_path}`);
          }
          const ALLOWED_PREFIXES = ['/workspace', '/tmp'];
          if (!ALLOWED_PREFIXES.some((p) => resolved === p || resolved.startsWith(p + '/'))) {
            throw new Error(`file_path must be under /workspace or /tmp`);
          }

          // Reject files over 100 MB before reading into memory
          const { size } = statSync(resolved);
          const MAX_BYTES = 100 * 1024 * 1024;
          if (size > MAX_BYTES) throw new Error(`File too large: ${size} bytes (max 100 MB)`);

          const file = await readFile(resolved);
          const name = filename ?? basename(resolved);
          await webClient.files.uploadV2({
            channel_id,
            ...(thread_ts ? { thread_ts } : {}),
            file,
            filename: name,
            ...(initial_comment ? { initial_comment: clampSlackText(convertMarkdownToMrkdwn(initial_comment)) } : {}),
          });
          return 'File uploaded.';
        });
      }
    );
  }
}

export const slackMcpServer = new SlackMcpServer();
