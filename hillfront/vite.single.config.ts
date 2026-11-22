import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Release build: ONE self-contained HTML (JS + CSS inlined). The GLB models are injected afterwards by
 * tools/pack-single.ts as base64 data URLs (see src/assets/loader.ts -> window.__HF_ASSETS__), then tools/check-size.ts gates the size.
 */
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  publicDir: false,                       // models are embedded by pack-single, not copied
  build: {
    outDir: 'dist-single', emptyOutDir: true, target: 'es2022', minify: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000, reportCompressedSize: false,
  },
});
