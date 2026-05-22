import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@hooks': path.resolve(__dirname, 'src/renderer/hooks'),
      '@store': path.resolve(__dirname, 'src/renderer/store'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/renderer/**/*.test.{ts,tsx}', 'tests/renderer/**/*.vitest.{ts,tsx}'],
    setupFiles: ['tests/renderer/setup.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/renderer/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', 'src/renderer/index.tsx'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage-renderer',
      thresholds: {
        statements: 16,
        branches: 16,
        functions: 9,
        lines: 15,
      },
    },
  },
});
