import fs from 'fs';
import path from 'path';
import type { WebClient } from '@slack/web-api';
import { getAllProjects, getSlackBinding, saveSlackBinding, getAllSlackBindings } from '../threads/db';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

function sanitizeChannelFolderSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'channel';
}

export type SlackBinding = {
  key: string;
  channelId: string;
  threadTs: string;
  threadId?: string;
  createdAt: number;
  lastInboundTs?: string; // kept for backwards compat with existing stored data
};

export class SlackWorkspaceManager {
  private webClient: WebClient | null = null;

  setWebClient(client: WebClient | null): void {
    this.webClient = client;
  }

  resolveOrCreateBinding(channelId: string, threadTs: string): SlackBinding {
    const key = `${channelId}:${threadTs}`;
    const existing = getSlackBinding(key);
    if (existing) return existing;

    const binding: SlackBinding = {
      key,
      channelId,
      threadTs,
      createdAt: Date.now(),
    };
    saveSlackBinding(binding);
    return binding;
  }

  updateBinding(key: string, patch: Record<string, unknown>): void {
    const existing = getSlackBinding(key);
    if (!existing) return;
    saveSlackBinding({ ...existing, ...patch } as SlackBinding);
  }

  bindingsForThread(
    threadId: string
  ): Array<{ key: string; threadId: string; channelId: string; threadTs: string; lastInboundTs?: string }> {
    return getAllSlackBindings()
      .filter((binding) => binding.threadId === threadId)
      .map((binding) => ({
        key: binding.key,
        threadId: binding.threadId as string,
        channelId: binding.channelId,
        threadTs: binding.threadTs,
        lastInboundTs: binding.lastInboundTs,
      }));
  }

  async resolveChannelWorkspace(
    channelId: string,
    map: Record<string, string>,
    fallback: string | null
  ): Promise<string | null> {
    const normalizedChannelId = channelId.trim().toUpperCase();
    const entry = (map[normalizedChannelId] ?? map[channelId.trim()] ?? '').trim();
    if (!entry) {
      return await this.ensureUnmappedChannelWorkspace(channelId, fallback);
    }
    const projects = getAllProjects();

    const prefixedId = entry.toLowerCase().startsWith('project:') ? entry.slice('project:'.length).trim() : '';
    if (prefixedId) {
      const project = projects.find((candidate) => candidate.id === prefixedId);
      return project?.path ?? (await this.ensureUnmappedChannelWorkspace(channelId, fallback));
    }

    const byId = projects.find((candidate) => candidate.id === entry);
    if (byId) return byId.path;

    const byName = projects.find((candidate) => candidate.name.toLowerCase() === entry.toLowerCase());
    if (byName) return byName.path;

    return entry || fallback;
  }

  async ensureUnmappedChannelWorkspace(channelId: string, fallbackRoot: string | null): Promise<string | null> {
    const root = fallbackRoot?.trim();
    if (!root) return null;

    const folderName = await this.buildChannelFolderName(channelId);
    const workspacePath = path.join(root, folderName);
    await fs.promises.mkdir(workspacePath, { recursive: true });
    return workspacePath;
  }

  async buildChannelFolderName(channelId: string): Promise<string> {
    const channelName = await this.resolveChannelName(channelId);
    return sanitizeChannelFolderSegment(channelName ?? channelId);
  }

  async resolveChannelName(channelId: string): Promise<string | null> {
    if (!this.webClient) return null;
    try {
      const response = await this.webClient.conversations.info({ channel: channelId });
      const rawName = response.channel?.name;
      return typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
    } catch (error) {
      const message = getErrorMessage(error);
      eventLogger.warn('slack', 'Failed to resolve Slack channel name for workspace folder', {
        channelId,
        error: message,
      });
      return null;
    }
  }
}
