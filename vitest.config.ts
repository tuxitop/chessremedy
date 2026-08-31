import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`.replace(/\\/g, '/'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.opencode'],
    css: false,
    reporters: ['default'],
    server: {
      // `@lichess-org/pgn-viewer` ships ESM with a `exports` map that
      // Vitest's module resolution cannot traverse. Force Vite to
      // transform it on the fly rather than passing through.
      deps: {
        inline: ['@lichess-org/pgn-viewer'],
      },
    },
  },
});
