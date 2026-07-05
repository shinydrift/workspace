import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import { getStore } from '../store/index';
import { eventLogger } from '../utils/eventLog';
import { whisperWorkerClient } from './whisperWorkerClient';
import { modelFilePath, resolveModel } from './whisperModels';

const LOG = 'voice-flow';

function getVoiceModel(): string {
  return resolveModel(getStore().get('settings').voiceFlow?.model);
}

class AudioService {
  private ttsProcess: ChildProcess | null = null;
  private configured = false;

  private ensureConfigured(): void {
    if (this.configured) return;
    whisperWorkerClient.configure(app.getPath('userData'));
    this.configured = true;
  }

  isModelReady(): boolean {
    return fs.existsSync(modelFilePath(app.getPath('userData'), getVoiceModel()));
  }

  /**
   * Transcribe a WAV buffer from the renderer. Runs in the whisper
   * utilityProcess so STT never blocks the Electron main loop.
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<string> {
    this.ensureConfigured();
    return whisperWorkerClient.transcribeBuffer(audioBuffer, getVoiceModel());
  }

  /** Transcribe an audio file from disk (e.g. a Slack voice memo). */
  async transcribeFromFile(filePath: string): Promise<string> {
    this.ensureConfigured();
    return whisperWorkerClient.transcribeFromFile(filePath, getVoiceModel());
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
