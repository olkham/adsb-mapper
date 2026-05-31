import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5188,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
