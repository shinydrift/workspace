import fs from 'fs';
import path from 'path';
import type { WebClient } from '@slack/web-api';
import { getAllProjects, getSlackBinding, saveSlackBinding, getAllSlackBindings } from '../threads/db';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type { Medium, SlackThreadBinding } from '../../shared/types';

function sanitizeChannelFolderSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'channel';
}

export type SlackBinding = SlackThreadBinding;

export class SlackWorkspaceManager {
  private webClient: WebClient | null = null;

  setWebClient(client: WebClient | null): void {
    this.webClient = client;
  }

  /**
   * Resolve (or create) a binding. Omit `threadTs` for a channel-scoped binding whose echoes post
   * as new top-level messages (e.g. automation summaries with no thread to reply to).
   */
  resolveOrCreateBinding(channelId: string, threadTs?: string, medium: Medium = 'slack'): SlackBinding {
    const key = `${medium}:${channelId}:${threadTs ?? ''}`;
    const existing = getSlackBinding(key);
    if (existing) return existing;

    const binding: SlackBinding = {
      key,
      medium,
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

  bindingsForThread(threadId: string): Array<{
    key: string;
    medium: Medium;
    threadId: string;
    channelId: string;
    threadTs?: string;
    lastInboundTs?: string;
  }> {
    return getAllSlackBindings()
      .filter((binding) => binding.threadId === threadId)
      .map((binding) => ({
        key: binding.key,
        medium: binding.medium,
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

    const target = entry || fallback;
    if (!target) return null;
    if (!path.isAbsolute(target)) {
      // The mapping value matched no known project and isn't an absolute path (stale id,
      // typo, etc.). Degrade to the per-channel folder under the default root rather than
      // creating a junk directory relative to the process working directory.
      return await this.ensureUnmappedChannelWorkspace(channelId, fallback);
    }
    return (await this.ensureWorkspaceDir(target, channelId)) ? target : null;
  }

  async ensureUnmappedChannelWorkspace(channelId: string, fallbackRoot: string | null): Promise<string | null> {
    const root = fallbackRoot?.trim();
    if (!root) return null;

    const folderName = await this.buildChannelFolderName(channelId);
    const workspacePath = path.join(root, folderName);
    return (await this.ensureWorkspaceDir(workspacePath, channelId)) ? workspacePath : null;
  }

  // Creates the workspace directory, returning false (not throwing) on failure so callers
  // resolve to null and the inbound flow surfaces it instead of leaving the message stuck.
  private async ensureWorkspaceDir(workspacePath: string, channelId: string): Promise<boolean> {
    try {
      await fs.promises.mkdir(workspacePath, { recursive: true });
      return true;
    } catch (error) {
      eventLogger.warn('slack', 'Failed to create Slack channel workspace directory', {
        channelId,
        workspacePath,
        error: getErrorMessage(error),
      });
      return false;
    }
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
