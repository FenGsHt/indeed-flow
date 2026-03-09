const { defineConfig } = require('vite');

module.exports = defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
