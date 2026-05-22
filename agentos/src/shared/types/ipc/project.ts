import type { ProjectConfig } from '../project';

export const PROJECT_IPC_CHANNELS = {
  PROJECT_LIST: 'project:list',
  PROJECT_SAVE: 'project:save',
  PROJECT_DELETE: 'project:delete',
  PROJECT_GET_CONFIG: 'project:getConfig',
  PROJECT_UPDATE_CONFIG: 'project:updateConfig',
  PROJECT_INIT_CONFIG: 'project:initConfig',
  PROJECT_OPEN_CONFIG: 'project:openConfig',
} as const;

export interface ProjectConfigLookup {
  config: ProjectConfig | null;
  exists: boolean;
  path: string;
  warnings: string[];
}

export interface ProjectConfigInitResult {
  ok: boolean;
  created: boolean;
  lookup: ProjectConfigLookup;
}

export interface ProjectConfigOpenResult {
  ok: boolean;
  error?: string;
}

export interface SaveProjectRequest {
  path: string;
  name?: string;
}
