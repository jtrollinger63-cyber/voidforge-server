#!/usr/bin/env node
/**
 * Screenshot helper (CommonJS: uses the pre-installed global Playwright + Chromium).
 * Usage: node tools/shot.cjs <url> <out.png> [--w 1366] [--h 768] [--wait "window.__hf.ready"] [--settle 800] [--dpr 1]
 * Prints console errors, page errors and window.__hf stats as JSON on stdout.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const a = process.argv.slice(2);
  const url = a[0], out = a[1];
  const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const W = +opt('w', 1366), H = +opt('h', 768), settle = +opt('settle', 800);
  const waitExpr = opt('wait', 'window.__hf && window.__hf.ready');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +opt('dpr', 1) });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(url, { waitUntil: 'load' });
  try { await page.waitForFunction(waitExpr, null, { timeout: +opt('timeout', 90000) }); } catch (e) { logs.push('[wait-timeout] ' + waitExpr); }
  await page.waitForTimeout(settle);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  const stats = await page.evaluate(() => { const h = window.__hf || {}; const o = {}; for (const k of Object.keys(h)) { const v = h[k]; if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') o[k] = v; else if (Array.isArray(v)) o[k] = v.length > 12 ? `[${v.length} items]` : v; else if (v && v.constructor === Object) o[k] = v; } return o; });
  console.log(JSON.stringify({ out, stats, logs }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
