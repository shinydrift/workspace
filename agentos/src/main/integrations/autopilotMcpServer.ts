import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BaseMcpServer } from '../mcp/BaseMcpServer';
import { autopilotSubmissionRegistry, buildAutopilotDecision } from '../autopilot/autopilotSubmission';

/**
 * MCP server exposing a single tool the autopilot planner calls to deliver its decision.
 *
 * Wired only into planner sandbox calls (never normal agent turns), so the planner's
 * entire tool surface is this one tool. The handler records the decision into
 * autopilotSubmissionRegistry, which the awaiting adapter reads once the planner exits.
 */
class AutopilotMcpServer extends BaseMcpServer {
  start(): void {
    this.startHttpServer('autopilot-mcp', 'AgentOS autopilot MCP sidecar');
  }

  stop(): void {
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-autopilot';
  }

  protected registerTools(server: McpServer): void {
    server.tool(
      'get_transcript',
      'Fetch the recent thread transcript to inform your decision. Call this once before submitting.',
      {
        submission_token: z.string().describe('The submission_token from your instructions. Pass it back verbatim.'),
      },
      ({ submission_token }) =>
        this.runTool(() => {
          const transcript = autopilotSubmissionRegistry.getTranscript(submission_token);
          if (transcript === null) {
            throw new Error('Invalid or expired submission_token — no autopilot run is pending.');
          }
          return transcript || '[empty]';
        })
    );

    server.tool(
      'submit_autopilot_decision',
      'Submit your autopilot decision. Call this exactly once and emit no other output. ' +
        'Use action="send_message" with a message to continue the thread on the user\'s behalf, or action="stop" to do nothing.',
      {
        submission_token: z.string().describe('The submission_token from your instructions. Pass it back verbatim.'),
        action: z
          .enum(['send_message', 'stop'])
          .describe('send_message to deliver a user-behalf message to the thread; stop to take no action.'),
        message: z
          .string()
          .optional()
          .describe('Required when action is send_message: the short user-behalf message to deliver to the thread.'),
        reason: z.string().describe('Why you chose this action.'),
      },
      ({ submission_token, action, message, reason }) =>
        this.runTool(() => {
          const decision = buildAutopilotDecision(action, message, reason);
          // A send_message decided without ever reading the transcript is a zero-context send.
          // Force the planner to fetch first; a stop needs no transcript and is always allowed.
          if (
            decision.action === 'send_message' &&
            !autopilotSubmissionRegistry.wasTranscriptFetched(submission_token)
          ) {
            throw new Error('Call get_transcript to read the transcript before sending a message, then submit again.');
          }
          if (!autopilotSubmissionRegistry.submit(submission_token, decision)) {
            throw new Error('Invalid or expired submission_token — no autopilot decision is pending.');
          }
          return `Autopilot decision recorded: ${action}.`;
        })
    );
  }
}

export const autopilotMcpServer = new AutopilotMcpServer();
