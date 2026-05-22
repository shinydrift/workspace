import { THREAD_IPC_CHANNELS } from './thread';
import { MEMORY_IPC_CHANNELS } from './memory';
import { KANBAN_IPC_CHANNELS } from './kanban';
import { COUNCIL_IPC_CHANNELS } from './council';
import { SETTINGS_IPC_CHANNELS } from './settings';
import { SLACK_IPC_CHANNELS } from './slack';
import { WINDOW_IPC_CHANNELS } from './window';
import { AUTOMATION_IPC_CHANNELS } from './automation';
import { PROJECT_IPC_CHANNELS } from './project';
import { SANDBOX_IPC_CHANNELS } from './sandbox';
import { AUDIO_IPC_CHANNELS } from './audio';
import { ANALYTICS_IPC_CHANNELS } from './analytics';
import { WIKI_IPC_CHANNELS } from './wiki';
import { FILES_IPC_CHANNELS } from './files';
import { MISC_IPC_CHANNELS } from './misc';

export const IPC_CHANNELS = {
  ...THREAD_IPC_CHANNELS,
  ...MEMORY_IPC_CHANNELS,
  ...KANBAN_IPC_CHANNELS,
  ...COUNCIL_IPC_CHANNELS,
  ...SETTINGS_IPC_CHANNELS,
  ...SLACK_IPC_CHANNELS,
  ...WINDOW_IPC_CHANNELS,
  ...AUTOMATION_IPC_CHANNELS,
  ...PROJECT_IPC_CHANNELS,
  ...SANDBOX_IPC_CHANNELS,
  ...AUDIO_IPC_CHANNELS,
  ...ANALYTICS_IPC_CHANNELS,
  ...WIKI_IPC_CHANNELS,
  ...FILES_IPC_CHANNELS,
  ...MISC_IPC_CHANNELS,
} as const;

export * from './thread';
export * from './memory';
export * from './kanban';
export * from './council';
export * from './settings';
export * from './slack';
export * from './window';
export * from './automation';
export * from './project';
export * from './sandbox';
export * from './audio';
export * from './analytics';
export * from './wiki';
export * from './files';
export * from './misc';
export * from './ipc-events';
