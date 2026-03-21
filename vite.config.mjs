import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        games: resolve(__dirname, 'games.html'),
        aitest: resolve(__dirname, 'ai-test.html'),
      },
    },
  },
  json: {
    namedExports: true
  }
});