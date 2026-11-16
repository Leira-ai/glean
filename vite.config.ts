import { defineConfig } from 'vite';

export default defineConfig({
  base: '/glean/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
});
