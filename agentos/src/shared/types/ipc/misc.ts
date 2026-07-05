export const MISC_IPC_CHANNELS = {
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_OPEN_IN_EDITOR: 'shell:openInEditor',
  SHELL_OPEN_FOLDER_TARGET: 'shell:openFolderTarget',
  SHELL_OPEN_ATTACHMENT: 'shell:openAttachment',
  LOG_GET_HISTORY: 'log:getHistory',
  HEALTH_RUN: 'health:run',
  ENV_LIST_SHELL_VARS: 'env:listShellVars',
  APP_GET_INFO: 'app:getInfo',
  APP_GET_UPDATE_STATUS: 'app:getUpdateStatus',
  APP_QUIT_AND_INSTALL: 'app:quitAndInstall',
} as const;

export interface UpdateReadyEvent {
  releaseName: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppLogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  subsystem: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message?: string;
  durationMs?: number;
}

export interface HealthReport {
  checks: HealthCheck[];
  ranAt: number;
  overall: 'ok' | 'warn' | 'error';
  durationMs: number;
}
