import { defineConfig } from 'vite';
import path from 'path';

// Whisper transcription utility-process bundle. Bundled separately from the main
// entry so it can be spawned via utilityProcess.fork() from a known path
// (path.join(__dirname, 'whisperWorker.js') in whisperWorkerClient.ts).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', '@fugood/whisper.node'],
      output: {
        entryFileNames: 'whisperWorker.js',
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
