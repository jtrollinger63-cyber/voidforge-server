// Weapon-in-hand QA: for every weapon x pose, measures (in the QA soldier viewer) that
//   1. the gun is upright (rolled < 25 deg about its own barrel),           2. the barrel points where the soldier faces (yaw within 6 deg),
//   3. the support palm (Socket_Hand_L) lands on the forend (rifles/SMG/shotgun/marksman) within 3.5 cm.
// Needs the dev server (npm run dev) on :5173.  usage: node tools/holdtest.cjs [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const WEAPONS = [['a5', 0], ['a5', 1], ['m9', 0], ['m9', 1], ['t12', 0], ['r7', 0], ['p50', 0], ['knife', 0]];
const STATES = ['idle', 'walk', 'run', 'crouch', 'fire'];
const TWO_HANDED = new Set(['a5', 'm9', 't12', 'r7']);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  let fails = 0, rows = 0;
  for (const [w, team] of WEAPONS) {
    for (const st of STATES) {
      await page.goto(`${base}/?viewer=soldier&weapon=${w}&team=${team}&state=${st}&t=1.2`, { waitUntil: 'load' });
      await page.waitForFunction('window.__hf && window.__hf.ready', null, { timeout: 90000 });
      const r = await page.evaluate(() => {
        const sd = window.__hf.soldiers[0]; sd.root.updateMatrixWorld(true);
        const mesh = sd.weaponNode.children[0], V = sd.root.position.constructor;
        const dir = (m, x, y, z) => new V(x, y, z).transformDirection(m);
        const barrel = dir(mesh.matrixWorld, 0, 0, 1), up = dir(mesh.matrixWorld, 0, 1, 0);
        // roll about the barrel axis: angle between the gun's up and world-up, both projected onto the plane normal to the barrel
        const proj = (v) => v.clone().addScaledVector(barrel, -v.dot(barrel)).normalize();
        const rollDeg = Math.acos(Math.max(-1, Math.min(1, proj(up).dot(proj(new V(0, 1, 0)))))) * 180 / Math.PI;
        return { barrel: [barrel.x, barrel.y, barrel.z], upY: up.y, rollDeg, yawDeg: Math.atan2(barrel.x, barrel.z) * 180 / Math.PI, pitchDeg: Math.asin(barrel.y) * 180 / Math.PI, foreErr: sd.lastForeError };
      });
      const problems = [];
      // melee knife is held blade-forward but may be edge-rolled; everything else must be upright
      if (w !== 'knife' && r.rollDeg > 25) problems.push(`rolled ${r.rollDeg.toFixed(0)} deg about the barrel`);
      if (w !== 'knife' && r.pitchDeg > -50 && Math.abs(r.yawDeg) > 6) problems.push(`barrel yaw ${r.yawDeg.toFixed(1)} deg off facing`);
      if (TWO_HANDED.has(w) && !(r.foreErr >= 0 && r.foreErr < 0.035)) problems.push(`support hand ${r.foreErr < 0 ? 'not solved' : (r.foreErr * 100).toFixed(1) + ' cm'} from forend`);
      rows++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${w}:${team} ${st.padEnd(6)} roll ${r.rollDeg.toFixed(0).padStart(2)}  yaw ${r.yawDeg.toFixed(1).padStart(6)}  pitch ${r.pitchDeg.toFixed(0).padStart(4)}  foreErr ${r.foreErr < 0 ? '  n/a' : (r.foreErr * 100).toFixed(1) + 'cm'}  ${problems.join('; ')}`);
      if (problems.length) fails++;
    }
  }
  await browser.close();
  console.log(`\n${rows - fails}/${rows} weapon x pose checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
