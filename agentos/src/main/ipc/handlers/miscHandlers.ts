import { execFile, spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { basename, join } from 'path';
import { promisify } from 'util';
import { ipcMain, shell, desktopCapturer, dialog, BrowserWindow, app, clipboard } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { threadManager, threadReads } from '../../sessions/ThreadManager';
import { threadPostsStore } from '../../sessions/threadPostsStore';
import { getLogHistory } from '../../utils/eventLog';
import { runHealthChecks } from '../../health/service';
import { getHostShellEnv } from '../../utils/hostEnv';
import { getStore } from '../../store';
import { getPendingUpdate, requestQuitAndInstall } from '../../bootstrap/updates';
import { ThreadIdSchema } from './schemas';
import { handleIpc } from '../ipcResponse';

const execFileAsync = promisify(execFile);
const OpenExternalSchema = z.object({ url: z.string().url() });
const OpenInEditorSchema = z.object({ folderPath: z.string().min(1) });
const OpenFolderTargetSchema = z.object({
  folderPath: z.string().min(1),
  target: z.enum(['vscode', 'finder', 'terminal', 'xcode']),
});
const OpenAttachmentSchema = z.object({
  name: z.string().min(1),
  data: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
});

function splitArgs(raw?: string): string[] {
  return raw?.trim() ? raw.trim().split(/\s+/) : [];
}

function isVsCodeEditor(label: string | undefined, command: string): boolean {
  const normalized = `${label ?? ''} ${command}`.toLowerCase();
  return (
    normalized.includes('vs code') ||
    normalized.includes('visual studio code') ||
    /(^|[/\\])code(\.cmd)?$/.test(command)
  );
}

async function spawnDetached(bin: string, args: string[]): Promise<boolean> {
  const hostEnv = await getHostShellEnv();
  const useShell = process.platform === 'win32';
  const quoteForShell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const launchBin = useShell ? quoteForShell(bin) : bin;
  const launchArgs = args.map((arg) => (useShell ? quoteForShell(arg) : arg));

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(launchBin, launchArgs, {
        env: { ...process.env, ...hostEnv },
        detached: true,
        stdio: 'ignore',
        shell: useShell,
      });
      child.once('spawn', () => resolve(true));
      child.once('error', () => resolve(false));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}

async function openInFileManager(folderPath: string): Promise<void> {
  await shell.openPath(folderPath);
}

async function openInConfiguredEditor(folderPath: string, forceVsCodeNewWindow = false): Promise<void> {
  const editor = getStore().get('settings').editor;
  const configuredBin = editor?.command?.trim();
  const shouldUseCodeCli = forceVsCodeNewWindow && (!configuredBin || !isVsCodeEditor(editor?.label, configuredBin));
  const bin = shouldUseCodeCli ? 'code' : configuredBin;

  if (!bin) {
    await openInFileManager(folderPath);
    return;
  }

  const args = shouldUseCodeCli ? [] : splitArgs(editor?.args);
  if (
    (forceVsCodeNewWindow || isVsCodeEditor(editor?.label, bin)) &&
    !args.includes('-n') &&
    !args.includes('--new-window')
  ) {
    args.unshift('-n');
  }

  if (!(await spawnDetached(bin, [...args, folderPath]))) {
    await openInFileManager(folderPath);
  }
}

async function openTerminalAtFolder(folderPath: string): Promise<void> {
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "cd " & quoted form of ${JSON.stringify(folderPath)}`;
    await execFileAsync('osascript', ['-e', script], { timeout: 3000, killSignal: 'SIGKILL' });
    return;
  }

  if (process.platform === 'win32') {
    if (!(await spawnDetached('cmd.exe', ['/K', 'cd', '/d', folderPath]))) await openInFileManager(folderPath);
    return;
  }

  const candidates: Array<[string, string[]]> = [
    ['x-terminal-emulator', ['--working-directory', folderPath]],
    ['gnome-terminal', ['--working-directory', folderPath]],
    ['konsole', ['--workdir', folderPath]],
  ];
  for (const [bin, args] of candidates) {
    if (await spawnDetached(bin, args)) return;
  }
  await openInFileManager(folderPath);
}

async function openInXcode(folderPath: string): Promise<void> {
  if (process.platform === 'darwin') {
    if (await spawnDetached('open', ['-a', 'Xcode', folderPath])) return;
  }
  await openInFileManager(folderPath);
}

export function registerMiscHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MESSAGES_LIST, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadReads.listMessages(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.MESSAGES_PENDING, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadReads.getPendingOutput(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.MESSAGES_CLEAR, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      threadManager.clearMessages(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_POSTS_LIST, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadPostsStore.list(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOG_GET_HISTORY, () => handleIpc(() => getLogHistory()));

  ipcMain.handle(IPC_CHANNELS.HEALTH_RUN, () => handleIpc(() => runHealthChecks()));

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (_e, raw) =>
    handleIpc(async () => {
      const { url } = OpenExternalSchema.parse(raw);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        await shell.openExternal(url);
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_IN_EDITOR, (_e, raw) =>
    handleIpc(async () => {
      const { folderPath } = OpenInEditorSchema.parse(raw);
      await openInConfiguredEditor(folderPath);
    })
  );

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_FOLDER_TARGET, (_e, raw) =>
    handleIpc(async () => {
      const { folderPath, target } = OpenFolderTargetSchema.parse(raw);
      if (target === 'vscode') await openInConfiguredEditor(folderPath, true);
      else if (target === 'finder') await openInFileManager(folderPath);
      else if (target === 'terminal') await openTerminalAtFolder(folderPath);
      else await openInXcode(folderPath);
    })
  );

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_ATTACHMENT, (_e, raw) =>
    handleIpc(async () => {
      const { name, data } = OpenAttachmentSchema.parse(raw);
      // Attachments live only in memory before send, so write the buffer to a temp file and
      // hand its path to the OS. basename() strips any path segments from the display name.
      const dir = join(app.getPath('temp'), 'agentos-attachments');
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, basename(name));
      await writeFile(filePath, data instanceof Uint8Array ? data : new Uint8Array(data));
      await shell.openPath(filePath);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DESKTOP_CAPTURER_GET_SOURCES, (_e, raw) =>
    handleIpc(async () => {
      const { types } = z.object({ types: z.array(z.enum(['screen', 'window'])) }).parse(raw);
      const sources = await desktopCapturer.getSources({ types });
      return sources.map((s) => ({ id: s.id, name: s.name }));
    })
  );

  ipcMain.handle(IPC_CHANNELS.ENV_LIST_SHELL_VARS, () =>
    handleIpc(async () => {
      const env = await getHostShellEnv();
      return Object.keys(env).sort();
    })
  );

  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, () =>
    handleIpc(() => ({
      version: app.getVersion(),
    }))
  );

  ipcMain.handle(IPC_CHANNELS.APP_GET_UPDATE_STATUS, () => handleIpc(() => getPendingUpdate()));

  ipcMain.handle(IPC_CHANNELS.APP_QUIT_AND_INSTALL, () =>
    handleIpc(() => {
      requestQuitAndInstall();
    })
  );

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIR, (e) =>
    handleIpc(async () => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await dialog.showOpenDialog(win ?? undefined, {
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    })
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (e) =>
    handleIpc(() => {
      BrowserWindow.fromWebContents(e.sender)?.minimize();
    })
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, (e) =>
    handleIpc(() => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win?.isMaximized()) win.unmaximize();
      else win?.maximize();
    })
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (e) =>
    handleIpc(() => {
      BrowserWindow.fromWebContents(e.sender)?.close();
    })
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (e) =>
    handleIpc(() => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false)
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_FOCUS, (e) =>
    handleIpc(() => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    })
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_PASTE_TRANSCRIPT, (_e, raw) =>
    handleIpc(async () => {
      const { text, targetApp: rawTargetApp } = z
        .object({ text: z.string().max(100_000), targetApp: z.string().max(64).nullish() })
        .parse(raw);
      // Allowlist: only characters that cannot break out of an AppleScript string literal or
      // inject new statements. Falls back to null (skip re-focus step) if the name is invalid.
      const targetApp = rawTargetApp && /^[A-Za-z0-9 ._-]{1,64}$/.test(rawTargetApp) ? rawTargetApp : null;

      // Save clipboard contents before overwriting.
      const savedText = clipboard.readText();
      const savedHTML = clipboard.readHTML();
      const savedRTF = clipboard.readRTF();
      const savedImage = clipboard.readImage();

      clipboard.writeText(text);
      try {
        if (process.platform === 'darwin') {
          // Re-focus the original app by name before sending Cmd+V. Transcription can take
          // several seconds, so the user may have switched apps in the meantime; without this
          // the keystroke lands in whatever happens to be frontmost at paste time.
          const activateScript = targetApp
            ? `tell application "System Events" to set frontmost of process "${targetApp}" to true`
            : '';
          const script = activateScript
            ? `${activateScript}
delay 0.1
tell application "System Events" to tell process "${targetApp}" to key code 51
tell application "System Events" to tell process "${targetApp}" to keystroke "v" using command down`
            : `tell application "System Events" to key code 51
tell application "System Events" to keystroke "v" using command down`;
          await execFileAsync('osascript', ['-e', script], { timeout: 3000, killSignal: 'SIGKILL' });
        }
      } finally {
        // Restore prior clipboard contents after the keystroke is delivered.
        clipboard.write({
          text: savedText,
          html: savedHTML,
          rtf: savedRTF,
          ...(savedImage.isEmpty() ? {} : { image: savedImage }),
        });
      }
    })
  );
}
