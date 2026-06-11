import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { ensureSlackUploadsDir, SLACK_UPLOADS_RELATIVE } from '../../integrations/slackUploadWorkspace';
import * as threadStore from '../../threads/threadStore';
import {
  saveRecording,
  setRecordingThread,
  setRecordingTitle,
  deleteRecording,
  listRecordings,
} from '../../threads/db';
import { handleIpc } from '../ipcResponse';

const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DURATION_SECONDS = 8 * 60 * 60; // 8 h
const MAX_TITLE_LENGTH = 200;

function recordingsRoot(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

/** Strip directory components and reject empty, '.', or '..' names. */
function safeFilename(raw: string): string {
  const name = path.basename(raw);
  if (!name || name === '.' || name === '..') throw new Error('Invalid filename');
  return name;
}

/** Ensure dest stays inside dir (defense-in-depth after safeFilename). */
function assertContained(dest: string, dir: string): void {
  if (!path.resolve(dest).startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('Path escaped target directory');
  }
}

const RecordingSaveSchema = z.object({
  duration: z.number().finite().nonnegative().max(MAX_DURATION_SECONDS),
  arrayBuffer: z.instanceof(ArrayBuffer).refine((b) => b.byteLength <= MAX_AUDIO_BYTES, 'Audio too large'),
  transcript: z.string().refine((t) => Buffer.byteLength(t, 'utf8') <= MAX_TRANSCRIPT_BYTES, 'Transcript too large'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
});

const recordingIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const RecordingSetThreadSchema = z.object({
  recordingId: recordingIdSchema,
  threadId: z.string().min(1).max(128),
});

const RecordingSetTitleSchema = z.object({
  recordingId: recordingIdSchema,
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
});

const RecordingDeleteSchema = z.object({
  recordingId: recordingIdSchema,
});

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_UPLOAD, (_e, raw: { threadId: string; fileName: string; data: ArrayBuffer }) =>
    handleIpc(async () => {
      const { threadId, fileName, data } = raw;
      const thread = threadStore.getThread(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);

      const uploadsDir = await ensureSlackUploadsDir(thread.workingDirectory);

      const safeName = safeFilename(fileName);
      const destPath = path.join(uploadsDir, safeName);
      assertContained(destPath, uploadsDir);
      await fs.writeFile(destPath, Buffer.from(data));

      return { path: path.join(SLACK_UPLOADS_RELATIVE, safeName) };
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIPT_SAVE,
    (_e, raw: { workingDirectory: string; filename: string; text: string }) =>
      handleIpc(async () => {
        const { workingDirectory, filename, text } = raw;
        if (typeof workingDirectory !== 'string' || !workingDirectory || workingDirectory.length > 4096) {
          throw new Error('Invalid working directory');
        }
        const safeName = safeFilename(filename);
        const dir = path.join(workingDirectory, '.agentos', 'transcripts');
        await fs.mkdir(dir, { recursive: true });
        const dest = path.join(dir, safeName);
        assertContained(dest, dir);
        await fs.writeFile(dest, text, 'utf8');
        return { path: path.join('.agentos', 'transcripts', safeName) };
      })
  );

  ipcMain.handle(IPC_CHANNELS.RECORDING_SAVE, (_e, raw: unknown) =>
    handleIpc(async () => {
      const { duration, arrayBuffer, transcript, title } = RecordingSaveSchema.parse(raw);
      const recordingId = nanoid();
      const root = recordingsRoot();
      const dir = path.join(root, recordingId);
      const tmpDir = `${dir}.tmp`;
      await fs.mkdir(tmpDir, { recursive: true });
      try {
        await fs.writeFile(path.join(tmpDir, 'audio.wav'), Buffer.from(arrayBuffer));
        await fs.writeFile(path.join(tmpDir, 'transcript.txt'), transcript, 'utf8');
        await fs.rename(tmpDir, dir);
        saveRecording({
          id: recordingId,
          title: title ?? null,
          audioPath: path.join(dir, 'audio.wav'),
          transcriptPath: path.join(dir, 'transcript.txt'),
          durationSeconds: duration,
          createdAt: Date.now(),
        });
      } catch (err) {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        throw err;
      }
      return { recordingId };
    })
  );

  ipcMain.handle(IPC_CHANNELS.RECORDING_SET_THREAD, (_e, raw: unknown) =>
    handleIpc(async () => {
      const { recordingId, threadId } = RecordingSetThreadSchema.parse(raw);
      setRecordingThread(recordingId, threadId);
    })
  );

  ipcMain.handle(IPC_CHANNELS.RECORDING_SET_TITLE, (_e, raw: unknown) =>
    handleIpc(async () => {
      const { recordingId, title } = RecordingSetTitleSchema.parse(raw);
      setRecordingTitle(recordingId, title);
    })
  );

  ipcMain.handle(IPC_CHANNELS.RECORDING_DELETE, (_e, raw: unknown) =>
    handleIpc(async () => {
      const { recordingId } = RecordingDeleteSchema.parse(raw);
      const root = recordingsRoot();
      const filePaths = deleteRecording(recordingId);
      // Best-effort file cleanup — DB row already gone
      const dir = path.join(root, recordingId);
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      // Fallback: remove individual files if they were stored outside the expected dir
      for (const p of filePaths) {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(path.resolve(root) + path.sep)) continue;
        try {
          await fs.rm(resolved, { force: true });
        } catch {
          /* ignore */
        }
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.RECORDING_LIST, (_e, raw?: { limit?: number; offset?: number }) =>
    handleIpc(async () => {
      const limit = Math.min(raw?.limit ?? 50, 200);
      const offset = raw?.offset ?? 0;
      return listRecordings(limit, offset);
    })
  );
}
