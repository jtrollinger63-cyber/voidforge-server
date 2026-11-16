// Renders world screenshots: node scripts/worldview.mjs <outDir> <trackId> <carId> <quality> [frac:speed:lat:mode ...]
import fs from 'node:fs'; import path from 'node:path'; import { build } from 'esbuild'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(id); break; } catch {} }
const [out, trackId = 'circuit', carId = 'vantara', quality = 'high', ...views] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const js = (await build({ entryPoints: ['src/dev/worldview.js'], bundle: true, write: false, format: 'iife', logLevel: 'error' })).outputFiles[0].text;
const file = path.resolve(out, 'worldview.html'); fs.writeFileSync(file, `<body style="margin:0;background:#000"><canvas id="c" width="1280" height="720"></canvas><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body>`);
const b = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => { if (m.type() !== 'log') console.log(m.type(), m.text().slice(0, 300)); }); p.on('pageerror', (e) => console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')));
await p.goto('file://' + file);
console.log(trackId, await p.evaluate(([t, c, q]) => window.load(t, c, q), [trackId, carId, quality]));
let n = 0;
for (const v of (views.length ? views : ['0.05:45:0:0'])) {
  const [f, s, l, m] = v.split(':').map(Number);
  console.log(v, await p.evaluate(([f, s, l, m]) => window.place(f, s, l, m), [f, s, l || 0, m || 0]));
  await p.waitForTimeout(400); await p.evaluate(() => window.shot());
  await p.screenshot({ path: path.join(out, `${trackId}_${n++}.png`) });
}
console.log(await p.evaluate(() => window.stats()));
await b.close();
