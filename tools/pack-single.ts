/**
 * Turns dist-single/index.html (JS + CSS already inlined by vite-plugin-singlefile) into the final self-contained
 * release/hillfront.html by embedding the optimised models as base64 data URLs.
 *
 * Usage: tsx tools/pack-single.ts [--server wss://your-host.example/ws]
 *   --server   bakes the game-server address into the page (window.HILLFRONT_SERVER); the in-game field can still override it
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const server = arg('--server');
const src = 'dist-single/index.html';
if (!existsSync(src)) { console.error(`missing ${src}: run "npm run build:single" first`); process.exit(2); }
let html = readFileSync(src, 'utf8');

const files = ['soldier.glb', 'kit.glb', 'weapons3p.glb'];
const assets: Record<string, string> = {};
let rawBytes = 0;
for (const f of files) {
  const buf = readFileSync(`public/assets/${f}`); rawBytes += buf.length;
  assets[f] = `data:model/gltf-binary;base64,${buf.toString('base64')}`;
}
const inject = `<script>window.__HF_ASSETS__=${JSON.stringify(assets)};${server ? `window.HILLFRONT_SERVER=${JSON.stringify(server)};` : ''}</script>`;
// classic inline script in <head> runs before the (deferred) module script
html = html.includes('<head>') ? html.replace('<head>', `<head>${inject}`) : inject + html;
mkdirSync('release', { recursive: true });
writeFileSync('release/hillfront.html', html);
console.log(`wrote release/hillfront.html  (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB; models: ${(rawBytes / 1024).toFixed(0)} KB raw -> ${(JSON.stringify(assets).length / 1024).toFixed(0)} KB as base64)${server ? '  server=' + server : ''}`);
