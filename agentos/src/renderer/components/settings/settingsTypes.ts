import type { Icon } from '@phosphor-icons/react';

export type Tab =
  | 'appearance'
  | 'recording'
  | 'keys'
  | 'agents'
  | 'autopilot'
  | 'slack'
  | 'sandbox'
  | 'memory'
  | 'code'
  | 'containers'
  | 'health'
  | 'env'
  | 'logs'
  | 'council'
  | 'about';

export interface TabDef {
  id: Tab;
  label: string;
  Icon: Icon;
}

export interface SettingsSection {
  label: string;
  tabs: TabDef[];
}
