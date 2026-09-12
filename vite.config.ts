import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages *project* sites are served from a sub-path. The deploy workflow
// sets `BASE_PATH` (e.g. `/chessremedy/`); local dev, preview and tests keep the
// default `/`. Everything else (router basename, engine worker URLs, PWA scope)
// derives from `import.meta.env.BASE_URL`, so no other code needs the path.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ChessRemedy',
        short_name: 'ChessRemedy',
        description:
          'Local-first chess training. Analyze your games and convert mistakes into personalized puzzles.',
        theme_color: '#1f6feb',
        background_color: '#0d1117',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,wasm}'],
        // Serve the SPA shell for offline navigations to any in-app route.
        navigateFallback: 'index.html',
        // Precache only the default single-threaded engine build for offline
        // analysis (ADR-012/D5). The multi-threaded `lite` build needs
        // cross-origin isolation headers that a service-worker cache response
        // does not carry, so it is left to the browser HTTP cache.
        globIgnores: ['**/stockfish/stockfish-*-lite.js', '**/stockfish/stockfish-*-lite.wasm'],
        // The engine WASM (~7 MB) exceeds workbox's 2 MiB default ceiling.
        maximumFileSizeToCacheInBytes: 9_000_000,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`.replace(/\\/g, '/'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
