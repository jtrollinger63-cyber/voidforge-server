// Bundles src/ (three.js included) into ONE self-contained index.html you can open directly or host anywhere.
import { build, context } from 'esbuild';
import fs from 'node:fs';

const template = fs.readFileSync('src/index.template.html', 'utf8');
const opts = { entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };

async function emit(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync('index.html', template.replace('/*__BUNDLE__*/', () => js));
  console.log(`index.html  ${(fs.statSync('index.html').size / 1024).toFixed(0)} KB  (${new Date().toLocaleTimeString()})`);
}

if (process.argv.includes('--watch')) {
  const ctx = await context({ ...opts, plugins: [{ name: 'emit', setup(b) { b.onEnd(emit); } }] });
  await ctx.watch();
  fs.watch('src/index.template.html', () => ctx.rebuild().catch(() => {}));
  console.log('watching src/ ...');
} else {
  await emit(await build(opts));
}
