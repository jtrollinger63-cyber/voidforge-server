// Dynamics sanity numbers for every car on an unbounded flat plane: node scripts/vehicle-test.mjs [--verbose]
import { CARS, deriveSpec } from '../src/cars.js';
import { Vehicle } from '../src/vehicle.js';

const H = 1 / 120;
const flat = {
  N: 1000, half: 1e7, runoff: 1e7, shoulder: 3, tx: new Float32Array(1000).fill(0), tz: new Float32Array(1000).fill(1),
  nearest(x, z, h, w, out = {}) { out.idx = 0; out.t = 0; out.lat = 0; out.cy = 0; out.bank = 0; out.slope = 0; out.rx = 1; out.rz = 0; out.cx = x; out.cz = z; out.dist = 0; return out; },
  roadY() { return 0; },
};
const world = { td: flat, terrain: null, env: {} };
const none = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
const mk = (car, speed = 0) => { const v = new Vehicle(deriveSpec(car), 0); v.place({ N: 1000, px: [0], pz: [0], rx: [1], rz: [0], heading: [0], nearest: flat.nearest, roadY: () => 0 }, 0, 0); if (speed) { v.u = speed; v.setWorldVelocity(0, speed); v.gear = speed > 60 ? 6 : speed > 40 ? 5 : speed > 25 ? 4 : 3; } v.assist = 0; return v; };

let bad = 0;
const ok = (name, cond, info) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); };
for (const car of CARS) {
  console.log(`\n${car.name} (${car.cls}, ${car.hp} hp, ${car.mass} kg, ${car.drive}, target top ${car.topKmh} km/h)`);
  // acceleration
  const v = mk(car); let t100 = null, t200 = null, top = 0, tTop = null;
  for (let t = 0; t < 70; t += H) {
    v.step(H, { ...none, throttle: 1 }, world);
    const k = v.u * 3.6;
    if (t100 == null && k >= 100) t100 = t; if (t200 == null && k >= 200) t200 = t;
    if (k > top) { top = k; tTop = t; }
  }
  console.log(`  0-100 ${t100?.toFixed(2)} s, 0-200 ${t200?.toFixed(2)} s, top ${top.toFixed(0)} km/h @ ${tTop.toFixed(0)} s, gear ${v.gear}, rpm ${v.rpm.toFixed(0)}`);
  ok('0-100 between 1.8 and 6.5 s', t100 > 1.8 && t100 < 6.5, '');
  ok('top speed within 8% of target', Math.abs(top - car.topKmh * 1) / car.topKmh < 0.08, `${top.toFixed(0)} vs ${car.topKmh}`);
  // braking 100 km/h -> 0
  const b = mk(car, 100 / 3.6); let dist = 0, tb = 0;
  while (b.u > 0.5 && tb < 10) { b.step(H, { ...none, brake: 1 }, world); dist += b.u * H; tb += H; }
  console.log(`  100-0 in ${dist.toFixed(1)} m (${tb.toFixed(2)} s)`);
  ok('100-0 between 22 and 55 m', dist > 22 && dist < 55, '');
  // steady-state skidpad at 80 km/h: ramp the steering until the car holds a circle; report lateral g
  for (const kmh of [60, 120]) {
    let bestG = 0, bestSteer = 0;
    for (const st of [0.15, 0.25, 0.4, 0.6, 0.85, 1.0]) {
      const c = mk(car, kmh / 3.6); let gmax = 0;
      for (let t = 0; t < 4; t += H) {
        const hold = c.u < kmh / 3.6 - 0.2 ? 0.4 : 0;
        c.step(H, { ...none, throttle: hold + 0.05, steer: -st }, world);   // steer<0 = left
        if (t > 2) gmax = Math.max(gmax, Math.abs(c.r * c.u) / 9.81);
      }
      if (gmax > bestG) { bestG = gmax; bestSteer = st; }
    }
    console.log(`  skidpad ${kmh} km/h: max steady lateral ${bestG.toFixed(2)} g (steer ${bestSteer})`);
    ok(`lateral grip at ${kmh} km/h in 1.0-2.6 g`, bestG > 1.0 && bestG < 2.6, '');
  }
  // handbrake drift
  const d = mk(car, 22); let slipMax = 0, speedEnd;
  for (let t = 0; t < 1.6; t += H) { d.step(H, { ...none, throttle: 0.7, steer: -0.9, handbrake: t < 0.8 }, world); slipMax = Math.max(slipMax, d.driftAngle); }
  console.log(`  handbrake turn: max body slip ${(slipMax * 57.3).toFixed(0)} deg, exit speed ${(d.speed * 3.6).toFixed(0)} km/h`);
  ok('handbrake produces a visible slide (>14 deg)', slipMax > 0.25, '');
  // power oversteer test: floor it in 2nd gear mid-corner
  const p = mk(car, 14); p.gear = 2; let ps = 0;
  for (let t = 0; t < 2; t += H) { p.step(H, { ...none, throttle: 1, steer: -0.5 }, world); ps = Math.max(ps, p.driftAngle); }
  console.log(`  throttle-on in a corner: max slip ${(ps * 57.3).toFixed(0)} deg, rear wheelspin ${p.spinR.toFixed(2)}`);
  // no-input stability: does a car at speed with steering released recover (no spin)?
  const st = mk(car, 50); st.r = 0.25; for (let t = 0; t < 4; t += H) st.step(H, { ...none, throttle: 0.2 }, world);
  ok('recovers from a yaw disturbance (|slip| < 6 deg after 4 s)', st.driftAngle < 0.1, `${(st.driftAngle * 57.3).toFixed(1)} deg`);
}
console.log(bad ? `\n${bad} checks failed` : '\nall vehicle checks passed');
process.exit(bad ? 1 : 0);
