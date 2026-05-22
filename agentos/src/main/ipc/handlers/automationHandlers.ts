import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type { AutomationCreateRequest, AutomationUpdateRequest } from '../../../shared/types';
import { automationService } from '../../automations/service';
import { shortId, shortName } from './schemas';
import { handleIpc } from '../ipcResponse';

// ── Schedule schema ───────────────────────────────────────────────────────────

const AutomationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cron'), expr: z.string().min(1).max(128) }),
  z.object({
    kind: z.literal('every'),
    ms: z
      .number()
      .int()
      .positive()
      .max(365 * 24 * 60 * 60 * 1000),
  }),
  z.object({ kind: z.literal('at'), iso: z.string().datetime() }),
]);

const WebhookTriggerSchema = z.object({
  secret: z.string().min(16).max(256),
  source: z.enum(['github', 'stripe', 'slack']).or(z.string().min(1).max(64)).optional(),
});

const AutomationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule'), schedule: AutomationScheduleSchema }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('webhook'), webhook: WebhookTriggerSchema }),
]);

// ── Notification schema ───────────────────────────────────────────────────────

const AutomationNotificationSchema = z.object({
  channel: z.enum(['slack']),
  onFailure: z.boolean(),
  slackChannelId: z.string().max(128).optional(),
});

// ── Create / Update schemas ───────────────────────────────────────────────────

const KanbanTaskTemplateSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  skillTags: z.array(z.string().max(64)).max(20).optional(),
});

const AutomationCreateSchema = z.object({
  name: shortName,
  description: z.string().max(1024).optional(),
  projectId: z.string().min(1).max(128),
  trigger: AutomationTriggerSchema,
  instructions: z.string().min(1).max(100_000),
  kanbanTaskTemplate: KanbanTaskTemplateSchema.optional(),
  notification: AutomationNotificationSchema.optional(),
  enabled: z.boolean().optional(),
  deleteAfterRun: z.boolean().optional(),
});

const AutomationUpdateSchema = z.object({
  id: shortId,
  patch: AutomationCreateSchema.partial(),
});

const IdSchema = z.object({ id: shortId });
const ToggleSchema = z.object({ id: shortId, enabled: z.boolean() });

// ── Handlers ──────────────────────────────────────────────────────────────────

export function registerAutomationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTOMATION_LIST, () => handleIpc(() => automationService.list()));

  ipcMain.handle(IPC_CHANNELS.AUTOMATION_CREATE, (_e, raw) =>
    handleIpc(() => {
      const req = AutomationCreateSchema.parse(raw);
      return automationService.create(req as AutomationCreateRequest);
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUTOMATION_UPDATE, (_e, raw) =>
    handleIpc(() => {
      const req = AutomationUpdateSchema.parse(raw);
      return automationService.update(req.id, req.patch as AutomationUpdateRequest['patch']);
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUTOMATION_DELETE, (_e, raw) =>
    handleIpc(() => {
      const { id } = IdSchema.parse(raw);
      automationService.remove(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUTOMATION_RUN, (_e, raw) =>
    handleIpc(async () => {
      const { id } = IdSchema.parse(raw);
      return automationService.runNow(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUTOMATION_TOGGLE, (_e, raw) =>
    handleIpc(() => {
      const { id, enabled } = ToggleSchema.parse(raw);
      return automationService.toggle(id, enabled);
    })
  );
}
