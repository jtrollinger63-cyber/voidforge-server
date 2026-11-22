// First-person viewmodel QA: for every weapon, in idle and mid-fire, checks that
//   1. the muzzle and both hands are on screen (or, for the grip hand, at most 15 % below the bottom edge),
//   2. the barrel points away from the camera (within 12 deg of straight ahead),
//   3. the support hand sits on the weapon's forend point (< 1 mm), the firing hand on the grip point (< 1 mm),
//   4. the gun is upright (roll < 10 deg),
//   5. aiming down sights puts the rear and front sight tips on the screen centre line, level with each other (the scoped rifle hides its model instead).
// Needs the dev server (npm run dev) on :5173.  usage: node tools/vmtest.cjs [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  let fails = 0, rows = 0;
  for (const [w, team] of [['a5', 0], ['a5', 1], ['m9', 0], ['t12', 0], ['r7', 0], ['p50', 0], ['knife', 0]]) {
    for (const st of ['idle', 'fire']) {
      await page.goto(`${base}/?viewer=viewmodel&weapon=${w}&team=${team}&state=${st}`, { waitUntil: 'load' });
      await page.waitForFunction('window.__hf && (window.__hf.ready || window.__hf.error)', null, { timeout: 90000 });
      const r = await page.evaluate(() => {
        const vm = window.__hf.vm; vm.rig.updateMatrixWorld(true);
        const V = vm.rig.position.constructor, cam = vm.camera; cam.updateMatrixWorld(true);
        const ndc = (v) => { const p = v.clone().project(cam); return [p.x, p.y]; };
        const mw = vm.model.matrixWorld, hold = vm.hold;
        const local = (x, y, z) => new V(x, y, z).applyMatrix4(mw);
        const fwd = new V(0, 0, 1).transformDirection(mw), up = new V(0, 1, 0).transformDirection(mw);
        const proj = (v) => v.clone().addScaledVector(fwd, -v.dot(fwd)).normalize();
        const rollDeg = Math.acos(Math.max(-1, Math.min(1, proj(up).dot(proj(new V(0, 1, 0)))))) * 180 / Math.PI;
        const grip = local(...hold.grip), fore = hold.fore ? local(...hold.fore) : null;
        return {
          muzzle: ndc(local(0, hold.barrelY, hold.muzzleZ)), gripNdc: ndc(grip), foreNdc: fore ? ndc(fore) : null,
          aheadDeg: Math.acos(Math.max(-1, Math.min(1, -fwd.z))) * 180 / Math.PI, rollDeg,
          rErr: vm.handR.root.position.distanceTo(grip), lErr: fore ? vm.handL.root.position.distanceTo(fore) : null,
        };
      });
      const prob = [];
      if (Math.abs(r.muzzle[0]) > 1 || Math.abs(r.muzzle[1]) > 1) prob.push(`muzzle off screen (${r.muzzle.map((n) => n.toFixed(2))})`);
      if (r.gripNdc[1] < -1.15 || Math.abs(r.gripNdc[0]) > 1) prob.push(`grip hand off screen (${r.gripNdc.map((n) => n.toFixed(2))})`);
      if (r.foreNdc && (Math.abs(r.foreNdc[0]) > 1 || r.foreNdc[1] < -1.15 || r.foreNdc[1] > 1)) prob.push(`support hand off screen (${r.foreNdc.map((n) => n.toFixed(2))})`);
      if (w !== 'knife' && r.aheadDeg > 12) prob.push(`barrel ${r.aheadDeg.toFixed(0)} deg off straight ahead`);
      if (w !== 'knife' && r.rollDeg > 10) prob.push(`gun rolled ${r.rollDeg.toFixed(0)} deg`);
      if (r.rErr > 0.001) prob.push(`firing hand ${(r.rErr * 1000).toFixed(1)} mm off the grip`);
      if (r.lErr !== null && r.lErr > 0.001) prob.push(`support hand ${(r.lErr * 1000).toFixed(1)} mm off the forend`);
      rows++; if (prob.length) fails++;
      console.log(`${prob.length ? 'FAIL' : 'ok  '} ${w}:${team} ${st.padEnd(5)} muzzle(${r.muzzle.map((n) => n.toFixed(2))}) grip(${r.gripNdc.map((n) => n.toFixed(2))}) ahead ${r.aheadDeg.toFixed(0)}deg roll ${r.rollDeg.toFixed(0)}deg  ${prob.join('; ')}`);
    }
  }
  // aim down sights
  for (const [w, team] of [['a5', 0], ['a5', 1], ['m9', 0], ['t12', 0], ['p50', 0], ['r7', 0]]) {
    await page.goto(`${base}/?viewer=viewmodel&weapon=${w}&team=${team}&state=idle&aim=1`, { waitUntil: 'load' });
    await page.waitForFunction('window.__hf && (window.__hf.ready || window.__hf.error)', null, { timeout: 90000 });
    const r = await page.evaluate(() => {
      const vm = window.__hf.vm; vm.rig.updateMatrixWorld(true); vm.camera.updateMatrixWorld(true);
      const V = vm.rig.position.constructor; const s = vm.hold.sights; const ndc = (a) => { const p = new V(...a).applyMatrix4(vm.model.matrixWorld).project(vm.camera); return [p.x, p.y]; };
      return { rear: ndc(s.rear), front: ndc(s.front), visible: vm.rig.visible };
    });
    const prob = [];
    if (w === 'r7') { if (r.visible) prob.push('scoped rifle model should be hidden while looking through the scope'); }
    else {
      if (Math.abs(r.rear[0]) > 0.04 || Math.abs(r.front[0]) > 0.04) prob.push(`sights off the centre line (${r.rear[0].toFixed(3)}, ${r.front[0].toFixed(3)})`);
      if (Math.abs(r.rear[1] - r.front[1]) > 0.06) prob.push(`rear and front sight not level (${r.rear[1].toFixed(3)} vs ${r.front[1].toFixed(3)})`);
      if (r.front[1] < -0.35 || r.front[1] > 0.1) prob.push(`front sight not near screen centre (y ${r.front[1].toFixed(3)})`);
    }
    rows++; if (prob.length) fails++;
    console.log(`${prob.length ? 'FAIL' : 'ok  '} ${w}:${team} ADS    rear(${r.rear.map((n) => n.toFixed(3))}) front(${r.front.map((n) => n.toFixed(3))})  ${prob.join('; ')}`);
  }
  await browser.close();
  console.log(`\n${rows - fails}/${rows} viewmodel checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
