import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { audioService } from '../../audio/audioService';
import { handleIpc } from '../ipcResponse';
import { eventLogger } from '../../utils/eventLog';

const LOG = 'voice-flow';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB

const PlayTTSSchema = z.object({
  // Reject NUL bytes in addition to length limits — NUL can confuse say(1) argument parsing.
  text: z
    .string()
    .min(1)
    .max(10_000)
    .refine((s) => !s.includes('\x00'), 'text must not contain NUL bytes'),
});

export function registerAudioHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUDIO_MODEL_READY, () => handleIpc(() => ({ ready: audioService.isModelReady() })));

  ipcMain.handle(IPC_CHANNELS.AUDIO_TRANSCRIBE, (_e, audioBuffer: unknown) =>
    handleIpc(async () => {
      if (!(audioBuffer instanceof ArrayBuffer)) throw new Error('audio buffer: expected ArrayBuffer');
      if (audioBuffer.byteLength === 0 || audioBuffer.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(`audio buffer: invalid size ${audioBuffer.byteLength}`);
      }
      eventLogger.info(LOG, 'Transcribe request received', { bytes: audioBuffer.byteLength });
      const started = Date.now();
      try {
        const text = await audioService.transcribe(audioBuffer);
        eventLogger.info(LOG, 'Transcribe complete', {
          ms: Date.now() - started,
          chars: text.length,
        });
        return { text };
      } catch (err) {
        eventLogger.error(LOG, 'Transcribe failed', { error: (err as Error).message });
        throw err;
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUDIO_PLAY_TTS, (_e, raw) =>
    handleIpc(() => {
      const { text } = PlayTTSSchema.parse(raw);
      audioService.playTTS(text);
    })
  );

  ipcMain.handle(IPC_CHANNELS.AUDIO_STOP_TTS, () =>
    handleIpc(() => {
      audioService.stopTTS();
    })
  );
}
