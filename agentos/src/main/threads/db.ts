import path from 'path';
import fs from 'fs';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, inArray, and, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SavedProject, SlackThreadBinding, RecordingRecord } from '../../shared/types';
import type { AutomationJob } from '../../shared/types/automation';
import { eventLogger } from '../utils/eventLog';
import { openDb } from '../db/openDb';
import { applyMigrations } from '../db/drizzleMigrate';
import { THREADS_MIGRATIONS } from './migrations';
import * as schema from './schema';
import {
  projects,
  automationJobs,
  slackThreadBindings,
  slackChannelCursors,
  recordings,
  webhookEvents,
} from './schema';

let projectsDb: Database.Database | null = null;
let projectsDbDir: string | null = null;
let projectsHomeDir: string | null = null;
let _drizzle: BetterSQLite3Database<typeof schema> | null = null;

export function initProjectsDbDir(homeDir: string): void {
  projectsHomeDir = homeDir;
  projectsDbDir = path.join(homeDir, '.agentos', 'projects');
}

function ensureProjectsDbDir(): void {
  if (!projectsDbDir || !projectsHomeDir) return;
  fs.mkdirSync(projectsDbDir, { recursive: true });
  // One-time FS rename: move legacy ~/.agentos/threads/threads.sqlite → ~/.agentos/projects/projects.sqlite
  const legacyPath = path.join(projectsHomeDir, '.agentos', 'threads', 'threads.sqlite');
  const newPath = path.join(projectsDbDir, 'projects.sqlite');
  if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
    fs.renameSync(legacyPath, newPath);
    // Move WAL/SHM sidecars so no uncheckpointed frames are orphaned.
    for (const ext of ['-wal', '-shm']) {
      const src = `${legacyPath}${ext}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${newPath}${ext}`);
    }
  }
}

export function getThreadsDb(): Database.Database {
  if (projectsDb) return projectsDb;
  if (!projectsDbDir) throw new Error('initProjectsDbDir() must be called before getThreadsDb()');
  ensureProjectsDbDir();
  const dbPath = path.join(projectsDbDir, 'projects.sqlite');
  projectsDb = openDb(dbPath, undefined, { foreignKeys: true });
  applyMigrations(projectsDb, THREADS_MIGRATIONS);
  return projectsDb;
}

export function getThreadsDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!_drizzle) _drizzle = drizzle(getThreadsDb(), { schema });
  return _drizzle;
}

const getDb = getThreadsDrizzle;

export function closeThreadsDb(): void {
  if (projectsDb) {
    projectsDb.pragma('wal_checkpoint(TRUNCATE)');
    projectsDb.close();
    projectsDb = null;
    _drizzle = null;
  }
}

function parseJson<T>(raw: string, fallback: T, context: { table: string; column: string; id: string }): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    eventLogger.error('db', `Corrupt JSON in ${context.table}.${context.column}`, {
      id: context.id,
      error: String(err),
    });
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

type ProjectRow = typeof projects.$inferSelect;

function rowToProject(row: ProjectRow): SavedProject {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    dockerfileHash: row.dockerfileHash ?? undefined,
  };
}

function projectToRow(project: SavedProject): typeof projects.$inferInsert {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    createdAt: project.createdAt,
    lastUsedAt: project.lastUsedAt,
    dockerfileHash: project.dockerfileHash ?? null,
  };
}

export function getProjectByPath(projectPath: string): SavedProject | null {
  const row = getDb().select().from(projects).where(eq(projects.path, projectPath)).limit(1).get();
  return row ? rowToProject(row) : null;
}

export function getProject(id: string): SavedProject | null {
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  return row ? rowToProject(row) : null;
}

export function getAllProjects(): SavedProject[] {
  return getDb().select().from(projects).orderBy(desc(projects.lastUsedAt)).all().map(rowToProject);
}

export function saveProjectToDb(project: SavedProject): void {
  const row = projectToRow(project);
  const { id: _id, ...set } = row;
  getDb().insert(projects).values(row).onConflictDoUpdate({ target: projects.id, set }).run();
}

export function updateProjectLastUsed(id: string): void {
  getDb().update(projects).set({ lastUsedAt: Date.now() }).where(eq(projects.id, id)).run();
}

export function deleteProjectFromDb(id: string): void {
  getDb().delete(projects).where(eq(projects.id, id)).run();
}

// ---------------------------------------------------------------------------
// Automation job helpers
// ---------------------------------------------------------------------------

type JobRow = typeof automationJobs.$inferSelect;

function rowToJob(row: JobRow): AutomationJob {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? undefined,
    trigger: parseJson<AutomationJob['trigger']>(
      row.trigger,
      { kind: 'manual' },
      { table: 'automation_jobs', column: 'trigger', id: row.id }
    ),
    instructions: row.instructions,
    kanbanTaskTemplate: row.kanbanTaskTemplate
      ? parseJson<AutomationJob['kanbanTaskTemplate']>(row.kanbanTaskTemplate, undefined, {
          table: 'automation_jobs',
          column: 'kanban_task_template',
          id: row.id,
        })
      : undefined,
    isSystem: row.isSystem ? true : undefined,
    notification: row.notification
      ? parseJson<AutomationJob['notification']>(row.notification, undefined, {
          table: 'automation_jobs',
          column: 'notification',
          id: row.id,
        })
      : undefined,
    enabled: Boolean(row.enabled),
    deleteAfterRun: Boolean(row.deleteAfterRun),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt ?? undefined,
    lastRunStatus: (row.lastRunStatus as AutomationJob['lastRunStatus']) ?? undefined,
    lastRunError: row.lastRunError ?? undefined,
    runCountOk: row.runCountOk ?? 0,
    runCountError: row.runCountError ?? 0,
    runHistory: row.runHistory
      ? parseJson<AutomationJob['runHistory']>(row.runHistory, [], {
          table: 'automation_jobs',
          column: 'run_history',
          id: row.id,
        })
      : undefined,
  };
}

function jobToRow(job: AutomationJob): typeof automationJobs.$inferInsert {
  return {
    id: job.id,
    projectId: job.projectId,
    name: job.name,
    description: job.description ?? null,
    trigger: JSON.stringify(job.trigger),
    instructions: job.instructions,
    kanbanTaskTemplate: job.kanbanTaskTemplate ? JSON.stringify(job.kanbanTaskTemplate) : null,
    isSystem: job.isSystem ? 1 : 0,
    notification: job.notification ? JSON.stringify(job.notification) : null,
    enabled: job.enabled ? 1 : 0,
    deleteAfterRun: job.deleteAfterRun ? 1 : 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastRunAt: job.lastRunAt ?? null,
    lastRunStatus: job.lastRunStatus ?? null,
    lastRunError: job.lastRunError ?? null,
    runCountOk: job.runCountOk ?? 0,
    runCountError: job.runCountError ?? 0,
    runHistory: job.runHistory ? JSON.stringify(job.runHistory) : null,
  };
}

export function getAutomationJob(id: string): AutomationJob | null {
  const row = getDb().select().from(automationJobs).where(eq(automationJobs.id, id)).get();
  return row ? rowToJob(row) : null;
}

export function getAllAutomationJobs(): AutomationJob[] {
  return getDb().select().from(automationJobs).orderBy(desc(automationJobs.createdAt)).all().map(rowToJob);
}

export function saveAutomationJob(job: AutomationJob): void {
  const row = jobToRow(job);
  const { id: _id, ...set } = row;
  getDb().insert(automationJobs).values(row).onConflictDoUpdate({ target: automationJobs.id, set }).run();
}

export function deleteAutomationJob(id: string): void {
  getDb().delete(automationJobs).where(eq(automationJobs.id, id)).run();
}

export function deleteAutomationJobsByProject(projectId: string): void {
  getDb().delete(automationJobs).where(eq(automationJobs.projectId, projectId)).run();
}

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

type BindingRow = typeof slackThreadBindings.$inferSelect;

function rowToBinding(row: BindingRow): SlackThreadBinding {
  return {
    key: row.key,
    threadId: row.threadId ?? undefined,
    channelId: row.channelId,
    threadTs: row.threadTs,
    createdAt: row.createdAt,
    lastInboundTs: row.lastInboundTs ?? undefined,
  };
}

function bindingToRow(binding: SlackThreadBinding): typeof slackThreadBindings.$inferInsert {
  return {
    key: binding.key,
    threadId: binding.threadId ?? null,
    channelId: binding.channelId,
    threadTs: binding.threadTs,
    createdAt: binding.createdAt,
    lastInboundTs: binding.lastInboundTs ?? null,
  };
}

export function getSlackBinding(key: string): SlackThreadBinding | null {
  const row = getDb().select().from(slackThreadBindings).where(eq(slackThreadBindings.key, key)).get();
  return row ? rowToBinding(row) : null;
}

export function getAllSlackBindings(): SlackThreadBinding[] {
  return getDb().select().from(slackThreadBindings).all().map(rowToBinding);
}

export function getSlackBindingsByThread(threadId: string): SlackThreadBinding[] {
  return getDb()
    .select()
    .from(slackThreadBindings)
    .where(eq(slackThreadBindings.threadId, threadId))
    .all()
    .map(rowToBinding);
}

export function saveSlackBinding(binding: SlackThreadBinding): void {
  const row = bindingToRow(binding);
  const { key: _key, ...set } = row;
  getDb().insert(slackThreadBindings).values(row).onConflictDoUpdate({ target: slackThreadBindings.key, set }).run();
}

export function deleteSlackBinding(key: string): void {
  getDb().delete(slackThreadBindings).where(eq(slackThreadBindings.key, key)).run();
}

export function getSlackCursor(channelId: string): string | null {
  const row = getDb()
    .select({ cursorTs: slackChannelCursors.cursorTs })
    .from(slackChannelCursors)
    .where(eq(slackChannelCursors.channelId, channelId))
    .get();
  return row?.cursorTs ?? null;
}

export function setSlackCursor(channelId: string, ts: string): void {
  getDb()
    .insert(slackChannelCursors)
    .values({ channelId, cursorTs: ts })
    .onConflictDoUpdate({ target: slackChannelCursors.channelId, set: { cursorTs: ts } })
    .run();
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

type RecordingRow = typeof recordings.$inferSelect;

function rowToRecording(row: RecordingRow): RecordingRecord {
  return {
    id: row.id,
    threadId: row.threadId ?? null,
    title: row.title ?? null,
    audioPath: row.audioPath,
    transcriptPath: row.transcriptPath,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt,
  };
}

export function saveRecording(recording: Omit<RecordingRecord, 'threadId'>): void {
  getDb()
    .insert(recordings)
    .values({
      id: recording.id,
      threadId: null,
      title: recording.title ?? null,
      audioPath: recording.audioPath,
      transcriptPath: recording.transcriptPath,
      durationSeconds: recording.durationSeconds,
      createdAt: recording.createdAt,
    })
    .run();
}

export function setRecordingThread(recordingId: string, threadId: string): void {
  const result = getDb().update(recordings).set({ threadId }).where(eq(recordings.id, recordingId)).run();
  if (result.changes !== 1) throw new Error(`Recording ${recordingId} not found (setRecordingThread)`);
}

export function setRecordingTitle(recordingId: string, title: string): void {
  const result = getDb().update(recordings).set({ title }).where(eq(recordings.id, recordingId)).run();
  if (result.changes !== 1) throw new Error(`Recording ${recordingId} not found (setRecordingTitle)`);
}

export function getRecording(recordingId: string): RecordingRecord | null {
  const row = getDb().select().from(recordings).where(eq(recordings.id, recordingId)).get();
  return row ? rowToRecording(row) : null;
}

/**
 * Atomically reads-and-deletes a recording row. Returns the audio + transcript paths
 * so the caller can remove the on-disk files. Wrapped in a transaction so two racing
 * callers cannot both succeed and double-delete the same files.
 */
export function deleteRecording(recordingId: string): string[] {
  const raw = getThreadsDb();
  const select = raw.prepare(`SELECT audio_path, transcript_path FROM recordings WHERE id = ?`);
  const del = raw.prepare(`DELETE FROM recordings WHERE id = ?`);
  return raw.transaction(() => {
    const row = select.get(recordingId) as { audio_path: string; transcript_path: string } | undefined;
    if (!row) throw new Error(`Recording ${recordingId} not found`);
    const result = del.run(recordingId);
    if (result.changes !== 1) throw new Error(`Recording ${recordingId} disappeared mid-delete`);
    return [row.audio_path, row.transcript_path];
  })();
}

export function listRecordings(limit = 50, offset = 0): RecordingRecord[] {
  return getDb()
    .select()
    .from(recordings)
    .orderBy(desc(recordings.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map(rowToRecording);
}

// ---------------------------------------------------------------------------
// Webhook event helpers
// ---------------------------------------------------------------------------

export interface WebhookEventRow {
  id: string;
  jobId: string;
  source: string | null;
  payloadPath: string;
  headers: Record<string, string>;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  error: string | null;
  receivedAt: number;
  processedAt: number | null;
}

type WebhookRow = typeof webhookEvents.$inferSelect;

function rowToWebhookEvent(row: WebhookRow): WebhookEventRow {
  return {
    id: row.id,
    jobId: row.jobId,
    source: row.source ?? null,
    payloadPath: row.payloadPath,
    headers: parseJson<Record<string, string>>(
      row.headers,
      {},
      {
        table: 'webhook_events',
        column: 'headers',
        id: row.id,
      }
    ),
    status: row.status as WebhookEventRow['status'],
    error: row.error ?? null,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? null,
  };
}

export function insertWebhookEvent(event: Omit<WebhookEventRow, 'status' | 'error' | 'processedAt'>): void {
  getDb()
    .insert(webhookEvents)
    .values({
      id: event.id,
      jobId: event.jobId,
      source: event.source ?? null,
      payloadPath: event.payloadPath,
      headers: JSON.stringify(event.headers),
      status: 'pending',
      receivedAt: event.receivedAt,
    })
    .run();
}

export function updateWebhookEventStatus(id: string, status: WebhookEventRow['status'], error?: string): void {
  getDb()
    .update(webhookEvents)
    .set({
      status,
      error: error ?? null,
      processedAt: status === 'processed' || status === 'failed' ? Date.now() : null,
    })
    .where(eq(webhookEvents.id, id))
    .run();
}

export function resetProcessingWebhookEvents(): void {
  getDb().update(webhookEvents).set({ status: 'pending' }).where(eq(webhookEvents.status, 'processing')).run();
}

/**
 * Returns events with status='pending' only. Callers must call
 * resetProcessingWebhookEvents() once at startup to recover any
 * 'processing' rows left by a previous crash; including 'processing'
 * here would let two workers double-process the same event.
 */
export function getPendingWebhookEvents(): WebhookEventRow[] {
  return getDb()
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, 'pending'))
    .orderBy(webhookEvents.receivedAt)
    .all()
    .map(rowToWebhookEvent);
}

export function deleteOldWebhookEvents(olderThanMs: number): string[] {
  const cutoff = Date.now() - olderThanMs;
  const deleted = getDb()
    .delete(webhookEvents)
    .where(and(inArray(webhookEvents.status, ['processed', 'failed']), lt(webhookEvents.receivedAt, cutoff)))
    .returning({ payloadPath: webhookEvents.payloadPath })
    .all();
  return deleted.map((r) => r.payloadPath);
}
