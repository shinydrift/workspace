export const FILES_IPC_CHANNELS = {
  FILE_UPLOAD: 'file:upload',
  TRANSCRIPT_SAVE: 'transcript:save',
  RECORDING_SAVE: 'recording:save',
  RECORDING_SET_THREAD: 'recording:setThread',
  RECORDING_SET_TITLE: 'recording:setTitle',
  RECORDING_DELETE: 'recording:delete',
  RECORDING_READ: 'recording:read',
  RECORDING_LIST: 'recording:list',
  RECORDING_SEGMENTS: 'recording:segments',
} as const;

export interface RecordingRecord {
  id: string;
  threadId: string | null;
  title: string | null;
  audioPath: string;
  transcriptPath: string;
  durationSeconds: number;
  createdAt: number;
  // null → manual meeting recording; 'segment' → continuous-capture 5-min clip.
  kind: string | null;
}

export interface FileUploadRequest {
  threadId: string;
  fileName: string;
  data: ArrayBuffer;
}
