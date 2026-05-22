import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BaseMcpServer } from '../mcp/BaseMcpServer';
import { councilService, councilEvents } from '../council/service';
import type { CouncilRun } from '../../shared/types/council';

councilEvents.setMaxListeners(50);

/**
 * MCP server exposing council orchestration to the parent agent.
 *
 * Tools:
 *   - council_list_configs:      enumerate stored council configurations
 *   - council_upsert_config:     create or update a council configuration
 *   - council_dispatch:          spawn a council run against the current thread
 *   - council_read_outcomes:     fetch member outcomes once when prompted to synthesize
 *   - council_await_completion:  block until all members submit (interactive use only)
 *
 * The expected agent flow:
 *   1. list_configs → pick one
 *   2. dispatch    → get runId → stop immediately
 *   3. app appends synthesis message when all members finish
 *   4. call council_read_outcomes once → write synthesis as a normal assistant message
 */
class CouncilMcpServer extends BaseMcpServer {
  private buildOutcomesPayload(run: CouncilRun) {
    const outcomes = councilService.getOutcomes(run.id);
    const members = councilService.getRunMembers(run.id);
    return {
      runId: run.id,
      status: run.status,
      complete: councilService.isRunComplete(run.id),
      // Per-member spawn state (pending/running/submitted/error/timeout).
      // Present for runs dispatched after this feature landed; empty array for older runs.
      members: members.map((m) => ({
        memberIdx: m.memberIdx,
        provider: m.provider,
        model: m.model,
        childThreadId: m.childThreadId,
        memberStatus: m.status,
      })),
      outcomes: outcomes.map((o) => ({
        member: o.member,
        childThreadId: o.childThreadId,
        status: o.status,
        summary: o.outcome?.summary,
        answer: o.outcome?.answer,
        confidence: o.outcome?.confidence,
        caveats: o.outcome?.caveats,
        error: o.error,
      })),
    };
  }
  start(): void {
    this.startHttpServer('council-mcp', 'AgentOS council MCP sidecar');
  }

  stop(): void {
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-council';
  }

  protected registerTools(server: McpServer): void {
    server.tool(
      'council_list_configs',
      'List all stored council configurations. Each entry contains an id, name, and members (provider+model). Use the id with council_dispatch.',
      {},
      () =>
        this.runJsonTool(() => {
          const configs = councilService.listConfigs();
          return configs.map((c) => ({
            id: c.id,
            name: c.name,
            members: c.members,
          }));
        })
    );

    server.tool(
      'council_upsert_config',
      'Create or update a council configuration. Pass id to update an existing config, omit to create a new one. Each member requires provider (claude|codex|gemini) and model.',
      {
        id: z.string().min(1).optional().describe('Existing config id to update. Omit to create a new config.'),
        name: z.string().min(1).max(128).describe('Display name for the config.'),
        members: z
          .array(
            z.object({
              provider: z.enum(['claude', 'codex', 'gemini']),
              model: z.string().min(1).max(128),
              effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
              reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
            })
          )
          .min(1)
          .max(8)
          .describe('List of council members (max 8).'),
      },
      ({ id, name, members }) =>
        this.runJsonTool(() => {
          const config = councilService.upsertConfig({ id, name, members });
          return { id: config.id, name: config.name, members: config.members };
        })
    );

    server.tool(
      'council_dispatch',
      "Dispatch a council run: spawn one child sub-thread per member of the named config, sharing the parent thread's container. Returns immediately with a runId. Stop after dispatching — do not poll or await. When all members complete, the app appends a synthesis message to the parent thread; at that point call council_read_outcomes once to fetch outcomes and write your synthesis.",
      {
        config_id: z.string().describe('The council config id (from council_list_configs).'),
        parent_thread_id: z.string().describe('The parent thread id. Use the AGENTOS_THREAD_ID environment variable.'),
        prompt: z.string().describe('The user prompt to send to every council member.'),
      },
      ({ config_id, parent_thread_id, prompt }) =>
        this.runJsonTool(async () => {
          const run = await councilService.runCouncil({
            configId: config_id,
            parentThreadId: parent_thread_id,
            prompt,
          });
          return {
            runId: run.id,
            status: run.status,
          };
        })
    );

    server.tool(
      'council_submit_outcome',
      'Submit your outcome for a council run. Call this exactly once when you have finished reasoning. The outcome is immediately retrievable by the parent agent via council_read_outcomes.',
      {
        run_id: z.string().describe('The council run id from your boot instructions.'),
        child_thread_id: z.string().describe('Your child thread id from your boot instructions.'),
        summary: z.string().describe('One-sentence summary of your answer.'),
        answer: z.string().describe('Your full answer to the prompt.'),
        confidence: z.number().min(0).max(1).optional().describe('Confidence score from 0 to 1.'),
        caveats: z.array(z.string()).optional().describe('List of caveats or limitations.'),
      },
      ({ run_id, child_thread_id, summary, answer, confidence, caveats }) =>
        this.runJsonTool(() => {
          const member = councilService.getMemberForChild(run_id, child_thread_id);
          if (!member) throw new Error(`No member registered for child thread ${child_thread_id} in run ${run_id}`);
          councilService.recordOutcome(run_id, {
            runId: run_id,
            childThreadId: child_thread_id,
            member,
            status: 'submitted',
            outcome: { summary, answer, confidence, caveats },
            submittedAt: Date.now(),
          });
          return { ok: true };
        })
    );

    server.tool(
      'council_read_outcomes',
      'Read the current outcomes for a council run. Returns per-member spawn state (members[]) and submitted outcomes, plus a `complete` flag. When synthesizing, call this once after receiving the synthesis message — do not poll after dispatch.',
      {
        run_id: z.string().describe('The council run id returned by council_dispatch.'),
      },
      ({ run_id }) =>
        this.runJsonTool(() => {
          const run = councilService.getRun(run_id);
          if (!run) throw new Error(`Council run ${run_id} not found`);
          return this.buildOutcomesPayload(run);
        })
    );

    server.tool(
      'council_await_completion',
      'Block until all council members have submitted or errored (or the timeout expires). Returns the same payload as council_read_outcomes. For interactive use only — in automation contexts the app appends a synthesis message; use council_read_outcomes once at that point instead.',
      {
        run_id: z.string().describe('The council run id returned by council_dispatch.'),
        timeout_ms: z
          .number()
          .min(1000)
          .max(300_000)
          .optional()
          .describe('Maximum time to wait in milliseconds. Defaults to 120 000 (2 min).'),
      },
      ({ run_id, timeout_ms = 120_000 }) =>
        this.runJsonTool(async () => {
          const run = councilService.getRun(run_id);
          if (!run) throw new Error(`Council run ${run_id} not found`);

          // Already done — return immediately.
          if (councilService.isRunComplete(run_id)) {
            return this.buildOutcomesPayload(run);
          }

          return new Promise<ReturnType<typeof this.buildOutcomesPayload>>((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
              clearTimeout(timer);
              councilEvents.off('run:updated', onUpdate);
            };
            const settle = (fn: () => void) => {
              if (settled) return;
              settled = true;
              cleanup();
              fn();
            };

            const onUpdate = (updated: unknown) => {
              const r = updated as CouncilRun;
              if (r.id !== run_id || !councilService.isRunComplete(run_id)) return;
              settle(() => resolve(this.buildOutcomesPayload(r)));
            };

            const timer = setTimeout(
              () => settle(() => reject(new Error(`council_await_completion timed out after ${timeout_ms}ms`))),
              timeout_ms
            );

            // Register before the second isRunComplete check to close the race window.
            councilEvents.on('run:updated', onUpdate);

            if (councilService.isRunComplete(run_id)) {
              settle(() => resolve(this.buildOutcomesPayload(councilService.getRun(run_id) ?? run)));
            }
          });
        })
    );
  }
}

export const councilMcpServer = new CouncilMcpServer();
