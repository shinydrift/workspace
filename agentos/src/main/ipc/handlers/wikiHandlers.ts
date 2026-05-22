import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type { WikiPage } from '../../../shared/types';
import { filePath, shortId } from './schemas';
import { handleIpc } from '../ipcResponse';

const ProjectPathSchema = z.object({ projectPath: filePath });
const PageRefSchema = z.object({ projectPath: filePath, pageId: shortId });

const WikiPageSchema = z.object({
  id: shortId,
  title: z.string().min(1).max(512),
  content: z.string().max(1_000_000),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

const WikiSaveSchema = z.object({
  projectPath: filePath,
  page: WikiPageSchema,
});

function wikiDir(projectPath: string): string {
  return path.join(projectPath, 'wiki');
}

function pageFilePath(projectPath: string, pageId: string): string {
  return path.join(wikiDir(projectPath), `${pageId}.md`);
}

function serialize(page: WikiPage): string {
  return `---\nid: ${page.id}\ntitle: ${page.title}\ncreatedAt: ${page.createdAt}\nupdatedAt: ${page.updatedAt}\n---\n\n${page.content}`;
}

function parse(raw: string, fallback?: { id: string; mtimeMs: number }): WikiPage | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (match) {
    const [, frontmatter, content] = match;
    const fields: Record<string, string> = {};
    for (const line of frontmatter.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const id = fields['id'];
    const title = fields['title'];
    const createdAt = Number(fields['createdAt']);
    const updatedAt = Number(fields['updatedAt']);
    if (!id || !title || !createdAt || !updatedAt) return null;
    return { id, title, content, createdAt, updatedAt };
  }

  // Plain markdown without frontmatter — derive metadata from file info
  if (!fallback) return null;
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : fallback.id;
  const ts = Math.round(fallback.mtimeMs);
  return { id: fallback.id, title, content: raw, createdAt: ts, updatedAt: ts };
}

export function registerWikiHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WIKI_LIST, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath } = ProjectPathSchema.parse(raw);
      const dir = wikiDir(projectPath);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return [] as WikiPage[];
      }
      const pages: WikiPage[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const fullPath = path.join(dir, entry);
          const [text, stat] = await Promise.all([fs.readFile(fullPath, 'utf8'), fs.stat(fullPath)]);
          const id = entry.slice(0, -3); // strip .md
          const page = parse(text, { id, mtimeMs: stat.mtimeMs });
          if (page) pages.push(page);
        } catch {
          // skip unreadable files
        }
      }
      return pages.sort((a, b) => b.updatedAt - a.updatedAt);
    })
  );

  ipcMain.handle(IPC_CHANNELS.WIKI_GET, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath, pageId } = PageRefSchema.parse(raw);
      try {
        const fullPath = pageFilePath(projectPath, pageId);
        const [text, stat] = await Promise.all([fs.readFile(fullPath, 'utf8'), fs.stat(fullPath)]);
        return parse(text, { id: pageId, mtimeMs: stat.mtimeMs });
      } catch {
        return null;
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.WIKI_SAVE, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath, page } = WikiSaveSchema.parse(raw);
      const saved: WikiPage = { ...page, updatedAt: Date.now() };
      await fs.mkdir(wikiDir(projectPath), { recursive: true });
      await fs.writeFile(pageFilePath(projectPath, saved.id), serialize(saved), 'utf8');
      return saved;
    })
  );

  ipcMain.handle(IPC_CHANNELS.WIKI_DELETE, (_e, raw) =>
    handleIpc(async () => {
      const { projectPath, pageId } = PageRefSchema.parse(raw);
      await fs.unlink(pageFilePath(projectPath, pageId));
    })
  );
}
