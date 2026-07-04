import { app, BrowserWindow, desktopCapturer, screen, session, shell } from 'electron';
import path from 'path';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const TRAFFIC_LIGHT_POSITION = { x: 14, y: 13 };
const OVERLAY_WIDTH = 360;
const OVERLAY_HEIGHT = 44;

function isExternalUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    const host = hostname.replace(/\.$/, ''); // normalize trailing dot (e.g. "localhost.")
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0';
  } catch {
    return false;
  }
}

function overlayPosition(): { x: number; y: number } {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  return { x: Math.round(sw / 2 - OVERLAY_WIDTH / 2), y: sh - OVERLAY_HEIGHT - 24 };
}

function createOverlay(preloadPath: string): BrowserWindow {
  const { x, y } = overlayPosition();
  const overlay = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });
  if (process.platform === 'darwin') {
    overlay.setAlwaysOnTop(true, 'screen-saver');
  }
  screen.on('display-metrics-changed', () => {
    if (overlay.isDestroyed()) return;
    const { x: nx, y: ny } = overlayPosition();
    overlay.setPosition(nx, ny);
  });
  return overlay;
}

export function createWindow(preloadPath: string, rendererBase: string): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'agentos-logo-512.png')
    : path.join(app.getAppPath(), 'resources', 'agentos-logo-512.png');
  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    icon: iconPath,
    ...(isMac ? { titleBarStyle: 'hidden', trafficLightPosition: TRAFFIC_LIGHT_POSITION } : { frame: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: preloadPath,
    },
  });

  // Content Security Policy — only enforce in production; dev mode needs 'unsafe-inline' for Vite Fast Refresh
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:;",
          ],
        },
      });
    });
  }

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Enable system audio capture via getDisplayMedia() in the renderer.
  // Required in Electron 17+ — the legacy getUserMedia+chromeMediaSource approach
  // causes an INVALID_INITIATOR_ORIGIN renderer termination without this handler.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback(sources.length > 0 ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (process.env.AGENTOS_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(rendererBase, `${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return mainWindow;
}

export function createShutdownOverlay(preloadPath: string): BrowserWindow {
  return createOverlay(preloadPath);
}

export function createRecordingOverlay(preloadPath: string): BrowserWindow {
  return createOverlay(preloadPath);
}
