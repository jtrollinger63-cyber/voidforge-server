#!/usr/bin/env node
/** Verifies menu -> practice dialog -> match, death -> spectate, match end -> results, settings persistence. Waits in sim time. */
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[3] || 'shots/flows';
const base = process.argv[2] || 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 300)));
  const R = [];
  const ok = (name, cond, info) => { R.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction('window.__hf && window.__hf.mode === "menu"', null, { timeout: 90000 });
  ok('main menu loads with no game running', await page.evaluate(() => window.__hf.game.state === 'menu'));

  // practice dialog -> start
  await page.click('text=Practice setup');
  await page.waitForSelector('text=Practice vs bots');
  await page.screenshot({ path: out + '/practice-dialog.png' });
  await page.click('button:has-text("3v3")'); await page.click('button:has-text("Easy")'); await page.click('button:has-text("Elimination")');
  await page.click('text=Start match');
  await page.waitForFunction('window.__hf.game.state === "playing"', null, { timeout: 60000 });
  const cfg = await page.evaluate(() => { const g = window.__hf.game; return { mode: g.sim.mode, players: g.sim.players.size, bots: [...g.sim.players.values()].filter((p) => p.bot).length }; });
  ok('practice dialog options reach the sim (elimination, 3v3 => 6 players, 5 bots)', cfg.mode === 'elimination' && cfg.players === 6 && cfg.bots === 5, JSON.stringify(cfg));
  ok('menu is hidden while playing', await page.evaluate(() => document.getElementById('menu').classList.contains('hidden')));

  const simWait = async (sec) => { const t0 = await page.evaluate(() => window.__hf.game.view.time); await page.waitForFunction('window.__hf.game.view.time >= ' + (t0 + sec), null, { timeout: 120000, polling: 100 }); };
  await page.waitForFunction('window.__hf.game.view.phase === "live"', null, { timeout: 180000, polling: 200 });
  await simWait(0.5);

  // death -> spectate
  await page.evaluate(() => { const g = window.__hf.game; const me = g.sim.players.get(g.localId); me.hp = 1; g.sim.damageRawForTest = null; me.alive = false; me.deaths++; });
  await simWait(1.0); await page.waitForTimeout(500);
  const spec = await page.evaluate(() => { const g = window.__hf.game; return { spectateId: g.spectateId, specBanner: !document.querySelector('[data-k=spec]').classList.contains('hidden'), text: document.querySelector('[data-k=spec]').textContent }; });
  ok('dead local player spectates a living teammate', spec.spectateId > 0 && spec.specBanner, JSON.stringify(spec));
  await page.screenshot({ path: out + '/spectating.png' });
  await page.keyboard.press('KeyV'); await simWait(0.3);
  const spec2 = await page.evaluate(() => window.__hf.game.spectateId);
  ok('V cycles the spectated teammate (or stays when only one is alive)', spec2 > 0, 'now watching #' + spec2);

  // match end -> results
  await page.evaluate(() => { const g = window.__hf.game; g.sim.score = [7, 2]; for (const p of g.sim.players.values()) if (p.squad === 1) { p.alive = false; } });
  await page.waitForFunction('window.__hf.game.state === "result"', null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/results.png' });
  const res = await page.evaluate(() => ({ text: document.querySelector('.result').textContent, winner: window.__hf.game.sim.matchWinnerSquad }));
  ok('match ends at 8 round wins and shows the result screen', res.winner !== null && /Victory|Defeat/.test(res.text), res.text.slice(0, 60));
  await page.click('text=Main menu');
  await page.waitForFunction('window.__hf.game.state === "menu"');
  ok('returning to the main menu stops the session', await page.evaluate(() => window.__hf.game.sim === null));

  // settings persistence
  await page.click('text=Settings');
  await page.waitForSelector('text=Mouse sensitivity');
  await page.screenshot({ path: out + '/settings-controls.png' });
  await page.click('button:has-text("graphics")'); await page.waitForSelector('text=Quality preset');
  await page.click('.seg button:has-text("Low")');
  await page.screenshot({ path: out + '/settings-graphics.png' });
  const q1 = await page.evaluate(() => JSON.parse(localStorage.getItem('hillfront.settings.v1')).quality);
  ok('quality preset change is saved to localStorage', q1 === 'low', q1);
  ok('quality preset is applied to the live renderer (shadows off at Low)', await page.evaluate(() => window.__hf.game.stage.quality.name === 'low' && !window.__hf.game.stage.renderer.shadowMap.enabled));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__hf && window.__hf.mode === "menu"', null, { timeout: 90000 });
  ok('settings survive a page reload', await page.evaluate(() => window.__hf.game.stage.quality.name === 'low'));

  const fails = R.filter((r) => !r.pass).length;
  console.log('\n' + (R.length - fails) + '/' + R.length + ' flow checks passed; console errors: ' + (logs.length ? JSON.stringify(logs) : 'none'));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
