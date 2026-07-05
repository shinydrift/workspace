// Electron-free whisper engine. Owns the native WhisperContext and runs
// transcription. Lives inside the whisper utilityProcess so all heavy STT work
// stays off the main process's libuv thread pool. Emits progress/segment/log
// through injected callbacks so the worker can forward them to the renderer.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initWhisper, type WhisperContext } from '@fugood/whisper.node';
import { downloadModel, modelFilePath, resolveModel } from '../whisperModels';

export interface WhisperEngineHooks {
  onDownloadProgress: (model: string, percent: number) => void;
  onSegment: (text: string) => void;
  onLog: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export class WhisperEngine {
  private ctx: WhisperContext | null = null;
  private loadedModel: string | null = null;

  constructor(
    private readonly userDataPath: string,
    private readonly hooks: WhisperEngineHooks
  ) {}

  private async ensureContext(rawModel: string): Promise<WhisperContext> {
    const model = resolveModel(rawModel);

    if (this.ctx && this.loadedModel !== model) {
      this.hooks.onLog('info', 'Model changed, releasing previous context', { was: this.loadedModel, now: model });
      this.ctx.release();
      this.ctx = null;
      this.loadedModel = null;
    }
    if (this.ctx) return this.ctx;

    const filePath = modelFilePath(this.userDataPath, model);
    const exists = fs.existsSync(filePath);
    this.hooks.onLog('info', 'Ensuring Whisper context', { model, filePath, modelOnDisk: exists });
    if (!exists) {
      this.hooks.onLog('info', 'Downloading Whisper model', { model });
      await downloadModel(this.userDataPath, model, (percent) => this.hooks.onDownloadProgress(model, percent));
      this.hooks.onLog('info', 'Whisper model download finished', { model });
    }

    this.hooks.onLog('info', 'Loading Whisper context', { filePath });
    try {
      this.ctx = await initWhisper({ filePath, useGpu: true });
    } catch (gpuErr) {
      this.hooks.onLog('warn', 'Whisper GPU init failed, retrying CPU', { error: String(gpuErr) });
      this.ctx = await initWhisper({ filePath, useGpu: false });
    }
    this.loadedModel = model;
    this.hooks.onLog('info', 'Whisper context ready', { model });
    return this.ctx;
  }

  /** Transcribe raw audio bytes (a WAV buffer produced by the renderer). */
  async transcribeBuffer(audio: Buffer, model: string): Promise<string> {
    const ctx = await this.ensureContext(model);
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-audio-'));
    try {
      const tmpWav = path.join(tmpDir, 'input.wav');
      await fs.promises.writeFile(tmpWav, audio);
      const { promise } = ctx.transcribeFile(tmpWav, {
        language: 'auto',
        onNewSegments: (result) => {
          // Use result.result (full accumulated text) rather than joining new
          // segments to avoid double-spacing from the STT engine's leading-space convention.
          const text = result.result.trim();
          if (text) this.hooks.onSegment(text);
        },
      });
      const result = await promise;
      return (result.result ?? '').trim();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Transcribe an audio file from disk (e.g. a Slack voice memo). Converts to WAV via afconvert if needed. */
  async transcribeFromFile(filePath: string, model: string): Promise<string> {
    const ctx = await this.ensureContext(model);
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
        this.hooks.onLog('warn', 'afconvert failed, passing original to whisper', {
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
      if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  release(): void {
    this.ctx?.release();
    this.ctx = null;
    this.loadedModel = null;
  }
}
