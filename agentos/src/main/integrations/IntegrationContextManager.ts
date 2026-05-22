export class IntegrationContextManager {
  private slackContexts = new Map<string, { channelId: string; threadTs: string | null }>();

  setSlackContext(threadId: string, ctx: { channelId: string; threadTs: string | null }): void {
    this.slackContexts.set(threadId, ctx);
  }

  getSlackContext(threadId: string): { channelId: string; threadTs: string | null } | undefined {
    return this.slackContexts.get(threadId);
  }

  clearSlackContext(threadId: string): void {
    this.slackContexts.delete(threadId);
  }

  clearAll(threadId: string): void {
    this.slackContexts.delete(threadId);
  }
}

export const integrationContextManager = new IntegrationContextManager();
