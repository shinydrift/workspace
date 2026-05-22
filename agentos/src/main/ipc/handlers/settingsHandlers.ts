import { ipcMain } from 'electron';
import { IPC_CHANNELS, type AppSettings } from '../../../shared/types';
import { getStore, setSettings } from '../../store/index';
import { AppSettingsPatchSchema } from '../../store/settingsSchema';
import { handleIpc } from '../ipcResponse';
import { eventLogger } from '../../utils/eventLog';
import { broadcastSettingsChanged } from '../../sessions/broadcaster';

export function registerSettingsHandlers(): void {
  // Intentionally returns full settings including credential fields — the renderer
  // settings UI needs them for display and editing by the user.
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => handleIpc(() => getStore().get('settings')));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (e, raw) =>
    handleIpc(() => {
      // zod 4 infers `.nullable()` fields as optional in the parsed output,
      // which doesn't structurally match required-nullable fields on
      // AppSettings (e.g. SlackSettings.botToken: string | null). The runtime
      // shape is validated by zod; key-set parity vs AppSettings is enforced
      // by `_parity` in settingsSchema.ts. Cast at the boundary.
      const patch = AppSettingsPatchSchema.parse(raw) as Partial<AppSettings>;
      const result = setSettings(patch);
      eventLogger.info('settings', 'Settings updated', { keys: Object.keys(patch) });
      broadcastSettingsChanged(result, e.sender);
      return result;
    })
  );
}
