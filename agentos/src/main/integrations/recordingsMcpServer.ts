import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BaseMcpServer } from '../mcp/BaseMcpServer';
import { getRecording, listRecordings } from '../threads/db';

const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024; // 5 MB

function recordingsRoot(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

function assertTranscriptPath(transcriptPath: string): string {
  const root = path.resolve(recordingsRoot()) + path.sep;
  const resolved = path.resolve(transcriptPath);
  if (!resolved.startsWith(root)) throw new Error('Invalid transcript path');
  return resolved;
}

class RecordingsMcpServer extends BaseMcpServer {
  start(): void {
    this.startHttpServer('recordings-mcp', 'AgentOS recordings MCP sidecar');
  }

  stop(): void {
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-recordings';
  }

  protected registerTools(server: McpServer): void {
    server.tool(
      'get_recording_meta',
      'Get metadata for a meeting recording: id, title, duration_seconds, created_at (unix ms), thread_id.',
      { recording_id: z.string().describe('The recording ID returned when the recording was saved.') },
      ({ recording_id }) =>
        this.runTool(() => {
          const row = getRecording(recording_id);
          if (!row) throw new Error(`Recording ${recording_id} not found`);
          return JSON.stringify(
            {
              id: row.id,
              thread_id: row.threadId,
              title: row.title,
              duration_seconds: row.durationSeconds,
              created_at: row.createdAt,
            },
            null,
            2
          );
        })
    );

    server.tool(
      'get_transcript',
      'Return the raw transcript text for a meeting recording (capped at 5 MB).',
      { recording_id: z.string().describe('The recording ID returned when the recording was saved.') },
      ({ recording_id }) =>
        this.runTool(async () => {
          const row = getRecording(recording_id);
          if (!row) throw new Error(`Recording ${recording_id} not found`);
          const resolved = assertTranscriptPath(row.transcriptPath);
          const stat = await fs.stat(resolved);
          if (stat.size > MAX_TRANSCRIPT_BYTES) {
            const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
            const fh = await fs.open(resolved, 'r');
            try {
              await fh.read(buf, 0, MAX_TRANSCRIPT_BYTES, 0);
            } finally {
              await fh.close();
            }
            return buf.toString('utf8') + `\n[truncated: original ${stat.size} bytes]`;
          }
          return fs.readFile(resolved, 'utf8');
        })
    );

    server.tool(
      'list_recordings',
      'List meeting recordings, newest first.',
      {
        limit: z.number().int().min(1).max(100).default(20).describe('Max results to return.'),
        offset: z.number().int().min(0).default(0).describe('Offset for pagination.'),
      },
      ({ limit, offset }) =>
        this.runTool(() => {
          const rows = listRecordings(limit, offset);
          return JSON.stringify(
            rows.map((r) => ({
              id: r.id,
              thread_id: r.threadId,
              title: r.title,
              duration_seconds: r.durationSeconds,
              created_at: r.createdAt,
            })),
            null,
            2
          );
        })
    );
  }
}

export const recordingsMcpServer = new RecordingsMcpServer();
