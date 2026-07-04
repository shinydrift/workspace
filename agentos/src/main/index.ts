import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

// Packaged macOS apps launch with a minimal PATH that excludes shell-configured locations
// (Homebrew, Docker Desktop, etc.). Two-step approach: sync disk cache read (~0ms) for fast
// boot, then async shell query to update the running session and refresh the cache.
if (process.platform === 'darwin') {
  const shell = process.env.SHELL || '/bin/zsh';
  // Mirrors the dev-mode userData correction below so sync read and async write use the same path.
  const userDataPath = app.isPackaged ? app.getPath('userData') : path.join(app.getPath('appData'), app.getName());
  const cacheFile = path.join(userDataPath, '.cached-shell-path');

  // Sync fast path: use disk cache or fall back to well-known locations
  const fallbackPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'];
  try {
    const cached = fs.readFileSync(cacheFile, 'utf8').trim();
    process.env.PATH = cached || [...fallbackPaths, process.env.PATH ?? ''].join(':');
  } catch {
    process.env.PATH = [...fallbackPaths, process.env.PATH ?? ''].join(':');
  }

  // Async refresh: update PATH for this session and write cache for next launch
  execFile(shell, ['-l', '-c', 'echo $PATH'], { timeout: 3000 }, (err, stdout) => {
    if (err) return;
    const newPath = String(stdout).trim();
    if (!newPath) return;
    process.env.PATH = newPath;
    fs.mkdir(userDataPath, { recursive: true }, () => {
      fs.writeFile(cacheFile, newPath, () => {});
    });
  });
}
import started from 'electron-squirrel-startup';
import { setupAutoUpdates } from './bootstrap/updates';
import { eventLogger } from './utils/eventLog';
import { registerIpcHandlers } from './ipc/sessionHandlers';
import { createWindow } from './bootstrap/windows';
import { bootServices } from './bootstrap/services';
import { registerAppIpcHandlers } from './bootstrap/ipc';
import { setupLifecycle } from './bootstrap/lifecycle';

// node-llama-cpp adds one beforeExit listener per concurrent embedding operation.
// With many projects indexing simultaneously at startup, the count can exceed 20.
// Raise the limit to avoid spurious MaxListenersExceededWarning from this known
// third-party pattern.
process.setMaxListeners(50);

if (started) app.quit();

// In dev mode the Electron binary names userData "Electron"; force it to match
// the packaged app path so the store and any userData-relative state are shared.
if (!app.isPackaged) {
  const appDataDir = app.getPath('appData');
  const newUserData = path.join(appDataDir, app.getName());
  app.setPath('userData', newUserData);
  // One-time migration: copy legacy dev store into the shared location so
  // existing API keys and settings aren't lost on first run after this change.
  const legacyConfig = path.join(appDataDir, 'Electron', 'config.json');
  const newConfig = path.join(newUserData, 'config.json');
  if (fs.existsSync(legacyConfig) && !fs.existsSync(newConfig)) {
    fs.mkdirSync(newUserData, { recursive: true });
    fs.copyFileSync(legacyConfig, newConfig);
  }
}

let mainWindow: BrowserWindow | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

if (app.isPackaged) {
  setupAutoUpdates();
}

app.on('ready', () => {
  const homeDir = app.getPath('home');
  const preloadPath = path.join(__dirname, 'preload.js');
  const rendererBase = path.join(__dirname, '../renderer');

  registerIpcHandlers();
  mainWindow = createWindow(preloadPath, rendererBase);
  const services = bootServices(mainWindow, { homeDir, preloadPath, rendererBase });
  registerAppIpcHandlers(services);
  setupLifecycle(services, preloadPath, rendererBase);

  eventLogger.info('app', 'agentos started', { version: app.getVersion() });
});
