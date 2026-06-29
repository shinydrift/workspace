import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BaseMcpServer } from '../mcp/BaseMcpServer';
import type { AppSettings, MessageRole, PersonalitySettings, ProjectConfig } from '../../shared/types';
import { AppSettingsPatchSchema } from '../store/settingsSchema';

type SetAutopilotFn = (threadId: string, enabled: boolean) => void;
type UpdatePersonalityFn = (threadId: string, patch: Partial<PersonalitySettings>) => Promise<void>;
type SetPersonalityOverrideFn = (threadId: string, override: Partial<PersonalitySettings> | null) => void;
type GetAppSettingsFn = () => AppSettings;
type UpdateAppSettingsFn = (patch: Partial<AppSettings>) => AppSettings;
type GetProjectConfigFn = (threadId: string) => Promise<ProjectConfig | null>;
type UpdateProjectConfigFn = (
  threadId: string,
  key: keyof ProjectConfig,
  updates: Record<string, unknown>
) => Promise<void>;
type ListProjectMessagesFn = (
  threadId: string,
  filter: { role?: MessageRole; limit: number; sinceMs?: number }
) => Array<{ role: string; content: string; timestamp: number }>;
type SetRecordingTitleFn = (recordingId: string, title: string) => void;
type TestWebhookEventFn = (jobId: string, payload: unknown) => Promise<{ ok: boolean; error?: string }>;
type PostThreadUpdateFn = (threadId: string, kind: 'update' | 'clarification', text: string) => void;
type UploadThreadFileFn = (
  threadId: string,
  filePath: string,
  filename: string | undefined,
  comment: string | undefined
) => Promise<string>;

const BigFiveSchema = z.object({
  openness: z.number().min(1).max(5).describe('1–5 scale'),
  conscientiousness: z.number().min(1).max(5).describe('1–5 scale'),
  extraversion: z.number().min(1).max(5).describe('1–5 scale'),
  agreeableness: z.number().min(1).max(5).describe('1–5 scale'),
  neuroticism: z.number().min(1).max(5).describe('1 = stable, 5 = reactive'),
});

const MAX_MESSAGES_RESPONSE_BYTES = 524_288; // 512 KB

class ThreadMcpServer extends BaseMcpServer {
  private setAutopilotFn: SetAutopilotFn | null = null;
  private updatePersonalityFn: UpdatePersonalityFn | null = null;
  private setPersonalityOverrideFn: SetPersonalityOverrideFn | null = null;
  private getAppSettingsFn: GetAppSettingsFn | null = null;
  private updateAppSettingsFn: UpdateAppSettingsFn | null = null;
  private getProjectConfigFn: GetProjectConfigFn | null = null;
  private updateProjectConfigFn: UpdateProjectConfigFn | null = null;
  private listProjectMessagesFn: ListProjectMessagesFn | null = null;
  private setRecordingTitleFn: SetRecordingTitleFn | null = null;
  private testWebhookEventFn: TestWebhookEventFn | null = null;
  private postThreadUpdateFn: PostThreadUpdateFn | null = null;
  private uploadThreadFileFn: UploadThreadFileFn | null = null;

  init(callbacks: {
    setAutopilot: SetAutopilotFn;
    updatePersonality: UpdatePersonalityFn;
    setPersonalityOverride: SetPersonalityOverrideFn;
    getAppSettings: GetAppSettingsFn;
    updateAppSettings: UpdateAppSettingsFn;
    getProjectConfig: GetProjectConfigFn;
    updateProjectConfig: UpdateProjectConfigFn;
    listProjectMessages: ListProjectMessagesFn;
    setRecordingTitle: SetRecordingTitleFn;
    testWebhookEvent: TestWebhookEventFn;
    postThreadUpdate: PostThreadUpdateFn;
    uploadThreadFile: UploadThreadFileFn;
  }): void {
    this.setAutopilotFn = callbacks.setAutopilot;
    this.updatePersonalityFn = callbacks.updatePersonality;
    this.setPersonalityOverrideFn = callbacks.setPersonalityOverride;
    this.getAppSettingsFn = callbacks.getAppSettings;
    this.updateAppSettingsFn = callbacks.updateAppSettings;
    this.getProjectConfigFn = callbacks.getProjectConfig;
    this.updateProjectConfigFn = callbacks.updateProjectConfig;
    this.listProjectMessagesFn = callbacks.listProjectMessages;
    this.setRecordingTitleFn = callbacks.setRecordingTitle;
    this.testWebhookEventFn = callbacks.testWebhookEvent;
    this.postThreadUpdateFn = callbacks.postThreadUpdate;
    this.uploadThreadFileFn = callbacks.uploadThreadFile;
  }

  start(): void {
    this.startHttpServer('thread-mcp', 'AgentOS thread MCP sidecar');
  }

  stop(): void {
    this.setAutopilotFn = null;
    this.updatePersonalityFn = null;
    this.setPersonalityOverrideFn = null;
    this.getAppSettingsFn = null;
    this.updateAppSettingsFn = null;
    this.getProjectConfigFn = null;
    this.updateProjectConfigFn = null;
    this.listProjectMessagesFn = null;
    this.setRecordingTitleFn = null;
    this.testWebhookEventFn = null;
    this.postThreadUpdateFn = null;
    this.uploadThreadFileFn = null;
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-thread';
  }

  protected registerTools(server: McpServer): void {
    server.tool(
      'set_autopilot',
      'Enable or disable autopilot for the current thread. When enabled, the AI will automatically continue the conversation after each assistant turn without waiting for human input. Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID to modify. Use the AGENTOS_THREAD_ID environment variable.'),
        enabled: z.boolean().describe('true to enable autopilot, false to disable it.'),
      },
      ({ thread_id, enabled }) =>
        this.runTool(() => {
          if (!this.setAutopilotFn) throw new Error('ThreadMcpServer not initialized');
          this.setAutopilotFn(thread_id, enabled);
          return `Autopilot ${enabled ? 'enabled' : 'disabled'} for thread ${thread_id}.`;
        })
    );

    server.tool(
      'update_personality',
      "Update the personality profile for the current thread's project. Provide only the fields you want to change. Use AGENTOS_THREAD_ID env var for thread_id.",
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        agent_style: z
          .string()
          .optional()
          .describe('How the AI agent should respond to the user. 4–6 line style description.'),
        autopilot_instructions: z
          .string()
          .optional()
          .describe('How the AI should compose messages on behalf of the user. 2–3 lines.'),
        big_five: BigFiveSchema.optional().describe('Big Five personality trait scores (1–5 scale each).'),
        active_preset_id: z
          .string()
          .optional()
          .describe(
            "Active preset ID. Pass 'custom' when deriving traits via LLM refresh so the UI shows the correct selection."
          ),
        generated_at: z
          .number()
          .optional()
          .describe('Unix timestamp (ms) when this profile was LLM-derived. Pass Date.now() from the calling skill.'),
        message_count: z
          .number()
          .int()
          .optional()
          .describe('Number of user messages analysed to derive this profile. Stored for UI confidence display.'),
      },
      ({ thread_id, agent_style, autopilot_instructions, big_five, active_preset_id, generated_at, message_count }) =>
        this.runTool(async () => {
          if (!this.updatePersonalityFn) throw new Error('ThreadMcpServer not initialized');
          const patch: Partial<PersonalitySettings> = {};
          if (agent_style !== undefined) patch.agentStyle = agent_style;
          if (autopilot_instructions !== undefined) patch.autopilotInstructions = autopilot_instructions;
          if (big_five !== undefined) patch.bigFive = big_five;
          if (active_preset_id !== undefined) patch.activePresetId = active_preset_id;
          if (generated_at !== undefined) patch.generatedAt = generated_at;
          if (message_count !== undefined) patch.messageCount = message_count;
          if (Object.keys(patch).length === 0) return 'No fields provided — nothing updated.';
          await this.updatePersonalityFn(thread_id, patch);
          return `Personality updated for thread ${thread_id}: ${Object.keys(patch).join(', ')}.`;
        })
    );

    server.tool(
      'set_personality_override',
      'Apply a temporary per-thread personality override that is merged on top of the project personality at the next thread boot. ' +
        'In-memory only — cleared when the thread stops. Pass null fields to clear the override. Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        agent_style: z.string().nullable().optional().describe('Override agent style for this thread only.'),
        autopilot_instructions: z
          .string()
          .nullable()
          .optional()
          .describe('Override autopilot instructions for this thread only.'),
        clear: z.boolean().optional().describe('When true, remove the override entirely.'),
      },
      ({ thread_id, agent_style, autopilot_instructions, clear }) =>
        this.runTool(() => {
          if (!this.setPersonalityOverrideFn) throw new Error('ThreadMcpServer not initialized');
          if (clear) {
            this.setPersonalityOverrideFn(thread_id, null);
            return `Personality override cleared for thread ${thread_id}.`;
          }
          const override: Partial<PersonalitySettings> = {};
          if (agent_style !== undefined && agent_style !== null) override.agentStyle = agent_style;
          if (autopilot_instructions !== undefined && autopilot_instructions !== null)
            override.autopilotInstructions = autopilot_instructions;
          if (Object.keys(override).length === 0) return 'No override fields provided — nothing changed.';
          this.setPersonalityOverrideFn(thread_id, override);
          return `Personality override set for thread ${thread_id}: ${Object.keys(override).join(', ')}.`;
        })
    );

    server.tool(
      'get_app_settings',
      'Read the current application-level settings. Returns the full settings object as JSON. ' +
        'Call this before update_app_settings to inspect available keys and current values.',
      {},
      () =>
        this.runTool(() => {
          if (!this.getAppSettingsFn) throw new Error('ThreadMcpServer not initialized');
          return JSON.stringify(this.getAppSettingsFn(), null, 2);
        })
    );

    server.tool(
      'update_app_settings',
      'Shallow-merge a patch into application-level settings. Call get_app_settings first to see current values. ' +
        'All known AppSettings keys are accepted; unknown keys are rejected. ' +
        'Nested object keys (slack, sandbox, autopilot, etc.) replace the entire nested value.',
      { patch: AppSettingsPatchSchema.describe('Partial AppSettings object. Only provided keys are updated.') },
      ({ patch }) =>
        this.runTool(() => {
          if (!this.updateAppSettingsFn) throw new Error('ThreadMcpServer not initialized');
          this.updateAppSettingsFn(patch as Partial<AppSettings>);
          return `App settings updated: ${Object.keys(patch).join(', ')}.`;
        })
    );

    server.tool(
      'get_project_config',
      "Read the current project config (.agentos/config.json) for the thread's project. Returns the parsed config as JSON, or null if no config file exists. " +
        'Call this before update_project_config to inspect the current structure. Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
      },
      ({ thread_id }) =>
        this.runTool(async () => {
          if (!this.getProjectConfigFn) throw new Error('ThreadMcpServer not initialized');
          const config = await this.getProjectConfigFn(thread_id);
          return config === null ? 'No project config found.' : JSON.stringify(config, null, 2);
        })
    );

    server.tool(
      'update_project_config',
      "Update a top-level key in the current thread's project .agentos/config.json. " +
        'The updates object is shallow-merged into the existing value for that key. Call get_project_config first if unsure of current values. ' +
        'Key shapes — ' +
        'apiKeys: {anthropic?,openai?,google?,voyage?,mistral?,github?}; tailscale: {authKey?,funnel?}; ' +
        'sandbox: {network?,readOnlyRoot?,dropAllCapabilities?,noNewPrivileges?,memory?,cpus?,tmpfs?}; ' +
        'memory: {enabled?,decayEnabled?,decayHalfLifeDays?,decayMinScore?,graphEnabled?,graphBoost?}; ' +
        'worktree: {autoCreate?,pruneOnStop?}; ' +
        'kanban: {enabled?,agents?}; ' +
        'agents: {queueSilenceFallbackMs?,autopilotMaxConsecutiveTurns?,autopilotTranscriptMessages?}; ' +
        'containers: {pruneIdleHours?,pruneMaxAgeDays?}; ' +
        'env: {safelist?}; ' +
        'personality: {enabled,agentStyle,autopilotInstructions,bigFive?,activePresetId?}; ' +
        'recording: {templates?,activeTemplateId?}. ' +
        'Use AGENTOS_THREAD_ID env var for thread_id. Example: key="apiKeys", updates={"github":"github_pat_..."}.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        key: z
          .enum([
            'sandbox',
            'kanban',
            'memory',
            'worktree',
            'env',
            'apiKeys',
            'agents',
            'containers',
            'personality',
            'recording',
          ])
          .describe('Top-level key in ProjectConfig to update.'),
        updates: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields to merge into the key. Use { "_value": x } to replace the entire key with a scalar, or { "_value": null } to delete it.'
          ),
      },
      ({ thread_id, key, updates }) =>
        this.runTool(async () => {
          if (!this.updateProjectConfigFn) throw new Error('ThreadMcpServer not initialized');
          await this.updateProjectConfigFn(thread_id, key as keyof ProjectConfig, updates);
          return `Project config updated: ${key} for thread ${thread_id}.`;
        })
    );

    server.tool(
      'set_recording_title',
      'Set the title for a meeting recording and rename its linked thread to match. Call this after producing meeting notes with the inferred title.',
      {
        recording_id: z.string().describe('The recording ID from get_recording_meta.'),
        title: z.string().describe('Concise title inferred from the meeting transcript.'),
      },
      ({ recording_id, title }) =>
        this.runTool(() => {
          if (!this.setRecordingTitleFn) throw new Error('ThreadMcpServer not initialized');
          this.setRecordingTitleFn(recording_id, title);
          return `Recording ${recording_id} title set to "${title}".`;
        })
    );

    server.tool(
      'list_project_messages',
      'Return messages from all threads in the current project. Use to analyze conversation history — e.g. for personality refresh. Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        role: z
          .enum(['user', 'assistant', 'tool'])
          .optional()
          .describe('Filter to a specific role. Omit to return all roles.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe('Maximum number of messages to return, in chronological order. Default 50, max 100.'),
        since_ms: z.number().int().optional().describe('Return only messages with timestamp >= this value (unix ms).'),
      },
      ({ thread_id, role, limit, since_ms }) =>
        this.runTool(() => {
          if (!this.listProjectMessagesFn) throw new Error('ThreadMcpServer not initialized');
          const messages = this.listProjectMessagesFn(thread_id, {
            role: role as MessageRole | undefined,
            limit,
            sinceMs: since_ms,
          });
          const json = JSON.stringify(messages);
          if (Buffer.byteLength(json, 'utf8') > MAX_MESSAGES_RESPONSE_BYTES) {
            const truncated = messages.slice(0, Math.floor(messages.length / 2));
            return (
              JSON.stringify(truncated) + '\n[truncated: response exceeded size limit; reduce limit or use since_ms]'
            );
          }
          return json;
        })
    );

    server.tool(
      'test_webhook',
      'Enqueue a test webhook event for an automation job to verify how the agent processes the payload. ' +
        'Runs through the same persistent queue and processing pipeline as a real inbound webhook. ' +
        'Use AGENTOS_PROJECT_ID env var to scope automation jobs if needed.',
      {
        job_id: z.string().describe('The automation job ID with a webhook trigger to test.'),
        payload: z.record(z.string(), z.unknown()).describe('Sample webhook payload (e.g. a GitHub push event body).'),
      },
      ({ job_id, payload }) =>
        this.runTool(async () => {
          if (!this.testWebhookEventFn) throw new Error('ThreadMcpServer not initialized');
          const result = await this.testWebhookEventFn(job_id, payload);
          if (!result.ok) throw new Error(result.error ?? 'Unknown error');
          return `Test webhook event enqueued for job ${job_id}. Monitor the resulting agent thread to verify processing.`;
        })
    );

    server.tool(
      'post_update',
      'Post a progress update or final result to the current thread. The message is saved to the thread view ' +
        '(the primary conversation surface) and echoed to Slack when the thread is connected to a channel. ' +
        'Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        message: z.string().describe('Message to post to the thread.'),
      },
      ({ thread_id, message }) =>
        this.runTool(() => {
          if (!this.postThreadUpdateFn) throw new Error('ThreadMcpServer not initialized');
          this.postThreadUpdateFn(thread_id, 'update', message);
          return 'Posted.';
        })
    );

    server.tool(
      'ask_clarification',
      'Post clarifying questions to the current thread and wait for the user to reply. The questions are saved to ' +
        'the thread view and echoed to Slack when connected. Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        questions: z
          .string()
          .describe(
            'Plain natural-language questions. Use a numbered list when asking more than one — NOT a JSON object or array.'
          ),
      },
      ({ thread_id, questions }) =>
        this.runTool(() => {
          if (!this.postThreadUpdateFn) throw new Error('ThreadMcpServer not initialized');
          this.postThreadUpdateFn(thread_id, 'clarification', questions);
          return 'Questions posted.';
        })
    );

    server.tool(
      'upload_file',
      'Upload a file to the current thread. The file is attached to the thread view and echoed to Slack when ' +
        'connected. file_path MUST be an absolute path under /workspace/.agentos/uploads/. ' +
        'Use AGENTOS_THREAD_ID env var for thread_id.',
      {
        thread_id: z.string().describe('The thread ID. Use the AGENTOS_THREAD_ID environment variable.'),
        file_path: z.string().describe('Absolute path to the file under /workspace/.agentos/uploads/.'),
        filename: z
          .string()
          .min(1)
          .optional()
          .describe('Display name for the file (defaults to the basename of file_path).'),
        initial_comment: z.string().optional().describe('Optional message to accompany the file.'),
      },
      ({ thread_id, file_path, filename, initial_comment }) =>
        this.runTool(async () => {
          if (!this.uploadThreadFileFn) throw new Error('ThreadMcpServer not initialized');
          return await this.uploadThreadFileFn(thread_id, file_path, filename, initial_comment);
        })
    );
  }
}

export const threadMcpServer = new ThreadMcpServer();
