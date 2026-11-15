// Headless physics + AI tests (no browser needed): node scripts/sim-test.mjs
import { TRACKS } from '../src/tracks.js';
import { buildTrackData, SPACING } from '../src/trackmath.js';
import { CarBody, PHYS, collideCars } from '../src/car.js';
import { aiDrive, buildRacingLine, makeAIState } from '../src/ai.js';

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) failures++; };
const H = 1 / 240;
const none = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
const td = buildTrackData(TRACKS[0]);

function fresh(lat = 0) { const c = new CarBody(0); c.place(td, 5, lat); return c; }

// Dynamics checks run on an unbounded flat plane so walls/curves cannot distort the numbers.
const open = { N: 1000, half: 1e6, runoff: 1e6, heading: new Float32Array(1000), nearest: () => ({ idx: 0, t: 0, lat: 0, rx: 1, rz: 0, cx: 0, cz: 0, dist: 0 }) };
function bare(speed = 0) {
  const c = new CarBody(0);
  c.q = open.nearest(); c.onRoad = true;
  c.vx = 0; c.vz = speed; c.vf = speed; c.speed = speed;
  return c;
}

// --- 1. acceleration ---------------------------------------------------------------
{
  const c = bare(); let t100 = null, t200 = null;
  for (let t = 0; t < 30; t += H) {
    c.step(H, { ...none, throttle: 1 }, open);
    if (t100 == null && c.speed * 3.6 >= 100) t100 = t;
    if (t200 == null && c.speed * 3.6 >= 200) t200 = t;
  }
  check('0-100 km/h in 2.6-4.5 s', t100 > 2.6 && t100 < 4.5, `${t100?.toFixed(2)} s`);
  check('0-200 km/h in 7-16 s (keeps pulling at high speed)', t200 != null && t200 > 7 && t200 < 16, `${t200?.toFixed(2)} s`);
  check('top speed 225-250 km/h', c.speed * 3.6 > 225 && c.speed * 3.6 < 250, `${(c.speed * 3.6).toFixed(0)} km/h`);
  const n = bare(), m = bare(); n.boost = 1;
  for (let t = 0; t < 2.5; t += H) { n.step(H, { ...none, throttle: 1, boost: true }, open); m.step(H, { ...none, throttle: 1 }, open); }
  check('nitro gives a clear burst of acceleration (>= +8% speed after 2.5 s)', n.speed > m.speed * 1.08, `${(n.speed * 3.6).toFixed(0)} vs ${(m.speed * 3.6).toFixed(0)} km/h`);
  for (let t = 0; t < 4; t += H) n.step(H, { ...none, throttle: 1, boost: true }, open);
  check('nitro runs out (meter empties, no infinite boost)', n.boost < 0.05 && !n.boosting, `meter ${n.boost.toFixed(2)}`);
}

// --- 2. cornering is grip limited ------------------------------------------------------
for (const v0 of [15, 30, 55]) {
  const c = bare(v0);
  let latG = 0, maxSlip = 0;
  for (let t = 0; t < 3; t += H) {
    c.step(H, { ...none, throttle: 0.4, steer: 1 }, open);
    if (t > 1) { latG = Math.max(latG, Math.abs(c.yawRate) * c.speed / 9.81); maxSlip = Math.max(maxSlip, c.slipAngle); }
  }
  check(`full lock at ${(v0 * 3.6) | 0} km/h: lateral accel <= 2.9 g, slip stays small`, latG < 2.9 && maxSlip < 0.3, `${latG.toFixed(2)} g, max slip ${(maxSlip * 57.3).toFixed(1)}°`);
}
{
  const c = bare(30); c.x = c.z = 0; let turned = 0, last = c.heading;
  for (let t = 0; t < 3; t += H) c.step(H, { ...none, throttle: 0.3, steer: -1 }, open);
  check('steering left yields positive yaw (heading increases)', c.heading > 0.3, `heading ${c.heading.toFixed(2)} rad`);
}

// --- 3. handbrake drift ------------------------------------------------------------------
{
  const c = bare(40);
  let slip = 0;
  for (let t = 0; t < 1.2; t += H) { c.step(H, { throttle: 0.6, brake: 0, steer: 1, handbrake: true, boost: false }, open); slip = Math.max(slip, c.slipAngle); }
  check('handbrake + steer produces a real drift (slip > 15°)', slip > 0.26, `${(slip * 57.3).toFixed(0)}°`);
  check('drift keeps most of the speed (> 55% of entry)', c.speed > 22, `${(c.speed * 3.6).toFixed(0)} km/h`);
  const b0 = c.boost; for (let t = 0; t < 0.8; t += H) c.step(H, { throttle: 0.6, brake: 0, steer: 0.5, handbrake: true, boost: false }, open);
  check('drifting charges nitro', c.boost > b0, `${b0.toFixed(2)} -> ${c.boost.toFixed(2)}`);
  for (let t = 0; t < 2; t += H) c.step(H, { ...none, throttle: 0.6 }, open);
  check('car regains grip after releasing handbrake (slip < 5°)', c.slipAngle < 0.09, `${(c.slipAngle * 57.3).toFixed(1)}°`);
}

// --- 4. braking + reverse ---------------------------------------------------------------
{
  const c = bare(50); let t = 0;
  while (c.vf > 1 && t < 10) { c.step(H, { ...none, brake: 1 }, open); t += H; }
  check('50 m/s -> 0 braking in 1.2-3 s', t > 1.2 && t < 3, `${t.toFixed(2)} s`);
  for (let k = 0; k < 4 / H; k++) c.step(H, { ...none, brake: 1 }, open);
  check('holding brake then reverses (about -13 m/s max)', c.vf < -8 && c.vf > -14, `${c.vf.toFixed(1)} m/s`);
  for (let k = 0; k < 3 / H; k++) c.step(H, { ...none, throttle: 1 }, open);
  check('throttle after reversing goes forward again', c.vf > 5, `${c.vf.toFixed(1)} m/s`);
  const d = bare(40); for (let k = 0; k < 20 / H; k++) d.step(H, none, open);
  check('coasting slows the car but never reverses it', d.vf >= 0 && d.vf < 25, `${d.vf.toFixed(1)} m/s after 20 s`);
}

// --- 5. off-road + walls --------------------------------------------------------------------
{
  const c = fresh(td.half + 3); // on grass
  for (let t = 0; t < 8; t += H) c.step(H, { ...none, throttle: 1, steer: -0.0 }, td);
  check('grass caps speed (< 0.7 of top)', c.speed < PHYS.topSpeed * 0.7 || Math.abs(c.lat) >= td.half + td.runoff - 1.2, `${(c.speed * 3.6).toFixed(0)} km/h`);

  const w = fresh(0); w.heading += 0.5; // aim into the left wall at ~30 degrees
  let maxImpact = 0, maxLat = 0, nan = false;
  w.vx = Math.sin(w.heading) * 45; w.vz = Math.cos(w.heading) * 45;
  for (let t = 0; t < 4; t += H) { w.step(H, { ...none, throttle: 1 }, td); maxImpact = Math.max(maxImpact, w.impact); maxLat = Math.max(maxLat, Math.abs(w.lat)); if (!isFinite(w.x + w.z + w.speed)) nan = true; w.impact = 0; }
  check('wall: car never passes through the barrier', maxLat <= td.half + td.runoff + 0.2, `max |lat| ${maxLat.toFixed(1)} (wall at ${td.half + td.runoff})`);
  check('wall: impact detected, state stays finite', maxImpact > 5 && !nan, `impact ${maxImpact.toFixed(1)} m/s`);
}

// --- 6. car/car collisions ---------------------------------------------------------------------
{
  const a = fresh(0), b = fresh(0); a.place(td, 5, -0.5); b.place(td, 5, 0.5);
  b.x += Math.sin(b.heading) * 3; b.z += Math.cos(b.heading) * 3;
  a.vx = Math.sin(a.heading) * 30; a.vz = Math.cos(a.heading) * 30;
  let minD = 99;
  for (let t = 0; t < 1.5; t += H) { a.step(H, { ...none, throttle: 1 }, td); b.step(H, none, td); collideCars([a, b]); minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z)); }
  check('cars bump instead of overlapping', minD > 1.8, `closest centre distance ${minD.toFixed(2)} m`);
}

// --- 7. AI laps every track cleanly -----------------------------------------------------------------
for (const def of TRACKS) {
  const T = buildTrackData(def), racing = buildRacingLine(T);
  const cars = [];
  for (let k = 0; k < 6; k++) {
    const sk = 0.9 + k * 0.012;
    const c = new CarBody(k, { topSpeed: PHYS.topSpeed * sk, accel: PHYS.accel * (0.94 + 0.06 * sk), gripMul: 0.97 + 0.03 * sk });
    const row = Math.floor(k / 2), col = k % 2 ? 1 : -1;
    c.place(T, T.N - Math.round((7 + row * 9 + (col > 0 ? 4.5 : 0)) / SPACING), col * 4.2);
    c.ai = makeAIState(sk, (k % 3 - 1) * 1.5); c.prog = c.q.idx + c.q.t - T.N; c.last = c.q.idx + c.q.t; c.tick = 0; c.inp = none; c.walls = 0; c.offT = 0; c.firstLap = null; c.stuckT = 0;
    cars.push(c);
  }
  let time = 0, limit = 400;
  while (time < limit && cars.some((c) => c.firstLap == null)) {
    for (const c of cars) {
      c.impact = 0; c.tick -= H;
      if (c.tick <= 0) { c.tick += 1 / 60; c.inp = aiDrive(c, T, racing, cars, 1, 1 / 60); }
      c.step(H, c.inp, T);
      if (c.contact) c.walls += H;
      if (!c.onRoad) c.offT += H;
    }
    collideCars(cars);
    for (const c of cars) {
      const cur = c.q.idx + c.q.t; let d = cur - c.last; if (d > T.N / 2) d -= T.N; else if (d < -T.N / 2) d += T.N; c.prog += d; c.last = cur;
      if (c.firstLap == null && c.prog >= T.N) c.firstLap = time;
    }
    time += H;
  }
  const done = cars.filter((c) => c.firstLap != null);
  const wallT = Math.max(...cars.map((c) => c.walls)), offT = Math.max(...cars.map((c) => c.offT));
  const best = Math.min(...done.map((c) => c.firstLap)), worst = Math.max(...done.map((c) => c.firstLap));
  check(`${def.id}: all 6 AI cars finish lap 1`, done.length === 6, `lap ${best.toFixed(1)}-${worst.toFixed(1)} s for ${(T.length / 1000).toFixed(2)} km, avg ${(T.length / best * 3.6).toFixed(0)} km/h`);
  check(`${def.id}: AI stays off the walls and the grass`, wallT < 1.5 && offT < 6, `worst wall contact ${wallT.toFixed(2)} s, worst off-road ${offT.toFixed(2)} s`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
