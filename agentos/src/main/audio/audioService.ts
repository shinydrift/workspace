import { spawn, type ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import https from 'https';
import { IncomingMessage } from 'http';
import os from 'os';
import path from 'path';
import { initWhisper, type WhisperContext } from '@fugood/whisper.node';
import { IPC_EVENTS } from '../../shared/types/ipc';
import { getStore, settingsEvents } from '../store/index';
import { eventLogger } from '../utils/eventLog';
import type { AppSettings, VoiceFlowSettings } from '../../shared/types/settings';

const LOG = 'voice-flow';

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// Redirect targets must stay on these hosts.
const ALLOWED_DOWNLOAD_HOSTS = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co']);

type VoiceModel = NonNullable<VoiceFlowSettings['model']>;
// satisfies enforces no invalid entries; the exhaustiveness check below catches missing union members.
const ALLOWED_MODELS_LIST = [
  'base.en',
  'small.en',
  'medium.en',
  'large-v3-turbo-q5_0',
] as const satisfies readonly VoiceModel[];
// Compile error if VoiceFlowSettings.model gains a member not present in ALLOWED_MODELS_LIST.
void (true satisfies [VoiceModel] extends [(typeof ALLOWED_MODELS_LIST)[number]] ? true : never);
const ALLOWED_MODELS = new Set<VoiceModel>(ALLOWED_MODELS_LIST);

function getVoiceModel(): string {
  const model = getStore().get('settings').voiceFlow?.model ?? 'base.en';
  return ALLOWED_MODELS.has(model) ? model : 'base.en';
}

function modelsDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

function modelFilePath(model: string): string {
  const dir = path.resolve(modelsDir());
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

async function downloadModel(model: string, win: BrowserWindow | null): Promise<void> {
  const dir = modelsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = modelFilePath(model);
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
      if (total > 0) {
        const percent = Math.round((received / total) * 100);
        win?.webContents.send(IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS, { model, percent });
      }
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
  win?.webContents.send(IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS, { model, percent: 100 });
}

class AudioService {
  private ttsProcess: ChildProcess | null = null;
  private sttCtx: WhisperContext | null = null;
  private loadedModel: string | null = null;
  private ctxLoad: Promise<WhisperContext> | null = null;

  isModelReady(): boolean {
    const model = getVoiceModel();
    return fs.existsSync(modelFilePath(model));
  }

  private async _loadContext(win: BrowserWindow | null): Promise<WhisperContext> {
    const model = getVoiceModel();
    const filePath = modelFilePath(model);

    if (this.sttCtx && this.loadedModel !== model) {
      eventLogger.info(LOG, 'Model changed, releasing previous context', {
        was: this.loadedModel,
        now: model,
      });
      this.sttCtx.release();
      this.sttCtx = null;
      this.loadedModel = null;
    }

    if (this.sttCtx) return this.sttCtx;

    const exists = fs.existsSync(filePath);
    eventLogger.info(LOG, 'Ensuring Whisper context', { model, filePath, modelOnDisk: exists });
    if (!exists) {
      eventLogger.info(LOG, 'Downloading Whisper model', { model });
      await downloadModel(model, win);
      eventLogger.info(LOG, 'Whisper model download finished', { model });
    }

    eventLogger.info(LOG, 'Loading Whisper context', { filePath });
    try {
      this.sttCtx = await initWhisper({ filePath, useGpu: true });
    } catch (gpuErr) {
      eventLogger.warn(LOG, 'Whisper GPU init failed, retrying CPU', { error: String(gpuErr) });
      this.sttCtx = await initWhisper({ filePath, useGpu: false });
    }
    this.loadedModel = model;
    eventLogger.info(LOG, 'Whisper context ready', { model });
    return this.sttCtx;
  }

  private ensureContext(win: BrowserWindow | null): Promise<WhisperContext> {
    if (this.sttCtx && this.loadedModel === getVoiceModel()) return Promise.resolve(this.sttCtx);
    if (!this.ctxLoad) {
      this.ctxLoad = this._loadContext(win).finally(() => {
        this.ctxLoad = null;
      });
    }
    return this.ctxLoad;
  }

  /** Called from settingsEvents when model changes so the next call re-loads. */
  invalidateContext(): void {
    this.sttCtx?.release();
    this.sttCtx = null;
    this.loadedModel = null;
    this.ctxLoad = null;
  }

  /** Transcribe an audio file from disk (e.g. a Slack voice memo). Converts to WAV via afconvert if needed. */
  async transcribeFromFile(filePath: string): Promise<string> {
    const ctx = await this.ensureContext(null);
    let tmpDir: string | null = null;
    let wavPath = filePath;
    if (process.platform === 'darwin' && path.extname(filePath).toLowerCase() !== '.wav') {
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-slack-audio-'));
        const tmpWav = path.join(tmpDir, 'input.wav');
        // afconvert is macOS built-in (Core Audio) — produces 16-bit LE PCM at 16 kHz mono for Whisper.
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '--', filePath, tmpWav], {
            stdio: 'ignore',
          });
          proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`afconvert exit ${code}`))));
          proc.on('error', reject);
        });
        wavPath = tmpWav;
      } catch (err) {
        eventLogger.warn(LOG, 'afconvert failed, passing original to whisper', {
          file: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        if (tmpDir) {
          await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          tmpDir = null;
        }
      }
    }
    try {
      const { promise } = ctx.transcribeFile(wavPath, { language: 'auto', onNewSegments: () => {} });
      const result = await promise;
      return (result.result ?? '').trim();
    } finally {
      if (tmpDir) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async transcribe(audioBuffer: Buffer, win: BrowserWindow | null): Promise<string> {
    const ctx = await this.ensureContext(win);
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-audio-'));
    try {
      const tmpWav = path.join(tmpDir, 'input.wav');
      await fs.promises.writeFile(tmpWav, audioBuffer);
      const { promise } = ctx.transcribeFile(tmpWav, {
        language: 'auto',
        onNewSegments: (result) => {
          // Use result.result (full accumulated text) rather than joining new
          // segments to avoid double-spacing from the STT engine's leading-space convention.
          const text = result.result.trim();
          if (text) {
            win?.webContents.send(IPC_EVENTS.VOICE_FLOW_TRANSCRIPT_SEGMENT, { text });
          }
        },
      });
      const result = await promise;
      return (result.result ?? '').trim();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Speak text aloud using macOS built-in `say` command.
   * No-op on non-macOS platforms.
   */
  playTTS(text: string): void {
    if (process.platform !== 'darwin') return;
    this.stopTTS();
    // Pass '--' so leading hyphens in text are not interpreted as flags by say(1).
    const proc = spawn('say', ['--', text], { stdio: 'ignore' });
    this.ttsProcess = proc;
    const clear = () => {
      if (this.ttsProcess === proc) this.ttsProcess = null;
    };
    proc.on('exit', clear);
    proc.on('error', (err) => {
      eventLogger.warn(LOG, 'say process error', { error: err.message });
      clear();
    });
  }

  stopTTS(): void {
    if (this.ttsProcess) {
      this.ttsProcess.kill('SIGTERM');
      this.ttsProcess = null;
    }
  }
}

export const audioService = new AudioService();

// Invalidate the STT context only when the configured model actually changes.
let lastModel = getStore().get('settings').voiceFlow?.model;
settingsEvents.on('change', (s: AppSettings) => {
  const next = s.voiceFlow?.model;
  if (next !== lastModel) {
    lastModel = next;
    audioService.invalidateContext();
  }
});
