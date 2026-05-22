import fs from 'fs/promises';
import path from 'path';
import { nativeImage } from 'electron';
import type { WebClient } from '@slack/web-api';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { eventLogger } from '../utils/eventLog';

// Keep in sync with MAX_DIMENSION / MAX_BYTES in src/renderer/hooks/useAttachedFiles.ts
const MAX_DIMENSION = 1568;
const MAX_BYTES = 5 * 1024 * 1024;

function resizeImageBuffer(buffer: Buffer, mimetype: string): { buffer: Buffer; mimetype: string } {
  if (!mimetype.startsWith('image/')) return { buffer, mimetype };
  try {
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return { buffer, mimetype };
    const { width, height } = img.getSize();
    if (width === 0 || height === 0) return { buffer, mimetype };
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && buffer.length <= MAX_BYTES) return { buffer, mimetype };

    const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height, 1);
    const resized = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });

    if (mimetype === 'image/png') {
      const png = resized.toPNG();
      if (png.length <= MAX_BYTES) return { buffer: png, mimetype: 'image/png' };
    }
    for (const q of [85, 60]) {
      const jpg = resized.toJPEG(q);
      if (jpg.length <= MAX_BYTES) return { buffer: jpg, mimetype: 'image/jpeg' };
    }
    return { buffer: resized.toJPEG(60), mimetype: 'image/jpeg' };
  } catch {
    return { buffer, mimetype };
  }
}

export type SlackFile = {
  id?: string;
  name?: string;
  url_private?: string;
  mimetype?: string;
};

export class SlackFileService {
  constructor(private readonly getWebClient: () => WebClient | null) {}

  async downloadFiles(
    files: SlackFile[],
    workspacePath: string,
    botToken: string | undefined
  ): Promise<{ paths: string[]; errors: string[] }> {
    if (!botToken || files.length === 0) return { paths: [], errors: [] };

    const uploadsDir = path.join(workspacePath, '.agentos', 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const results = await Promise.allSettled(
      files
        .filter((file) => file.id || (file.url_private && file.name))
        .map(async (file) => {
          let url = file.url_private;
          let name = file.name;
          const webClient = this.getWebClient();
          if ((!url || !name) && file.id && webClient) {
            const info = await webClient.files.info({ file: file.id });
            url = (info.file as { url_private?: string } | undefined)?.url_private ?? url;
            name = (info.file as { name?: string } | undefined)?.name ?? name;
          }
          if (!url || !name) throw new Error(`No download URL for file ${file.id ?? 'unknown'}`);
          const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.startsWith('text/html')) {
            throw new Error(`Slack returned HTML instead of file data — bot may be missing the files:read OAuth scope`);
          }
          const rawBuffer = Buffer.from(await res.arrayBuffer());
          const contentMime = contentType.split(';')[0].trim();
          const { buffer, mimetype: finalMime } = resizeImageBuffer(rawBuffer, contentMime);
          let safeName = path.basename(name);
          if (finalMime === 'image/jpeg' && contentMime === 'image/png') {
            safeName = safeName.replace(/\.png$/i, '.jpg');
          }
          await fs.writeFile(path.join(uploadsDir, safeName), buffer);
          return path.join('.agentos', 'uploads', safeName);
        })
    );

    const uploadedPaths: string[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        uploadedPaths.push(result.value);
      } else {
        const message = getErrorMessage(result.reason);
        eventLogger.warn('slack', 'Failed to download Slack file', { error: message });
        errors.push(message);
      }
    }
    return { paths: uploadedPaths, errors };
  }
}
