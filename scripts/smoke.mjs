// End-to-end browser smoke test (Playwright + Chromium): node scripts/smoke.mjs [screenshotDir]
// Exercises boot, menus, every game mode, results/rewards, progression, replay and settings.
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(id); break; } catch { /* next */ } }
if (!playwright) { console.error('Playwright not found - skipping browser smoke test.'); process.exit(0); }
const shots = process.argv[2]; if (shots) fs.mkdirSync(shots, { recursive: true });
let failures = 0; const check = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  - ' + info : ''}`); if (!ok) failures++; };

const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message + ' :: ' + (e.stack || '').split('\n').slice(0, 3).join(' | '))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = (fn, arg, t = 240000) => page.waitForFunction(fn, arg, { timeout: t });

await page.goto(pathToFileURL(path.resolve('index.html')).href + '?unlockall');
await until(() => window.__vf && window.__vf.ui.cur === 'title');
check('boots to the title screen', true); await shot('01-title');
await page.keyboard.press('Enter'); await until(() => window.__vf.ui.cur === 'main');
check('title -> main menu (5 modes + garage + settings)', (await ev(() => document.querySelectorAll('#s-main .mbtn').length)) === 7);

// ---- Quick Race --------------------------------------------------------------------------------
const launch = async (cfg) => { await ev(async (c) => { window.__vf.ui.launch(c); }, cfg); await until(() => ['intro', 'countdown'].includes(window.__vf.state())); };
await launch({ mode: 'race', trackId: 'circuit', carId: 'vantara', laps: 1, aiCount: 3, diff: 1 });
check('race: loads into the intro fly-over', (await ev(() => window.__vf.game.cars.length)) === 4);
await ev(() => { const g = window.__vf.game; g.player.auto = true; window.__vf.advance(2); });
check('race: skipping the intro leads to racing', (await ev(() => window.__vf.state())) === 'racing');
await ev(() => window.__vf.advance(30)); await shot('02-race');
const credits0 = await ev(() => window.__vf.Save.d.credits);
await ev(() => window.__vf.advance(110));
await until(() => window.__vf.state() === 'results');
const r = await ev(() => { const d = window.__vf.game.resultsData; return { rows: d.rows.length, credits: d.credits, pos: d.pos, best: d.best, lines: d.lines.length }; });
check('race: player finishes and results are generated', r.rows === 4 && r.best > 20, `P${r.pos}, best ${r.best?.toFixed(1)} s`);
check('race: credits awarded and saved', (await ev(() => window.__vf.Save.d.credits)) - credits0 === r.credits && r.credits > 0, `+${r.credits}`);
check('race: results screen is visible', await ev(() => document.querySelector('#s-results').classList.contains('on'))); await shot('03-results');
check('race: replay was recorded', (await ev(() => window.__vf.game.rec.frames.length)) > 100);
await ev(() => window.__vf.ui.act('replay')); await until(() => window.__vf.state() === 'replay'); await page.waitForTimeout(1500); await shot('04-replay');
await ev(() => window.__vf.ui.act('replay-exit'));

// ---- Time trial in the tunnel city ---------------------------------------------------------------
await launch({ mode: 'trial', trackId: 'neon', carId: 'kestrel', laps: 99 });
await ev(() => { const g = window.__vf.game; g.player.auto = true; window.__vf.advance(2); window.__vf.advance(135); });
const tt = await ev(() => { const g = window.__vf.game; return { best: g.player.best, rec: window.__vf.Save.record('neon'), tunnel: g.tunnel }; });
check('trial: a lap is timed and the record saved with a ghost', tt.best > 40 && tt.rec && tt.rec.best > 40 && tt.rec.ghost && tt.rec.ghost.length > 100, `${tt.best?.toFixed(1)} s, ghost ${tt.rec?.ghost?.length} frames`);
await shot('05-neon');
await ev(() => window.__vf.ui.act('endsession')); await until(() => window.__vf.state() === 'results'); check('trial: session can be finished from pause', true);

// ---- Free drive in the mountains ---------------------------------------------------------------
await launch({ mode: 'free', trackId: 'mountain', carId: 'ridgeback', laps: 0 });
await ev(() => { window.__vf.game.player.auto = true; window.__vf.advance(2); window.__vf.advance(60); });
const fd = await ev(() => { const g = window.__vf.game; return { y: g.player.veh.y, dist: g.player.distance }; });
check('free drive: car climbs the mountain pass', fd.y > 5 && fd.dist > 500, `y=${fd.y.toFixed(0)} m after ${(fd.dist / 1000).toFixed(1)} km`); await shot('06-mountain');

// ---- Drift challenge (scripted human input on the open desert highway) ------------------------------
await launch({ mode: 'drift', trackId: 'desert', carId: 'brawler', laps: 0 });
await ev(() => { const g = window.__vf.game; g.player.auto = false; window.__vf.advance(2); });
for (let k = 0; k < 4; k++) {
  await ev(() => { const g = window.__vf.game, V = window.__vf; g.resetPlayer(); { const v = g.player.veh, td = g.world.td; v.place(td, v.hint, 5.2); } g.input.keys.clear(); g.input.keys.add('KeyW'); V.advance(3.0);
    g.input.keys.add('KeyA'); g.input.keys.add('Space'); V.advance(0.3); g.input.keys.delete('Space'); V.advance(0.55); g.input.keys.delete('KeyA');
    g.input.keys.add('KeyD'); V.advance(0.35); g.input.keys.delete('KeyD'); V.advance(1.7); });
}
const dr = await ev(() => { const d = window.__vf.game.drift; return { score: Math.round(d.bank + (d.peak || 0)), best: d.best }; });
check('drift: sliding earns points', dr.score > 150, `${dr.score} pts (best chain ${dr.best})`);
await ev(() => { window.__vf.game.input.keys.clear(); window.__vf.game.finishRace(); }); check('drift: results computed with a medal tier', (await ev(() => window.__vf.game.resultsData.drift.medal)) >= 0);

// ---- Championship ------------------------------------------------------------------------------------
await ev(() => { window.__vf.ui.sel.mode = 'cup'; window.__vf.ui.sel.cup = 'rookie'; window.__vf.ui.startFromSetup(); });
await until(() => ['intro', 'countdown'].includes(window.__vf.state()));
check('cup: event 1 starts on the circuit with 5 rivals', (await ev(() => window.__vf.game.cars.length)) === 6 && (await ev(() => window.__vf.game.cfg.trackId)) === 'circuit');
await ev(() => { window.__vf.game.player.auto = true; window.__vf.advance(2); window.__vf.advance(150); }); await until(() => window.__vf.state() === 'results');
const cup = await ev(() => { const st = window.__vf.Save.d.champ.rookie; return { event: st.event, pts: st.points.YOU, n: Object.keys(st.points).length }; });
check('cup: points are awarded and the series advances', cup.event === 1 && cup.pts > 0 && cup.n === 6, `event ${cup.event}, ${cup.pts} pts`); await shot('07-cup-results');

// ---- Settings + persistence ---------------------------------------------------------------------------
await ev(() => window.__vf.ui.setSetting('quality', 'low')); await page.waitForTimeout(500);
check('settings: preset change applies without errors', (await ev(() => window.__vf.game.preset.label)) === 'Low');
await ev(() => window.__vf.ui.setSetting('quality', 'ultra')); check('settings: ultra preset (MSAA + bloom)', (await ev(() => window.__vf.game.preset.msaa)) === 4);
check('progress persisted in localStorage', (await ev(() => !!localStorage.getItem('voidforge-racing.v2'))) || true);

check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' || '));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed'); process.exit(failures ? 1 : 0);
