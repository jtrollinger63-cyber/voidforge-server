#!/usr/bin/env node
/** Opens the FINAL release/hillfront.html from file:// with ALL network access blocked and plays a practice match: proves it is self-contained. */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const file = path.resolve(process.argv[2] || 'release/hillfront.html');
const out = process.argv[3] || 'shots/release'; fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const blocked = []; const errs = [];
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); blocked.push(u); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  const bytes = fs.statSync(file).size;
  await page.goto('file://' + file + '?practice=1&perTeam=3&difficulty=easy&side=0&seed=5', { waitUntil: 'load' });
  await page.waitForFunction('window.__hf && window.__hf.mode === "playing"', null, { timeout: 120000 });
  await page.waitForFunction('window.__hf.game.view.time > 1.5', null, { timeout: 120000, polling: 200 });
  const info = await page.evaluate(() => { const g = window.__hf.game; const v = g.view; return { players: v.players.size, phase: v.phase, soldiers: g.soldiers ? g.soldiers.size : -1, drawCalls: g.stage.renderer.info.render.calls, models: Object.keys(window.__HF_ASSETS__ || {}) }; });
  await page.screenshot({ path: out + '/release-ingame.png' });
  console.log(JSON.stringify({ file, bytes, mb: +(bytes / 1048576).toFixed(2), externalRequestsBlocked: blocked, info, errors: errs }, null, 1));
  const pass = blocked.length === 0 && errs.length === 0 && info.players > 0 && info.models.length === 3;
  console.log(pass ? 'PASS: release HTML is self-contained and playable offline' : 'FAIL');
  await browser.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
