import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/content_script.ts'],
  outDir: 'dist',
  format: ['iife'],
  noExternal: [/.*/],
  clean: true,
  minify: true,
});
