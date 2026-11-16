// Headless race simulation: every AI car laps every track with the real physics: node scripts/sim-test.mjs [--verbose]
import { TRACKS, ENVS } from '../src/tracks.js';
import { buildTrackData, SPACING } from '../src/trackmath.js';
import { createTerrain } from '../src/terrain.js';
import { gridSlot } from '../src/trackmesh.js';
import { CARS, deriveSpec } from '../src/cars.js';
import { Vehicle, collideVehicles } from '../src/vehicle.js';
import { aiDrive, buildRacingLine, makeAI } from '../src/ai.js';
import { DIFFICULTY } from '../src/save.js';

const H = 1 / 120, verbose = process.argv.includes('--verbose');
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`); if (!ok) failures++; };
const OFF = { coast: 'grass', neon: 'gravel', mountain: 'dirt', desert: 'sand', circuit: 'grass' };

const FIELDS = { sports: ['aurelia', 'brawler', 'ridgeback', 'aurelia', 'brawler', 'ridgeback'], fast: ['vantara', 'kestrel', 'helion', 'vantara', 'kestrel', 'helion'] };
for (const def of TRACKS) for (const [fname, field] of Object.entries(FIELDS)) {
  const env = { ...ENVS[def.env], id: def.env, offSurface: OFF[def.env] };
  const td = buildTrackData(def), terrain = createTerrain(td, def.env, env, 11 + def.env.length * 7), line = buildRacingLine(td);
  const world = { td, terrain, env };
  const diff = DIFFICULTY[1];
  const cars = [];
  for (let k = 0; k < 6; k++) {
    const car = CARS.find((c) => c.id === field[k]), v = new Vehicle(deriveSpec(car), k);
    const s = gridSlot(td, k); v.place(td, s.idx, s.lat); v.assist = 0.6; v.ai = makeAI(diff);
    v.prog = v.q.idx + v.q.t - td.N; v.last = v.q.idx + v.q.t; v.lapT = null; v.tick = 0; v.inp = null; v.wallT = 0; v.offT = 0; v.respawns = 0; v.name = car.name;
    cars.push(v);
  }
  let time = 0; const limit = 420;
  while (time < limit && cars.some((c) => c.lapT == null)) {
    for (const v of cars) {
      v.tick -= H;
      if (v.tick <= 0) {
        v.tick += 1 / 60;
        v.inp = aiDrive(v, v.ai, td, line, cars, { dt: 1 / 60, speedMul: 1, wet: !!env.wet, time });
        if (v.inp.respawn) { v.respawns++; const q = td.nearest(v.x, v.z, -1); v.place(td, q.idx, 0); }
      }
      v.step(H, v.inp, world);
      if (v.contact) v.wallT += H; if (!v.onRoad) v.offT += H;
    }
    collideVehicles(cars);
    for (const v of cars) {
      const cur = v.q.idx + v.q.t; let d = cur - v.last; if (d > td.N / 2) d -= td.N; else if (d < -td.N / 2) d += td.N; v.prog += d; v.last = cur;
      if (v.lapT == null && v.prog >= td.N) v.lapT = time;
    }
    time += H;
  }
  const done = cars.filter((c) => c.lapT != null);
  const best = Math.min(...done.map((c) => c.lapT)), worst = Math.max(...done.map((c) => c.lapT));
  const wall = Math.max(...cars.map((c) => c.wallT)), off = Math.max(...cars.map((c) => c.offT)), resp = cars.reduce((a, c) => a + c.respawns, 0);
  check(`${def.id}/${fname}: all 6 AI cars complete a lap`, done.length === 6, `${best.toFixed(1)}-${worst.toFixed(1)} s over ${(td.length / 1000).toFixed(2)} km (avg ${(td.length / best * 3.6).toFixed(0)} km/h)`);
  check(`${def.id}/${fname}: AI stays mostly clean (wall < 8 s, off-road < 16 s, <= 6 respawns)`, wall < 8 && off < 16 && resp <= 6, `wall ${wall.toFixed(1)} s, off ${off.toFixed(1)} s, respawns ${resp}`);
  if (verbose) for (const c of cars) console.log('   ', c.name.padEnd(12), c.lapT?.toFixed(1), 'wall', c.wallT.toFixed(1), 'off', c.offT.toFixed(1));
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
