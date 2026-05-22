import type { WebClient } from '@slack/web-api';

export class SlackThreadResolver {
  constructor(private readonly getWebClient: () => WebClient | null) {}

  async resolveRootThreadTs(channelId: string, messageTs: string, explicitThreadTs?: string): Promise<string> {
    if (explicitThreadTs && explicitThreadTs.trim()) return explicitThreadTs;
    const webClient = this.getWebClient();
    if (!webClient) return messageTs;
    try {
      const result = await webClient.conversations.history({
        channel: channelId,
        oldest: messageTs,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });
      const hit = result.messages?.find((item) => item.ts === messageTs);
      const maybeThreadTs = typeof hit?.thread_ts === 'string' ? hit.thread_ts : undefined;
      return maybeThreadTs?.trim() ? maybeThreadTs : messageTs;
    } catch {
      return messageTs;
    }
  }
}
