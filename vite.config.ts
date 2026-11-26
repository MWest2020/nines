import { defineConfig } from 'vitest/config';
import { ninesContent } from './tools/vite-plugin-content';

// base './' keeps every URL relative, so the same dist/ works from a sub-path (GitHub Pages)
// and from the Capacitor WebView. Content is bundled at build time by the plugin; nothing
// is fetched from outside the origin at runtime.
export default defineConfig({
  base: './',
  plugins: [ninesContent()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // No preload polyfill: it fetches module URLs at runtime, and modern browsers do not need it.
    modulePreload: { polyfill: false },
    // Phaser alone is about 1.2 MB minified; it is split into its own chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 2,
  },
});
