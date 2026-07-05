// Electron-free whisper model helpers shared by the main-process audioService
// (for isModelReady) and the whisper utilityProcess engine (for load/download).
// Kept dependency-light so it can be bundled into the worker without dragging
// in electron.

import fs from 'fs';
import https from 'https';
import path from 'path';
import { IncomingMessage } from 'http';

export type VoiceModel = 'base.en' | 'small.en' | 'medium.en' | 'large-v3-turbo-q5_0';

export const ALLOWED_MODELS: ReadonlySet<VoiceModel> = new Set<VoiceModel>([
  'base.en',
  'small.en',
  'medium.en',
  'large-v3-turbo-q5_0',
]);

export const DEFAULT_MODEL: VoiceModel = 'base.en';

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// Redirect targets must stay on these hosts.
const ALLOWED_DOWNLOAD_HOSTS = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co']);

/** Coerce an arbitrary string to a known model, falling back to the default. */
export function resolveModel(model: string | undefined | null): VoiceModel {
  return model && ALLOWED_MODELS.has(model as VoiceModel) ? (model as VoiceModel) : DEFAULT_MODEL;
}

export function modelsDir(userDataPath: string): string {
  return path.join(userDataPath, 'whisper-models');
}

export function modelFilePath(userDataPath: string, model: string): string {
  const dir = path.resolve(modelsDir(userDataPath));
  const resolved = path.resolve(dir, `ggml-${model}.bin`);
  if (!resolved.startsWith(dir + path.sep)) throw new Error(`Invalid model name: ${model}`);
  return resolved;
}

function fetchWithRedirects(u: string, redirects = 0): Promise<IncomingMessage> {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return Promise.reject(new Error(`Invalid redirect URL: ${u}`));
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    return Promise.reject(new Error(`Redirect to untrusted host: ${parsed.hostname}`));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        // Resolve relative Location headers against the current URL before validating the hostname.
        const next = new URL(res.headers.location ?? '', u).href;
        fetchWithRedirects(next, redirects + 1).then(resolve, reject);
        return;
      }
      resolve(res);
    });
    req.setTimeout(60_000, () => req.destroy(new Error('Model download timed out')));
    req.on('error', reject);
  });
}

/** Download a whisper model to userData/whisper-models. onProgress fires with 0-100. */
export async function downloadModel(
  userDataPath: string,
  model: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const dir = modelsDir(userDataPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = modelFilePath(userDataPath, model);
  const tmp = `${dest}.tmp`;
  const url = `${MODEL_BASE_URL}/ggml-${model}.bin`;

  const res = await fetchWithRedirects(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Model download failed: HTTP ${res.statusCode}`);
  }

  const total = parseInt(res.headers['content-length'] ?? '0', 10);
  let received = 0;

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    res.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (total > 0) onProgress?.(Math.round((received / total) * 100));
    });
    res.on('error', (err) => file.destroy(err));
    file.on('error', async (err) => {
      await fs.promises.unlink(tmp).catch(() => {});
      reject(err);
    });
    file.on('close', () => resolve());
    res.pipe(file);
  });

  await fs.promises.rename(tmp, dest);
  onProgress?.(100);
}
