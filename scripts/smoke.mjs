// Browser smoke test: node scripts/smoke.mjs [screenshotDir]
// Needs Playwright (and a Chromium) to be resolvable, e.g. `npm i -D playwright` or a global install.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(id); break; } catch { /* try next */ } }
if (!playwright) { console.error('Playwright not found - skipping browser smoke test.'); process.exit(0); }

const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) failures++; };

const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });

await page.goto(pathToFileURL(path.resolve('index.html')).href);
await page.waitForFunction(() => window.__vf && document.getElementById('loading').hidden, null, { timeout: 30000 });
check('menu is shown with 3 tracks', await page.locator('#menu').isVisible() && (await page.locator('#tracks .card').count()) === 3);
await shot('1-menu');

// start from the real button
await page.click('#go');
check('START RACE enters the countdown', await page.evaluate(() => window.__vf.G.state) === 'countdown');
await page.evaluate(() => window.__vf.advance(4));
check('countdown finishes and the race goes green', await page.evaluate(() => window.__vf.G.state) === 'racing');

// real keyboard input drives the player car (software rendering is slow, so wait on state, not wall-clock)
await page.keyboard.down('ArrowUp');
await page.waitForFunction(() => window.__vf.G.playerInput.throttle === 1, null, { timeout: 15000 });
await page.waitForFunction(() => window.__vf.player.speed > 2, null, { timeout: 30000 });
await page.keyboard.up('ArrowUp');
check('holding ArrowUp reaches the car and accelerates it', true, `${(await page.evaluate(() => window.__vf.player.speed * 3.6)).toFixed(0)} km/h`);
const cam0 = await page.evaluate(() => window.__vf.cam.mode);
await page.keyboard.press('KeyC');
await page.waitForFunction((m) => window.__vf.cam.mode !== m, cam0, { timeout: 15000 });
check('C cycles the camera mode', true);
await page.keyboard.press('KeyP');
await page.waitForSelector('#pause:not([hidden])', { timeout: 15000 });
check('P pauses', true);
await shot('2-paused');
await page.click('#resume');
check('resume hides the pause menu', !(await page.locator('#pause').isVisible()));

// full 1-lap race on every track with autopilot, ending on the results screen
for (let t = 0; t < 3; t++) {
  await page.evaluate((t) => { const v = window.__vf; v.loadTrack(t); v.settings.laps = 1; v.settings.diff = 1; v.startRace(); v.autopilot(true); v.advance(4); }, t);
  await page.evaluate(() => window.__vf.advance(100));
  const r = await page.evaluate(() => { const v = window.__vf; return { state: v.G.state, rank: v.player.rank, finished: v.cars.filter((c) => c.finished).length, best: v.player.bestLap, track: v.G.def.id }; });
  check(`${r.track}: player finishes a 1-lap race (autopilot)`, r.state === 'finished' && r.best > 20 && r.best < 120, `rank ${r.rank}, lap ${r.best?.toFixed(1)} s, ${r.finished}/6 finished`);
  await page.waitForSelector('#results:not([hidden])', { timeout: 15000 });
  check(`${r.track}: results table lists all 6 cars`, (await page.locator('#resBody tr').count()) === 6);
  if (t === 0) await shot('3-results');
}

// touch layout
const mobile = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const mp = await mobile.newPage();
mp.on('pageerror', (e) => errors.push('mobile: ' + e.message));
await mp.goto(pathToFileURL(path.resolve('index.html')).href);
await mp.waitForFunction(() => window.__vf && document.getElementById('loading').hidden, null, { timeout: 30000 });
if (shots) await mp.screenshot({ path: path.join(shots, '4-mobile-menu.png') });
await mp.evaluate(() => { window.__vf.startRace(); window.__vf.advance(4); });
await mp.waitForTimeout(1200);
check('touch controls appear on a touch device', await mp.locator('#touch').isVisible());
if (shots) await mp.screenshot({ path: path.join(shots, '5-mobile-race.png') });

check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed');
process.exit(failures ? 1 : 0);
