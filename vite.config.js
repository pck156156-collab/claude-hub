import { defineConfig } from 'vite';
import { globSync } from 'node:fs';

// Every games/*/index.html and templates/*/index.html is its own page.
const pages = Object.fromEntries(
  globSync('{games,templates}/*/index.html').map((f) => [f.split('/').slice(0, 2).join('-'), f]),
);

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, rollupOptions: { input: pages } },
});
