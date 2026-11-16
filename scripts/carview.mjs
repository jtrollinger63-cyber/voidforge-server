// Renders each car from several angles into PNGs: node scripts/carview.mjs <outDir> [carId...]
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(id); break; } catch {} }
const out = process.argv[2] || 'carview-out'; fs.mkdirSync(out, { recursive: true });
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['aurelia', 'brawler', 'vantara', 'ridgeback', 'kestrel', 'helion'];
const js = (await build({ entryPoints: ['src/dev/carview.js'], bundle: true, write: false, format: 'iife', minify: false, logLevel: 'error' })).outputFiles[0].text;
const html = `<body style="margin:0"><canvas id="c" width="1000" height="560"></canvas><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body>`;
const file = path.resolve(out, 'carview.html'); fs.writeFileSync(file, html);
const b = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('console', (m) => { if (m.type() !== 'log') console.log(m.type(), m.text()); }); p.on('pageerror', (e) => console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await p.goto('file://' + file);
const views = { front34: [35, 14, 8.2, 0.55], side: [90, 4, 9.5, 0.6], rear34: [215, 14, 8.2, 0.6] };
for (const id of ids) for (const [name, view] of Object.entries(views)) {
  const info = await p.evaluate(([id, view]) => window.showCar(id, view), [id, view]);
  await p.screenshot({ path: path.join(out, `${id}_${name}.png`) });
  if (name === 'front34') console.log(id, info);
}
await b.close();
