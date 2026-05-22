import type { WikiPage } from '../wiki';

export const WIKI_IPC_CHANNELS = {
  WIKI_LIST: 'wiki:list',
  WIKI_GET: 'wiki:get',
  WIKI_SAVE: 'wiki:save',
  WIKI_DELETE: 'wiki:delete',
} as const;

export interface WikiSaveRequest {
  projectPath: string;
  page: WikiPage;
}
