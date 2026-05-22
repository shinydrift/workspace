import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Never bundle native modules or electron itself
      external: ['electron', 'node-pty', 'better-sqlite3', 'sqlite-vec', 'node-llama-cpp', 'uiohook-napi', '@fugood/whisper.node'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
