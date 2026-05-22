import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/types/ipc';

const POLL_INTERVAL_MS = 15000;
const OSASCRIPT_TIMEOUT_MS = 8000;
const ERROR_THRESHOLD = 3;

// Single source of truth for meeting URL substrings — used by both the AppleScript
// browser scan and the BrowserWindow.getAllWindows() fallback.
const MEETING_URL_PATTERNS = [
  'meet.google.com',
  'zoom.us/j/',
  'zoom.us/wc/',
  'teams.microsoft.com/l/meetup-join',
  'whereby.com/',
  'webex.com/meet/',
  'around.co/',
];

// try/end try per browser: Automation permission denial silently skips that browser
// rather than aborting the whole detection cycle.
// Inner try/end try per tab: a single bad/loading tab won't abort the whole browser loop.
const DETECT_SCRIPT = `
set patterns to {${MEETING_URL_PATTERNS.map((p) => `"${p}"`).join(', ')}}

on isMeeting(tabUrl)
  repeat with p in patterns
    if tabUrl contains p then return true
  end repeat
  return false
end isMeeting

if application "Google Chrome" is running then
  try
    tell application "Google Chrome"
      repeat with w in every window
        repeat with t in every tab of w
          try
            if my isMeeting(URL of t) then return URL of t
          end try
        end repeat
      end repeat
    end tell
  end try
end if

if application "Safari" is running then
  try
    tell application "Safari"
      repeat with w in every window
        repeat with t in every tab of w
          try
            if my isMeeting(URL of t) then return URL of t
          end try
        end repeat
      end repeat
    end tell
  end try
end if

if application "Microsoft Edge" is running then
  try
    tell application "Microsoft Edge"
      repeat with w in every window
        repeat with t in every tab of w
          try
            if my isMeeting(URL of t) then return URL of t
          end try
        end repeat
      end repeat
    end tell
  end try
end if

return ""
`.trim();

type QueryResult = { url: string } | { error: string };

function queryBrowserTabs(): Promise<QueryResult> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', DETECT_SCRIPT], { timeout: OSASCRIPT_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        resolve({ error: err.message });
        return;
      }
      resolve({ url: stdout.trim() });
    });
  });
}

export class MeetingDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeUrl: string | null = null;
  private isPolling = false;
  private consecutiveErrors = 0;
  private win: BrowserWindow | null = null;

  start(win: BrowserWindow) {
    if (process.platform !== 'darwin') return;
    this.win = win;
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.poll();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeUrl = null;
    this.consecutiveErrors = 0;
    this.win = null;
  }

  dispose(): void {
    this.stop();
  }

  private async poll() {
    if (this.isPolling) return;
    if (!this.win || this.win.isDestroyed()) return;
    this.isPolling = true;
    try {
      const result = await queryBrowserTabs();
      // Re-check after await: stop() may have nulled this.win during the osascript suspension
      if (!this.win || this.win.isDestroyed()) return;

      if ('error' in result) {
        this.consecutiveErrors++;
        if (this.consecutiveErrors === ERROR_THRESHOLD) {
          this.win.webContents.send(IPC_EVENTS.MEETING_DETECTOR_ERROR, { error: result.error });
        }
        // Do not transition meeting state on error — treat as unknown, not ended
        return;
      }

      this.consecutiveErrors = 0;

      // Also detect via AgentOS BrowserWindows (no Automation permission needed)
      let url = result.url;
      if (!url) {
        url = this.detectInternalMeetingUrl();
      }

      if (url && url !== this.activeUrl) {
        this.activeUrl = url;
        this.win.webContents.send(IPC_EVENTS.MEETING_DETECTED, { url });
      } else if (!url && this.activeUrl) {
        this.activeUrl = null;
        this.win.webContents.send(IPC_EVENTS.MEETING_ENDED);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private detectInternalMeetingUrl(): string {
    for (const win of BrowserWindow.getAllWindows()) {
      const tabUrl = win.webContents.getURL();
      if (MEETING_URL_PATTERNS.some((p) => tabUrl.includes(p))) return tabUrl;
    }
    return '';
  }
}

export const meetingDetector = new MeetingDetector();
