/**
 * Release size gate. FAILS (exit 1) when the final self-contained HTML exceeds the budget.
 * Usage: tsx tools/check-size.ts [--file release/hillfront.html] [--max-mb 12]
 * Measures real bytes of the final file, then breaks them down by category. Also writes docs/SIZE_REPORT.md.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d; };
const file = arg('--file', 'release/hillfront.html');
const maxMb = Number(arg('--max-mb', '12'));
if (!existsSync(file)) { console.error(`FAIL: ${file} does not exist (run npm run build:single)`); process.exit(2); }
const html = readFileSync(file, 'utf8');
const total = Buffer.byteLength(html);

// categories, measured from the final file
const take = (re: RegExp) => { let n = 0; for (const m of html.matchAll(re)) n += Buffer.byteLength(m[0]); return n; };
const assetsScript = take(/<script>window\.__HF_ASSETS__=[\s\S]*?<\/script>/g);
const assetsPayload = [...html.matchAll(/data:model\/gltf-binary;base64,[A-Za-z0-9+/=]+/g)].map((m) => ({ bytes: Buffer.byteLength(m[0]) }));
const moduleJs = take(/<script type="module"[^>]*>[\s\S]*?<\/script>/g) + take(/<script(?![^>]*src)(?![^>]*__HF_ASSETS__)(?![^>]*type="module")[^>]*>(?!window\.__HF_ASSETS__)[\s\S]*?<\/script>/g) - 0;
const css = take(/<style[^>]*>[\s\S]*?<\/style>/g);
const other = total - assetsScript - moduleJs - css;
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;

const rows: [string, number][] = [
  ['Game code (three.js + game + UI, minified JS)', moduleJs],
  ['3D models (soldier, map kit, weapons) as base64', assetsScript],
  ['CSS', css],
  ['HTML shell / other', other],
];
const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + ' MB';
const kb = (n: number) => (n / 1024).toFixed(0) + ' KB';
const lines: string[] = [];
lines.push(`# Release size report`, '', `File: \`${file}\`  ·  generated ${new Date().toISOString()}`, '', `**Total: ${total.toLocaleString()} bytes (${mb(total)})** against a budget of ${maxMb} MB (${(maxMb * 1024 * 1024).toLocaleString()} bytes): ${total <= maxMb * 1024 * 1024 ? 'PASS' : 'FAIL'}`, '',
  `Gzip-compressed transfer size (if served with compression): ${mb(gz)}. Embedding in Google Sites counts the *uncompressed* HTML, so the gate uses the first number.`, '', '| Category | Bytes | Size | Share |', '|---|---:|---:|---:|');
for (const [n, b] of rows) lines.push(`| ${n} | ${b.toLocaleString()} | ${kb(b)} | ${((b / total) * 100).toFixed(1)}% |`);
lines.push('', `Models embedded: ${assetsPayload.length} (${assetsPayload.map((a) => kb(a.bytes)).join(', ')} base64; base64 adds ~33 % over the raw GLB).`,
  '', 'Not in the file: textures for the ground and soldiers are painted at runtime on a canvas (0 bytes shipped); all audio is synthesised at runtime (0 bytes).',
  '', 'GPU/CPU memory after decoding is tracked separately: see docs/PERFORMANCE.md (measured at runtime via `renderer.info`).');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/SIZE_REPORT.md', lines.join('\n') + '\n');
writeFileSync('release/size-report.json', JSON.stringify({ file, totalBytes: total, gzipBytes: gz, maxBytes: maxMb * 1024 * 1024, categories: Object.fromEntries(rows) }, null, 1));

console.log(`size: ${total.toLocaleString()} bytes = ${mb(total)}  (budget ${maxMb} MB, gzip ${mb(gz)})`);
for (const [n, b] of rows) console.log(`  ${n.padEnd(52)} ${kb(b).padStart(8)}  ${((b / total) * 100).toFixed(1).padStart(5)}%`);
if (total > maxMb * 1024 * 1024) { console.error(`\nFAIL: release is ${mb(total)}, over the ${maxMb} MB budget.`); process.exit(1); }
console.log(`\nPASS: ${mb(total)} <= ${maxMb} MB`);
