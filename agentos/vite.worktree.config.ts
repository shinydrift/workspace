import { defineConfig } from 'vite';
import path from 'path';

// Worktree git/docker utility-process bundle. Bundled separately from the main
// entry so it can be spawned via utilityProcess.fork() from a known path
// (path.join(__dirname, 'worktreeWorker.js') in worktreeWorkerClient.ts).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'worktreeWorker.js',
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
