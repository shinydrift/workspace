import { execFile, spawn } from 'child_process';
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
      const editor = getStore().get('settings').editor;
      const bin = editor?.command?.trim();
      // No editor configured (or its launch fails) → fall back to the OS file manager so the
      // action never silently no-ops. shell.openPath resolves to '' on success, an error string
      // otherwise.
      const openInFileManager = () => shell.openPath(folderPath);
      if (!bin) {
        await openInFileManager();
        return;
      }
      // `command` is the whole executable — kept intact so a full path with spaces (e.g. a macOS
      // `.app` bundle path) still resolves; extra flags live in the separate `args` field. The
      // folder is always the final argument. Resolve against the user's interactive shell PATH: a
      // GUI-launched Electron app inherits a minimal PATH, so `code`/`cursor` would otherwise not
      // be found.
      const extraArgs = editor?.args?.trim() ? editor.args.trim().split(/\s+/) : [];
      const hostEnv = await getHostShellEnv();
      // On Windows the common editor CLIs are batch shims (VS Code ships `code.cmd`), and
      // CreateProcess cannot launch a `.cmd` directly — so spawn must go through the shell there.
      // With `shell` on, Node no longer quotes args, so wrap the executable and every argument in
      // double quotes ourselves (doubling embedded quotes) so paths with spaces survive cmd.exe.
      // On macOS/Linux keep `shell` off: spawn hands the user-supplied strings straight to execve,
      // which stays injection-safe.
      const useShell = process.platform === 'win32';
      const quoteForShell = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const launchBin = useShell ? quoteForShell(bin) : bin;
      const launchArgs = [...extraArgs, folderPath].map((arg) => (useShell ? quoteForShell(arg) : arg));
      // Spawn detached and don't await the child's lifetime: a GUI editor that stays open (or a
      // `--wait` flag) must not keep the IPC call pending or buffer the child's stdout. Resolve as
      // soon as it launches; fall back to the file manager only on a launch error (e.g. ENOENT).
      await new Promise<void>((resolve) => {
        try {
          const child = spawn(launchBin, launchArgs, {
            env: { ...process.env, ...hostEnv },
            detached: true,
            stdio: 'ignore',
            shell: useShell,
          });
          child.once('spawn', () => resolve());
          child.once('error', () => void openInFileManager().finally(() => resolve()));
          child.unref();
        } catch {
          void openInFileManager().finally(() => resolve());
        }
      });
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
