import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateMcpAuth } from './mcpAuth';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { sanitizeToolResult } from './sanitize';
import type { Disposable } from '../lifecycle';

type McpTextContent = { type: 'text'; text: string };
type McpToolResponse = { content: McpTextContent[]; isError?: boolean };

const MAX_REQUEST_BODY_BYTES = 1_048_576; // 1 MB

export abstract class BaseMcpServer implements Disposable {
  private httpServer: http.Server | null = null;
  private _actualPort: number | null = null;

  get actualPort(): number | null {
    return this._actualPort;
  }

  protected abstract get mcpServerName(): string;
  protected abstract registerTools(server: McpServer): void | Promise<void>;

  protected startHttpServer(logCategory: string, label: string, hostname = '127.0.0.1'): void {
    if (this.httpServer) return;
    this.httpServer = http.createServer((req, res) => {
      if ((req.method === 'GET' || req.method === 'POST') && req.url === '/mcp') {
        if (!validateMcpAuth(req)) {
          res.writeHead(401);
          res.end();
          return;
        }
        const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
        if (!isNaN(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
          res.writeHead(413);
          res.end();
          return;
        }
        void this.handleMcpRequest(req, res);
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.httpServer.requestTimeout = 60_000;
    this.httpServer.headersTimeout = 10_000;
    this.httpServer.on('listening', () => {
      const addr = this.httpServer!.address();
      this._actualPort = typeof addr === 'object' && addr !== null ? addr.port : null;
      eventLogger.info(logCategory, `${label} listening on port ${this._actualPort}`);
    });
    this.httpServer.on('error', (err: Error) => {
      eventLogger.error(logCategory, `${label} error`, { error: getErrorMessage(err) });
    });
    this.httpServer.listen(0, hostname);
  }

  protected stopHttpServer(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
      this._actualPort = null;
    }
  }

  dispose(): void {
    this.stopHttpServer();
  }

  protected textResult(text: string, isError = false): McpToolResponse {
    return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
  }

  protected errorResult(text: string): McpToolResponse {
    return this.textResult(text, true);
  }

  protected jsonResult(value: unknown, options?: { sanitize?: boolean; suffix?: string }): McpToolResponse {
    const raw = `${JSON.stringify(value, null, 2)}${options?.suffix ?? ''}`;
    return this.textResult(options?.sanitize === false ? raw : sanitizeToolResult(raw));
  }

  protected async runTool(fn: () => Promise<string> | string): Promise<McpToolResponse> {
    try {
      const text = await fn();
      return this.textResult(text);
    } catch (err) {
      return this.errorResult(getErrorMessage(err));
    }
  }

  protected runJsonTool(
    fn: () => Promise<unknown> | unknown,
    options?: { sanitize?: boolean; suffix?: string }
  ): Promise<McpToolResponse> {
    return this.runTool(async () => {
      const value = await fn();
      const raw = `${JSON.stringify(value, null, 2)}${options?.suffix ?? ''}`;
      return options?.sanitize === false ? raw : sanitizeToolResult(raw);
    });
  }

  private async handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const server = new McpServer({ name: this.mcpServerName, version: '1.0.0' });
    await this.registerTools(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      eventLogger.error('mcp', `${this.mcpServerName} request error`, { error: getErrorMessage(err) });
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    } finally {
      await (transport as { close?: () => Promise<void> }).close?.();
    }
  }
}
