import { defineConfig } from 'vite';

// Dev / normal build. The single-file release build lives in vite.single.config.ts (added in the packaging phase).
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
