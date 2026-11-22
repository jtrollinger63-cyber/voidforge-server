// View-stability + aim QA in a real browser (software GL, so frame times are ragged on purpose: that is the hard case).
//   1. standing still: the camera does not move at all (no shake for no reason)
//   2. running: the camera's speed is even from frame to frame despite uneven frame times (sim ticks are interpolated), bob stays tiny
//   3. firing a full-auto burst: yaw/pitch change smoothly (no random per-frame jitter)
//   4. aim down sights (right mouse): zooms the camera in, tightens the crosshair, and releases again
//   5. every shot lands where the crosshair points (view angles used by the camera == angles used for the bullet)
// Needs the dev server (npm run dev) on :5173.  usage: node tools/looktest.cjs [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
let fails = 0;
const check = (ok, msg, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fails++; };

// records per-frame camera state for `ms` milliseconds
const RECORD = `(ms) => new Promise((resolve) => {
  const g = window.__hf.game, cam = g.stage.camera, out = [];
  const t0 = performance.now(); let last = t0;
  const tick = (now) => {
    out.push({ dt: (now - last) / 1000, simT: g.sim.time - (1 - g.sim.renderAlpha) / 60, x: cam.position.x, y: cam.position.y, z: cam.position.z, rx: cam.rotation.x, ry: cam.rotation.y, rz: cam.rotation.z, fov: cam.fov, aimK: g.aimK });
    last = now;
    if (now - t0 < ms) requestAnimationFrame(tick); else resolve(out);
  };
  requestAnimationFrame(tick);
})`;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.addInitScript(() => { localStorage.setItem('hillfront.settings.v1', JSON.stringify({ quality: 'low', resolutionScale: 0.6, dynamicRes: false })); });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?practice=1&perTeam=1&difficulty=easy&side=0&seed=3&give=a5`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hf && window.__hf.mode === "playing"', null, { timeout: 90000 });
  await page.waitForFunction('window.__hf.game.view.phase === "live"', null, { timeout: 180000 });
  await page.waitForTimeout(500);
  // lock the bots out of the picture: a stationary test must not be disturbed by being shot at
  await page.evaluate(() => { const sim = window.__hf.game.sim; for (const p of sim.players.values()) if (p.id !== window.__hf.game.localId) { p.m.x = 0; p.m.z = -60; } });

  // 1. standing still --------------------------------------------------------------------------------------------------
  const still = await page.evaluate(`(${RECORD})(2500)`);
  const span = (k) => Math.max(...still.map((f) => f[k])) - Math.min(...still.map((f) => f[k]));
  check(still.length > 5 && span('x') < 1e-4 && span('z') < 1e-4 && span('y') < 1e-3, 'standing still: camera position does not move', `x ${span('x').toExponential(1)} y ${span('y').toExponential(1)} z ${span('z').toExponential(1)} over ${still.length} frames`);
  check(span('rx') < 1e-4 && span('ry') < 1e-4 && span('rz') < 1e-4, 'standing still: camera rotation does not move (no shake)', `rx ${span('rx').toExponential(1)} ry ${span('ry').toExponential(1)} rz ${span('rz').toExponential(1)}`);

  // 2. running --------------------------------------------------------------------------------------------------------
  // a clear lane (the south courtyard) so a wall does not interrupt the run
  await page.evaluate(() => { const g = window.__hf.game, me = g.sim.players.get(g.localId); me.m.x = 0; me.m.z = 24; me.m.y = 0.1; me.prev.x = 0; me.prev.z = 24; g.yaw = 0; g.pitch = 0; });
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  const run = await page.evaluate(`(${RECORD})(2200)`);
  await page.keyboard.up('KeyW');
  // speed in SIM time (wall-clock speed is meaningless when software GL runs at ~7 fps and the game clamps its step): displayed distance / displayed sim time, until a wall stops us
  const vs = []; for (let i = 1; i < run.length; i++) { const f = run[i], p = run[i - 1]; const dT = f.simT - p.simT; if (dT > 0.005) vs.push(Math.hypot(f.x - p.x, f.z - p.z) / dT); }
  const top = Math.max(...vs); let n = 0; while (n < vs.length && vs[n] > top * 0.8) n++;
  const seg = vs.slice(0, n); const mean = seg.reduce((a, b) => a + b, 0) / seg.length, sd = Math.sqrt(seg.reduce((a, b) => a + (b - mean) ** 2, 0) / seg.length);
  const dts = run.slice(1).map((f) => f.dt * 1000), dtMean = dts.reduce((a, b) => a + b, 0) / dts.length;
  check(mean > 3.5, 'running: moves at run speed', `${mean.toFixed(2)} m/s over ${n} frames`);
  check(n >= 4 && sd / mean < 0.03, 'running: displayed motion is even (matches the sim clock exactly)', `speed CV ${(sd / mean * 100).toFixed(2)} % (frame time ${dtMean.toFixed(0)} ms)`);
  const ys = run.map((f) => f.y); const bob = Math.max(...ys) - Math.min(...ys);
  check(bob < 0.02, 'running: head bob stays small', `${(bob * 1000).toFixed(1)} mm peak-to-peak`);
  const roll = Math.max(...run.map((f) => Math.abs(f.rz)));
  check(roll < 1e-3, 'running: no camera roll wobble', `${roll.toExponential(1)} rad`);

  // 3. full-auto burst ------------------------------------------------------------------------------------------------
  await page.evaluate(() => { const sim = window.__hf.game.sim, me = sim.players.get(window.__hf.game.localId); me.ammo.a5 = { mag: 999, reserve: 999 }; });
  await page.mouse.move(480, 270); await page.mouse.down();
  await page.waitForTimeout(150);
  const burst = await page.evaluate(`(${RECORD})(1500)`);
  await page.mouse.up();
  let maxDy = 0, maxDp = 0, sign = 0, flips = 0;
  for (let i = 1; i < burst.length; i++) { maxDy = Math.max(maxDy, Math.abs(burst[i].ry - burst[i - 1].ry)); maxDp = Math.max(maxDp, Math.abs(burst[i].rx - burst[i - 1].rx)); const d = Math.sign(burst[i].ry - burst[i - 1].ry); if (d && sign && d !== sign) flips++; if (d) sign = d; }
  check(maxDy < 0.02 && maxDp < 0.03, 'firing: camera moves smoothly (recoil is a kick, not random jitter)', `max per-frame yaw ${(maxDy * 57.3).toFixed(2)} deg, pitch ${(maxDp * 57.3).toFixed(2)} deg over ${burst.length} frames`);
  await page.waitForTimeout(600);

  // 4. aim down sights ------------------------------------------------------------------------------------------------
  const fovHip = await page.evaluate(() => window.__hf.game.stage.camera.fov);
  const spreadHip = await page.evaluate(() => { const g = window.__hf.game; return g.spreadDeg(g.view.players.get(g.localId)); });
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction('window.__hf.game.aimK === 1', null, { timeout: 15000 }).catch(() => {});      // frame rate in software GL is a few fps: wait for the ease to finish rather than for a fixed time
  const ads = await page.evaluate(() => { const g = window.__hf.game; return { fov: g.stage.camera.fov, k: g.aimK, spread: g.spreadDeg(g.view.players.get(g.localId)), cmdAim: g.sim.players.get(g.localId).cmd.aim }; });
  check(ads.k > 0.95 && ads.cmdAim === true, 'right mouse aims down sights', `aimK ${ads.k.toFixed(2)}, cmd.aim ${ads.cmdAim}`);
  check(ads.fov < fovHip * 0.82, 'aiming zooms the camera', `fov ${fovHip.toFixed(1)} -> ${ads.fov.toFixed(1)}`);
  check(ads.spread < spreadHip * 0.6, 'aiming tightens the crosshair', `${spreadHip.toFixed(2)} -> ${ads.spread.toFixed(2)} deg`);
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction('window.__hf.game.aimK === 0', null, { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => ({ fov: window.__hf.game.stage.camera.fov, k: window.__hf.game.aimK }));
  check(after.k < 0.02 && Math.abs(after.fov - fovHip) < 0.1, 'releasing returns to the hip view', `fov ${after.fov.toFixed(2)}`);

  // 5. every shot goes where the crosshair points ------------------------------------------------------------------------
  // the camera and the bullets must use the same angles: freeze the sim, impose a view punch, and see where the camera ends up
  const pun = await page.evaluate(async () => {
    const g = window.__hf.game, me = g.sim.players.get(g.localId);
    g.state = 'paused'; me.punchY = 1.5; me.punchP = 3;                                  // degrees
    await new Promise((r) => setTimeout(r, 1500));
    const cam = g.stage.camera; const out = { dyaw: (cam.rotation.y - g.yaw) * 180 / Math.PI, dpitch: (cam.rotation.x - g.pitch) * 180 / Math.PI };
    g.state = 'playing'; me.punchY = 0; me.punchP = 0;
    return out;
  });
  check(Math.abs(pun.dyaw - 1.5) < 0.05 && Math.abs(pun.dpitch - 3) < 0.05, 'camera shows the same view punch the bullets use (yaw sign included)', `camera moved yaw ${pun.dyaw.toFixed(2)} deg (want +1.5), pitch ${pun.dpitch.toFixed(2)} deg (want +3)`);

  check(errors.length === 0, 'no page errors', errors.join('; '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall view / aim checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
