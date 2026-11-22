#!/usr/bin/env node
/**
 * Drives the REAL game in headless Chromium with synthetic keyboard/mouse input and reports measurable outcomes.
 * Usage: node tools/playtest.cjs [baseUrl] [outDir]
 *
 * NOTE: headless software-WebGL runs at a few FPS, and the game clamps its frame step, so the simulation advances slower than
 * wall-clock. Every wait below is therefore in SIMULATION time (view.time), not wall time. FPS numbers printed here are NOT
 * representative of a real GPU / Chromebook.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'shots/playtest';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text().slice(0, 250)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(base + '?practice=1&perTeam=3&difficulty=easy&side=0&seed=9&give=a5', { waitUntil: 'load' });
  await page.waitForFunction('window.__hf && window.__hf.mode === "playing"', null, { timeout: 90000 });

  const simNow = () => page.evaluate(() => window.__hf.game.view.time);
  const simWait = async (sec) => { const t0 = await simNow(); await page.waitForFunction('window.__hf.game.view.time >= ' + (t0 + sec), null, { timeout: 180000, polling: 100 }); };
  const snap = () => page.evaluate(() => {
    const g = window.__hf.game; const v = g.view; const me = v.players.get(g.localId);
    return { phase: v.phase, t: +v.phaseT.toFixed(1), round: v.round, me: me && { x: +me.x.toFixed(2), z: +me.z.toFixed(2), y: +me.y.toFixed(2), hp: me.hp, mag: me.mag, reserve: me.reserve, money: me.money, weapon: me.weapon, kills: me.kills, alive: me.alive, armor: me.armor, reloading: me.reloading }, ui: g.screens.open, state: g.state };
  });
  const steps = [];
  const step = async (name, fn) => { const before = await snap(); await fn(); const after = await snap(); steps.push({ name, before: before.me, after: after.me, ui: after.ui, phase: after.phase }); };

  await simWait(0.3);
  const start = await snap();
  await step('open buy menu (B)', async () => { await page.keyboard.press('KeyB'); await page.waitForTimeout(500); await page.screenshot({ path: out + '/buy-menu.png' }); });
  await step('buy plate carrier (digit 6)', async () => { await page.keyboard.press('Digit6'); await page.waitForTimeout(300); });
  await step('close buy menu (Esc)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); });
  await page.waitForFunction('window.__hf.game.view.phase === "live"', null, { timeout: 180000, polling: 200 });

  await step('walk forward 1.2 s sim (W)', async () => { await page.keyboard.down('KeyW'); await simWait(1.2); await page.keyboard.up('KeyW'); });
  await step('strafe right 0.8 s + jump (D, Space)', async () => { await page.keyboard.down('KeyD'); await page.keyboard.press('Space'); await simWait(0.8); await page.keyboard.up('KeyD'); });
  await step('turn right with arrow key 0.4 s', async () => { await page.keyboard.down('ArrowRight'); await simWait(0.4); await page.keyboard.up('ArrowRight'); });
  await step('fire 1.0 s sim (hold LMB)', async () => { await page.mouse.down(); await simWait(0.5); await page.screenshot({ path: out + '/firing.png' }); await simWait(0.5); await page.mouse.up(); });
  await step('reload (R) and wait 3.0 s sim', async () => { await page.keyboard.press('KeyR'); await simWait(1.0); await page.screenshot({ path: out + '/reloading.png' }); await simWait(2.0); });
  await step('switch to pistol (2)', async () => { await page.keyboard.press('Digit2'); await simWait(0.9); await page.screenshot({ path: out + '/pistol.png' }); });
  await step('switch to knife (3)', async () => { await page.keyboard.press('Digit3'); await simWait(0.9); await page.screenshot({ path: out + '/knife.png' }); });
  await step('back to rifle (1)', async () => { await page.keyboard.press('Digit1'); await simWait(1.0); });
  await step('scoreboard (hold Tab)', async () => { await page.keyboard.down('Tab'); await page.waitForTimeout(600); await page.screenshot({ path: out + '/scoreboard.png' }); await page.keyboard.up('Tab'); await page.waitForTimeout(400); });
  await step('inspect (F)', async () => { await page.keyboard.press('KeyF'); await simWait(1.0); await page.screenshot({ path: out + '/inspect.png' }); });
  await step('pause (Esc)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(600); await page.screenshot({ path: out + '/pause.png' }); });
  const tPause = await simNow(); await page.waitForTimeout(1500); const tPause2 = await simNow();
  await step('resume (Esc)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(500); });

  const perf = await page.evaluate(() => { const g = window.__hf.game; const i = g.stage.renderer.info; return { drawCalls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, dynamicScale: g.stage.dynamicScale }; });
  const end = await snap();
  const f = (m) => (m ? 'pos(' + m.x + ',' + m.z + ') y' + m.y + ' hp' + m.hp + ' ammo' + m.mag + '/' + m.reserve + ' $' + m.money + ' ' + m.weapon + ' armor' + m.armor + (m.reloading ? ' RELOADING' : '') : '-');
  console.log('start:', JSON.stringify(start.me), 'phase', start.phase);
  for (const st of steps) { console.log('- ' + st.name.padEnd(40) + ' [' + st.phase + '] ui=' + st.ui); console.log('    before ' + f(st.before)); console.log('    after  ' + f(st.after)); }
  console.log('sim time frozen while paused:', tPause === tPause2, '(' + tPause.toFixed(3) + ' -> ' + tPause2.toFixed(3) + ')');
  console.log('perf (software GL, last frame):', JSON.stringify(perf));
  console.log('end:', JSON.stringify(end));
  console.log('console errors:', logs.filter((l) => !/GL Driver/.test(l)).length ? logs : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
