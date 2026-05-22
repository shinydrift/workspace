export const WINDOW_IPC_CHANNELS = {
  DIALOG_OPEN_DIR: 'dialog:openDirectory',
  DESKTOP_CAPTURER_GET_SOURCES: 'desktop:getSources',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_FOCUS: 'window:focus',
  WINDOW_PASTE_TRANSCRIPT: 'window:pasteTranscript',
} as const;

export type RecordingState = 'idle' | 'recording' | 'transcribing';

export interface RecordingOverlayPayload {
  state: RecordingState;
  downloadProgress: number | null;
  transcriptPreview: string;
}

export interface ShutdownOverlayPayload {
  step: string;
  done: boolean;
}
