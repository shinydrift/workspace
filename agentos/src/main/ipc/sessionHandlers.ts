import { registerThreadHandlers } from './handlers/threadHandlers';
import { registerTerminalHandlers } from './handlers/terminalHandlers';
import { registerMemoryHandlers } from './handlers/memoryHandlers';
import { registerProjectHandlers } from './handlers/projectHandlers';
import { registerAutomationHandlers } from './handlers/automationHandlers';
import { registerSettingsHandlers } from './handlers/settingsHandlers';
import { registerSandboxHandlers } from './handlers/sandboxHandlers';
import { registerAudioHandlers } from './handlers/audioHandlers';
import { registerMiscHandlers } from './handlers/miscHandlers';
import { registerWikiHandlers } from './handlers/wikiHandlers';
import { registerAnalyticsHandlers } from './handlers/analyticsHandlers';
import { registerFileHandlers } from './handlers/fileHandlers';
import { registerKanbanHandlers } from './handlers/kanbanHandlers';
import { registerCouncilHandlers } from './handlers/councilHandlers';
import { FEATURES } from '../../shared/features';

export function registerIpcHandlers(): void {
  registerThreadHandlers();
  registerTerminalHandlers();
  registerMemoryHandlers();
  registerProjectHandlers();
  registerAutomationHandlers();
  registerSettingsHandlers();
  registerSandboxHandlers();
  registerAudioHandlers();
  registerMiscHandlers();
  registerWikiHandlers();
  registerAnalyticsHandlers();
  registerFileHandlers();
  if (FEATURES.KANBAN) registerKanbanHandlers();
  registerCouncilHandlers();
}
