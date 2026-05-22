export const SLACK_IPC_CHANNELS = {
  SLACK_LIST_CHANNELS: 'slack:listChannels',
} as const;

export interface SlackChannelOption {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}
