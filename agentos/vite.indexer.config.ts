import { defineConfig } from 'vite';
import path from 'path';

// Memory utility-process bundle. Bundled separately from the main entry so
// the indexer can be spawned via utilityProcess.fork() from a known path
// (path.join(__dirname, 'indexer.js') in workerClient.ts).
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'node-pty',
        'better-sqlite3',
        'sqlite-vec',
        'node-llama-cpp',
        'uiohook-napi',
        '@fugood/whisper.node',
      ],
      output: {
        entryFileNames: 'indexer.js',
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
