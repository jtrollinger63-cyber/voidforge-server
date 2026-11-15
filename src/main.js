// Voidforge Racing - game bootstrap, race flow, camera, effects.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TRACKS, THEMES } from './tracks.js';
import { buildTrackData, SPACING } from './trackmath.js';
import { buildTrackMeshes, buildGridMarks } from './track.js';
import { buildWorld } from './world.js';
import { CarBody, buildCarModel, collideCars, PHYS, clamp, lerp, wrapAngle } from './car.js';
import { aiDrive, buildRacingLine, makeAIState } from './ai.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { SkidMarks, Particles } from './fx.js';
import { HUD, drawTrackPreview, buildResults, ordinal } from './hud.js';
import { fmtTime } from './util.js';

// ------------------------------------------------------------------------------------------
// constants & persistence
// ------------------------------------------------------------------------------------------
const COLORS = [
  ['Red', 0xe5232a], ['Blue', 0x1f6fff], ['Yellow', 0xffc21a], ['Green', 0x22c55e],
  ['Violet', 0x9b5cff], ['Orange', 0xff7a1a], ['White', 0xf2f4f8], ['Pink', 0xff5fa8],
];
const AI_NAMES = ['Vex', 'Nova', 'Blaze', 'Rook', 'Echo', 'Zed', 'Kira', 'Juno'];
const NCARS = 6;
const PLAYER_SLOT = 4;           // starts 5th of 6
const FIXED = 1 / 240;           // physics step
const DIFF = [{ lo: 0.84, hi: 0.92, rb: 1 }, { lo: 0.9, hi: 0.975, rb: 1 }, { lo: 0.955, hi: 1.02, rb: 0.5 }];
const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });
const GEAR_TH = [0, 17, 30, 42, 52, 61, 82];

const store = {
  get(k, d) { try { const v = localStorage.getItem('vf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vf.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const params = new URLSearchParams(location.search);
const settings = {
  track: clamp(+(params.get('track') ?? store.get('track', 0)) | 0, 0, TRACKS.length - 1),
  laps: +(params.get('laps') ?? store.get('laps', 3)) | 0 || 3,
  diff: clamp(+(params.get('diff') ?? store.get('diff', 1)) | 0, 0, 2),
  color: clamp(+store.get('color', 0) | 0, 0, COLORS.length - 1),
};

// ------------------------------------------------------------------------------------------
// renderer
// ------------------------------------------------------------------------------------------
const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('loading').textContent = 'WebGL is not available in this browser.';
  throw e;
}
let pixelRatio = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(65, 1, 0.4, 6000);
function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const hud = new HUD();
const input = new Input();
const audio = new AudioEngine();
audio.muted = !!store.get('muted', false);

// ------------------------------------------------------------------------------------------
// game state
// ------------------------------------------------------------------------------------------
const TD = TRACKS.map((t) => buildTrackData(t));
const G = {
  state: 'menu',      // menu | countdown | racing | finished
  paused: false,
  td: null, theme: null, def: null, racing: null,
  raceTime: 0, cd: 0, introT: 0, laps: 3,
  playerInput: NEUTRAL, events: [],
  wrongT: 0, shake: 0, boostFx: 0, simTime: 0, resultsAt: 0, resultsShown: false, newRecord: false,
};
let scene, world, skid, parts, spot, gridGroup;
let cars = [], player = null;
const cam = { angle: 0, mode: 0, fov: 62, pos: new THREE.Vector3(), look: new THREE.Vector3() };
let acc = 0, lastT = performance.now();

// ------------------------------------------------------------------------------------------
// track / scene loading
// ------------------------------------------------------------------------------------------
function disposeScene(s) {
  s.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      }
    }
  });
}

function gridSlot(td, k) {
  const row = Math.floor(k / 2), col = k % 2 ? 1 : -1;
  const dist = 7 + row * 9 + (col > 0 ? 4.5 : 0);
  return { idx: td.N - Math.round(dist / SPACING), lat: col * 4.2 };
}

function loadTrack(idx) {
  if (scene) disposeScene(scene);
  settings.track = idx;
  const def = TRACKS[idx], theme = THEMES[def.theme], td = TD[idx];
  G.def = def; G.theme = theme; G.td = td;
  G.racing = buildRacingLine(td);

  scene = new THREE.Scene();
  scene.environment = envTex;
  scene.environmentIntensity = theme.envIntensity;
  renderer.toneMappingExposure = theme.night ? 1.25 : 1.0;

  scene.add(buildTrackMeshes(td, theme, aniso).group);
  world = buildWorld(scene, renderer, td, theme);
  skid = new SkidMarks(scene);
  parts = new Particles(scene);
  hud.initMinimap(td);

  const slots = [];
  for (let k = 0; k < NCARS; k++) {
    const s = gridSlot(td, k), i = ((s.idx % td.N) + td.N) % td.N;
    slots.push({ x: td.px[i] + td.rx[i] * s.lat, z: td.pz[i] + td.rz[i] * s.lat, heading: td.heading[i] });
  }
  gridGroup = buildGridMarks(td, slots); scene.add(gridGroup);

  spot = null;
  if (theme.night) {
    spot = new THREE.SpotLight(0xfff1d6, 5200, 150, 0.46, 0.7, 2);
    scene.add(spot, spot.target);
  }
  createCars();
}

function createCars() {
  cars = [];
  const td = G.td, diff = DIFF[settings.diff];
  const playerColor = COLORS[settings.color][1];
  const palette = COLORS.map((c) => c[1]).filter((c) => c !== playerColor);
  let ai = 0;
  for (let k = 0; k < NCARS; k++) {
    const isPlayer = k === PLAYER_SLOT;
    let color, name, perf, aiState = null;
    if (isPlayer) { color = playerColor; name = 'You'; perf = {}; }
    else {
      color = palette[ai % palette.length]; name = AI_NAMES[ai % AI_NAMES.length];
      const f = ai / (NCARS - 2);                      // 0 = grid-front (fastest) .. 1 = slowest AI
      const sk = lerp(diff.hi, diff.lo, f * 0.85) + (Math.random() - 0.5) * 0.012;
      perf = { topSpeed: PHYS.topSpeed * sk, accel: PHYS.accel * (0.94 + 0.06 * sk), gripMul: 0.97 + 0.03 * sk };
      aiState = makeAIState(sk, (Math.random() - 0.5) * 5);
      ai++;
    }
    const c = new CarBody(k, perf);
    c.isPlayer = isPlayer; c.name = name; c.colorHex = color; c.colorCss = '#' + new THREE.Color(color).getHexString();
    c.ai = aiState || makeAIState(0.97, 0); c.auto = !isPlayer; c.aiTick = 0; c.aiInput = NEUTRAL;
    c.model = buildCarModel(color, { wing: k % 3 !== 1, stripe: k % 2 ? 0xf4f4f4 : 0x111111 });
    c.model.tail = c.model.tailMat.clone(); // per-car brake light
    c.model.root.traverse((o) => { if (o.material === c.model.tailMat) o.material = c.model.tail; });
    c.model.root.visible = true;
    c.skidPrev = [null, null]; c.fxT = 0; c.slot = k;
    scene.add(c.model.root);
    cars.push(c);
    if (isPlayer) player = c;
  }
  resetCars(false);
}

function resetCars(forRace) {
  const td = G.td;
  for (const c of cars) {
    const s = gridSlot(td, c.slot);
    c.place(td, s.idx, s.lat);
    c.boost = 0.35; c.impact = 0; c.finished = false; c.finishTime = null;
    const cur = c.q.idx + c.q.t;
    c.prog = cur - td.N; c.lastCur = cur; c.maxLap = -1;
    c.lapStart = 0; c.lastLap = null; c.bestLap = null; c.laps = [];
    c.skidPrev = [null, null]; c.aiTick = 0; c.aiInput = NEUTRAL; c.ai.stuck = 0; c.ai.avoid = 0;
    c.auto = !c.isPlayer || !forRace;
    c.rank = c.slot + 1;
    c.q = td.nearest(c.x, c.z, c.hint);
    applyVisuals(c, 0, true);
  }
  skid && skid.clear();
}

// ------------------------------------------------------------------------------------------
// race flow
// ------------------------------------------------------------------------------------------
function enterMenu() {
  G.state = 'menu'; G.paused = false;
  resetCars(false);
  for (const c of cars) c.auto = true;
  G.cd = 0;
  for (const id of ['pause', 'results']) document.getElementById(id).hidden = true;
  document.getElementById('menu').hidden = false;
  document.getElementById('touch').hidden = true;
  hud.show(false);
  audio.silence();
  refreshMenu();
}

function startRace() {
  document.getElementById('menu').hidden = true;
  document.getElementById('results').hidden = true;
  document.getElementById('pause').hidden = true;
  G.paused = false; G.laps = settings.laps;
  // rebuild cars so a changed difficulty / colour takes effect
  for (const c of cars) scene.remove(c.model.root);
  createCars();
  resetCars(true);
  G.state = 'countdown'; G.cd = 3.999; G.raceTime = 0; G.introT = 0;
  G.resultsShown = false; G.newRecord = false; G.wrongT = 0; G.shake = 0; G.events.length = 0; acc = 0;
  cam.mode = store.get('cam', 0);
  snapCamera();
  hud.show(true); hud.fadeHint(true); hud.centerHold('');
  hud.setRace(PLAYER_SLOT + 1, NCARS, 1, G.laps);
  hud.setTimes(0, null, store.get('best.' + G.def.id, null));
  document.getElementById('touch').hidden = !(input.usingTouch || matchMedia('(pointer: coarse)').matches);
  setTimeout(() => hud.fadeHint(false), 14000);
  lastBeep = 4;
}

let lastBeep = 4;
function updateCountdown(dt) {
  G.cd -= dt; G.introT += dt;
  const n = Math.ceil(G.cd);
  if (n !== lastBeep && n >= 1 && n <= 3) { lastBeep = n; hud.center(String(n)); audio.beep(440, 0.2); }
  if (G.cd <= 0) {
    G.state = 'racing'; G.raceTime = 0; lastBeep = 0;
    for (const c of cars) c.lapStart = 0;
    hud.center('GO!'); audio.beep(880, 0.45, 0.4); audio.whoosh();
  }
}

/** Unwrapped progress along the track (in samples) + lap bookkeeping. */
function trackProgress(c) {
  const N = G.td.N, q = c.q;
  const cur = q.idx + q.t;
  let d = cur - c.lastCur;
  if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
  c.prog += d; c.lastCur = cur;
  if (G.state !== 'racing' && G.state !== 'finished') return;
  const fl = Math.floor(c.prog / N);
  if (fl > c.maxLap) {
    c.maxLap = fl;
    if (fl === 0) { c.lapStart = G.raceTime; }
    else if (fl > 0) {
      const lt = G.raceTime - c.lapStart; c.lapStart = G.raceTime;
      c.laps.push(lt); c.lastLap = lt;
      if (c.bestLap == null || lt < c.bestLap) c.bestLap = lt;
      if (fl >= G.laps && !c.finished) { c.finished = true; c.finishTime = G.raceTime; G.events.push({ type: 'finish', car: c }); }
      else G.events.push({ type: 'lap', car: c, time: lt, lap: fl + 1 });
    }
  }
}

function rankCars() {
  const key = (c) => (c.finished ? 1e7 - c.finishTime : c.prog);
  const order = cars.slice().sort((a, b) => key(b) - key(a));
  order.forEach((c, i) => { c.rank = i + 1; });
  return order;
}

function simStep(h) {
  if (G.state === 'racing' || G.state === 'finished') G.raceTime += h;
  const td = G.td;
  const playerAhead = player ? player.prog : 0;
  for (const c of cars) {
    c.impact = 0;
    let inp;
    if (G.state === 'countdown') inp = NEUTRAL;
    else if (c.isPlayer && !c.auto) inp = G.playerInput;
    else {
      c.aiTick -= h;
      if (c.aiTick <= 0) {
        c.aiTick += 1 / 60;
        let mul = 1;
        if (!c.isPlayer && G.state !== 'menu') {
          const gap = (playerAhead - c.prog) * SPACING; // + means the player is ahead of this AI
          mul = 1 + clamp(gap / 450, -1, 1) * 0.055 * DIFF[settings.diff].rb;
        }
        c.aiInput = aiDrive(c, td, G.racing, cars, mul, 1 / 60);
      }
      inp = c.aiInput;
    }
    c.step(h, inp, td);
  }
  collideCars(cars);
  for (const c of cars) trackProgress(c);
  G.simTime += h;
}

function handleEvents() {
  while (G.events.length) {
    const e = G.events.shift(), c = e.car;
    if (!c.isPlayer) continue;
    if (e.type === 'lap') {
      const best = store.get('best.' + G.def.id, null);
      let msg = `LAP ${e.lap - 1} · ${fmtTime(e.time)}`;
      if (best == null || e.time < best) { store.set('best.' + G.def.id, e.time); msg += " · ★ NEW RECORD"; G.newRecord = true; }
      hud.toast(msg, 2800);
      if (e.lap === G.laps) hud.center('FINAL LAP', 'warn');
    } else if (e.type === 'finish') {
      const best = store.get('best.' + G.def.id, null);
      if (c.bestLap != null && (best == null || c.bestLap < best)) { store.set('best.' + G.def.id, c.bestLap); G.newRecord = true; }
      G.state = 'finished'; c.auto = true; c.ai.stuck = 0;
      G.resultsAt = performance.now() + 1800;
      hud.center(c.rank === 1 ? 'WINNER!' : 'FINISH!');
      audio.beep(660, 0.3); setTimeout(() => audio.beep(990, 0.5), 220);
    }
  }
}

function showResults() {
  G.resultsShown = true;
  document.getElementById('touch').hidden = true;
  const el = document.getElementById('results'); el.hidden = false;
  refreshResults();
}

function refreshResults() {
  const order = rankCars();
  const rows = order.map((c) => ({
    name: c.name, color: c.colorCss, me: c.isPlayer, best: c.bestLap, time: c.finished ? c.finishTime : null,
    gap: `Lap ${clamp(c.maxLap + 1, 1, G.laps)}/${G.laps}`,
  }));
  buildResults(rows, G.laps);
  const p = player.rank;
  document.getElementById('resTitle').textContent = p === 1 ? '🏆 VICTORY!' : `${ordinal(p)} PLACE`;
  document.getElementById('resSub').innerHTML = `${G.def.name} · ${G.laps} lap${G.laps > 1 ? 's' : ''}` +
    (player.bestLap ? ` · best lap ${fmtTime(player.bestLap)}` : '') + (G.newRecord ? ' <span class="newbest">· NEW TRACK RECORD</span>' : '');
}

// ------------------------------------------------------------------------------------------
// visuals
// ------------------------------------------------------------------------------------------
const REAR = [[-0.96, -1.38], [0.96, -1.38]];
function wheelWorld(c, lx, lz, out) {
  const s = Math.sin(c.heading), co = Math.cos(c.heading);
  out.x = c.x + lx * co + lz * s; out.z = c.z - lx * s + lz * co;
}
const tmpW = { x: 0, z: 0 };

function applyVisuals(c, dt, snap = false) {
  const m = c.model;
  m.root.position.set(c.x, 0, c.z);
  m.root.rotation.y = c.heading;
  const k = snap ? 1 : Math.min(1, 9 * dt);
  const roll = clamp(c.yawRate * c.vf * 0.0042, -0.07, 0.07);
  const pitch = clamp(-c.accelLong * 0.0028, -0.05, 0.05);
  m.body.rotation.z += (roll - m.body.rotation.z) * k;
  m.body.rotation.x += (pitch - m.body.rotation.x) * k;
  m.body.position.y = !c.onRoad && c.speed > 10 ? Math.sin(G.simTime * 55 + c.id) * 0.03 : 0;
  const spin = (c.vf * dt) / 0.37;
  for (const w of m.wheels) w.rotation.x += spin;
  for (const p of m.frontPivots) p.rotation.y = -c.steer * 0.5;
  const braking = c.brakeIn > 0 && c.vf > 0.5;
  m.tail.color.setHex(braking ? 0xff4040 : 0x701212);
  for (const f of m.flames) {
    f.visible = c.boosting;
    if (c.boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.7);
  }
}

function effects(c, dt, camPos) {
  // skid marks
  for (let w = 0; w < 2; w++) {
    wheelWorld(c, REAR[w][0], REAR[w][1], tmpW);
    if (c.skid > 0.12) {
      const p = c.skidPrev[w];
      if (p) skid.add(p.x, p.z, tmpW.x, tmpW.z, 0.3 + c.skid * 0.12);
      c.skidPrev[w] = { x: tmpW.x, z: tmpW.z };
    } else c.skidPrev[w] = null;
  }
  const near = c.isPlayer || Math.hypot(c.x - camPos.x, c.z - camPos.z) < 90;
  if (!near) return;
  c.fxT -= dt;
  if (c.fxT > 0) return;
  c.fxT = 0.03;
  for (let w = 0; w < 2; w++) {
    wheelWorld(c, REAR[w][0], REAR[w][1], tmpW);
    const r = () => (Math.random() - 0.5);
    if (c.skid > 0.25) parts.spawn(tmpW.x, 0.3, tmpW.z, r() * 1.2 + c.vx * 0.05, 0.9 + Math.random(), r() * 1.2 + c.vz * 0.05, '#e9eaee', 1.2 + c.skid, 1.0, 0.38 * c.skid, 2.4);
    else if (!c.onRoad && c.speed > 9) parts.spawn(tmpW.x, 0.3, tmpW.z, r() * 2 - c.vx * 0.06, 1.0 + Math.random(), r() * 2 - c.vz * 0.06, G.theme.dust, 1.5, 0.9, 0.45, 2.2);
  }
  if (c.contact && c.speed > 8) {
    for (let i = 0; i < 2; i++) parts.spawn(c.x + (Math.random() - 0.5) * 2, 0.5, c.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 2 + Math.random() * 2, (Math.random() - 0.5) * 6, '#ffb347', 0.45, 0.35, 0.95, 0.2);
  }
  if (c.boosting) {
    for (const sx of [-0.5, 0.5]) {
      const s = Math.sin(c.heading), co = Math.cos(c.heading);
      parts.spawn(c.x + sx * co - 2.4 * s, 0.5, c.z - sx * s - 2.4 * co, -c.vx * 0.1, 0.1, -c.vz * 0.1, '#7fd8ff', 0.9, 0.35, 0.6, 1.2);
    }
  }
}

function snapCamera() {
  cam.angle = player.heading - 0.0;
  updateCamera(0.016, player, cam.mode, true);
}

function updateCamera(dt, car, mode, snap = false) {
  const spd = car.speed, sp01 = clamp(spd / 68, 0, 1);
  const vang = spd > 5 ? Math.atan2(car.vx, car.vz) : car.heading;
  // chase direction: heading blended with the velocity vector, so drifts look right
  const aim = car.heading + wrapAngle(vang - car.heading) * 0.35;
  const k = snap ? 1 : 1 - Math.exp(-(mode === 2 ? 14 : 6) * dt);
  cam.angle += wrapAngle(aim - cam.angle) * k;

  let intro = 0;
  if (G.state === 'countdown') { intro = 1 - clamp(G.introT / 3, 0, 1); intro *= intro; }
  const a = cam.angle + intro * 1.1;
  let dist, height, lookAhead, fovT;
  if (mode === 2) { dist = -1.1; height = 1.25; lookAhead = 30; fovT = 76 + sp01 * 14; }
  else if (mode === 1) { dist = 11.5; height = 4.6; lookAhead = 8; fovT = 58 + sp01 * 18; }
  else { dist = 7.4 + spd * 0.015; height = 2.9 + sp01 * 0.5; lookAhead = 7; fovT = 60 + sp01 * 18; }
  dist += intro * 5; height += intro * 1.6;
  fovT += G.boostFx * 12;

  const sx = Math.sin(a), cz = Math.cos(a);
  const target = new THREE.Vector3(car.x - sx * dist, Math.max(height, 0.7), car.z - cz * dist);
  const shakeAmt = G.shake * 0.5 + (!car.onRoad ? Math.min(0.06, spd * 0.0012) : 0) + sp01 * sp01 * 0.012 + G.boostFx * 0.03;
  target.x += (Math.random() - 0.5) * shakeAmt; target.y += (Math.random() - 0.5) * shakeAmt; target.z += (Math.random() - 0.5) * shakeAmt;
  cam.pos.copy(target);
  camera.position.copy(cam.pos);
  cam.look.set(car.x + Math.sin(a) * lookAhead, mode === 2 ? 1.1 : 1.35, car.z + Math.cos(a) * lookAhead);
  camera.lookAt(cam.look);
  cam.fov += (fovT - cam.fov) * (snap ? 1 : 1 - Math.exp(-4 * dt));
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  G.shake = Math.max(0, G.shake - dt * 2.5);
}

function updateMenuCamera(dt) {
  const lead = rankCars()[0];
  const t = G.simTime;
  const aim = lead.heading + Math.sin(t * 0.35) * 1.15 + 0.5;
  cam.angle += wrapAngle(aim - cam.angle) * (1 - Math.exp(-3 * dt));
  const d = 10 + Math.sin(t * 0.23) * 3;
  camera.position.set(lead.x - Math.sin(cam.angle) * d, 3.4 + Math.sin(t * 0.3) * 1.2, lead.z - Math.cos(cam.angle) * d);
  camera.lookAt(lead.x, 1.0, lead.z);
  if (Math.abs(camera.fov - 58) > 0.01) { camera.fov = 58; camera.updateProjectionMatrix(); }
}

function gearInfo(v, rev) {
  if (rev) return { g: 'R', rpm: 0.3 };
  let g = 1; while (g < 6 && v > GEAR_TH[g]) g++;
  const lo = GEAR_TH[g - 1], hi = GEAR_TH[g];
  return { g: String(g), rpm: 0.22 + 0.78 * clamp((v - lo) / (hi - lo), 0, 1) };
}

// ------------------------------------------------------------------------------------------
// menu wiring
// ------------------------------------------------------------------------------------------
function refreshMenu() {
  document.querySelectorAll('#tracks .card').forEach((el, i) => {
    el.classList.toggle('on', i === settings.track);
    const best = store.get('best.' + TRACKS[i].id, null);
    el.querySelector('.rec').textContent = best ? `Record ${fmtTime(best)}` : 'No record yet';
  });
  document.querySelectorAll('#lapsSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === settings.laps));
  document.querySelectorAll('#diffSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === settings.diff));
  document.querySelectorAll('#colors .sw').forEach((b, i) => b.classList.toggle('on', i === settings.color));
}

function buildMenu() {
  const box = document.getElementById('tracks');
  TRACKS.forEach((t, i) => {
    const b = document.createElement('button'); b.className = 'card';
    b.innerHTML = `<canvas></canvas><div><b>${t.name}</b><small>${(TD[i].length / 1000).toFixed(1)} km · ${t.blurb}</small><small class="rec"></small></div>`;
    drawTrackPreview(b.querySelector('canvas'), TD[i]);
    b.onclick = () => { if (settings.track !== i) { loadTrack(i); enterMenu(); } store.set('track', i); };
    box.appendChild(b);
  });
  const sw = document.getElementById('colors');
  COLORS.forEach(([name, hex], i) => {
    const b = document.createElement('button'); b.className = 'sw'; b.title = name; b.style.background = '#' + new THREE.Color(hex).getHexString();
    b.onclick = () => { settings.color = i; store.set('color', i); player.model.paint.color.setHex(hex); player.colorHex = hex; refreshMenu(); };
    sw.appendChild(b);
  });
  document.querySelectorAll('#lapsSeg button').forEach((b) => { b.onclick = () => { settings.laps = +b.dataset.v; store.set('laps', settings.laps); refreshMenu(); }; });
  document.querySelectorAll('#diffSeg button').forEach((b) => { b.onclick = () => { settings.diff = +b.dataset.v; store.set('diff', settings.diff); refreshMenu(); }; });
  document.getElementById('go').onclick = () => { audio.init(); startRace(); };
  document.getElementById('again').onclick = () => { audio.init(); startRace(); };
  document.getElementById('toMenu').onclick = () => { enterMenu(); };
  document.getElementById('resume').onclick = () => setPaused(false);
  document.getElementById('restart').onclick = () => startRace();
  document.getElementById('quit').onclick = () => enterMenu();
  // touch controls
  input.bindTouch(document.getElementById('tLeft'), 'left');
  input.bindTouch(document.getElementById('tRight'), 'right');
  input.bindTouch(document.getElementById('tGas'), 'gas');
  input.bindTouch(document.getElementById('tBrake'), 'brake');
  input.bindTouch(document.getElementById('tBoost'), 'boost');
  input.bindTouch(document.getElementById('tHand'), 'hand');
  input.bindTouch(document.getElementById('tCam'), null, 'camera');
  input.bindTouch(document.getElementById('tPause'), null, 'pause');
}

function setPaused(p) {
  if (G.state !== 'countdown' && G.state !== 'racing' && G.state !== 'finished') return;
  if (G.state === 'finished' && G.resultsShown) return;
  G.paused = p;
  document.getElementById('pause').hidden = !p;
  if (p) audio.silence();
  lastT = performance.now();
}

// ------------------------------------------------------------------------------------------
// main loop
// ------------------------------------------------------------------------------------------
let fpsAcc = 0, fpsN = 0, fpsCheck = 0;
const camPos = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0001, (now - lastT) / 1000)); lastT = now;
  if (!scene) return;

  // actions
  if (input.consume('mute')) { audio.setMuted(!audio.muted); store.set('muted', audio.muted); hud.toast(audio.muted ? 'Sound off' : 'Sound on', 1200); }
  if (input.consume('pause')) { if (G.state !== 'menu') setPaused(!G.paused); }
  if (input.consume('confirm') && G.state === 'menu') { audio.init(); startRace(); }
  const racingNow = G.state === 'countdown' || G.state === 'racing' || G.state === 'finished';
  if (racingNow && !G.paused) {
    if (input.consume('camera')) { cam.mode = (cam.mode + 1) % 3; store.set('cam', cam.mode); hud.toast(['Chase camera', 'Far camera', 'Hood camera'][cam.mode], 1100); }
    if (input.consume('reset') && G.state !== 'countdown') { player.resetToTrack(G.td); player.boost = Math.max(0, player.boost - 0.2); skid.clear(); }
  } else { input.pressed.delete('camera'); input.pressed.delete('reset'); }

  if (!G.paused) {
    G.playerInput = input.update();
    if (G.state === 'countdown') updateCountdown(dt);
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 14) { simStep(FIXED); acc -= FIXED; n++; }
    if (n >= 14) acc = 0;
    handleEvents();
    stepFrame(dt);
  }

  const focus = G.focus || player;
  world.update(camera, focus.x, focus.z);
  if (spot) {
    spot.position.set(focus.x + Math.sin(focus.heading) * 1.8, 1.0, focus.z + Math.cos(focus.heading) * 1.8);
    spot.target.position.set(focus.x + Math.sin(focus.heading) * 40, 0, focus.z + Math.cos(focus.heading) * 40);
    spot.target.updateMatrixWorld();
  }
  skid.flush();
  renderer.render(scene, camera);

  // adaptive resolution: protect frame rate on slow GPUs
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 0.026 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
    else if (avg < 0.0135 && pixelRatio < Math.min(devicePixelRatio || 1, 2) - 0.01) { pixelRatio = Math.min(Math.min(devicePixelRatio || 1, 2), pixelRatio + 0.25); resize(); }
  }
}

/** Everything that runs once per rendered frame (not per physics step). */
function stepFrame(dt) {
  const td = G.td;
  const order = rankCars();
  camera.getWorldPosition(camPos);
  for (const c of cars) { applyVisuals(c, dt); effects(c, dt, camPos); if (c.impact > 3) { if (c.isPlayer) { G.shake = Math.min(1, G.shake + c.impact / 20); audio.thump(c.impact); hud.damage(c.impact / 25); } else if (Math.hypot(c.x - player.x, c.z - player.z) < 40) audio.thump(c.impact * 0.5); } }
  parts.update(dt);

  if (G.state === 'menu') { G.focus = order[0]; updateMenuCamera(dt); return; }
  G.focus = player;

  // boost effect smoothing
  G.boostFx += ((player.boosting ? 1 : 0) - G.boostFx) * Math.min(1, 6 * dt);
  if (player.boosting && !G._wasBoost) audio.whoosh();
  G._wasBoost = player.boosting;

  updateCamera(dt, player, cam.mode);

  // HUD
  const lapNow = clamp(player.maxLap + 1, 1, G.laps);
  hud.setRace(player.rank, NCARS, lapNow, G.laps);
  const t = G.state === 'countdown' ? 0 : (player.finished ? player.finishTime : Math.max(0, G.raceTime - player.lapStart));
  hud.setTimes(player.maxLap < 0 ? 0 : t, player.lastLap, player.bestLap ?? store.get('best.' + G.def.id, null));
  const gi = gearInfo(Math.abs(player.vf), player.vf < -0.5);
  const kmh = Math.round(Math.abs(player.vf) * 3.6);
  hud.setSpeed(kmh, player.speed < 0.5 && player.throttle === 0 ? 'N' : gi.g, gi.rpm, player.boost, player.boosting, clamp(player.speed / 68, 0, 1.3));
  hud.drawMinimap(cars, player.id);

  // wrong way
  const q = player.q;
  const dot = Math.sin(player.heading) * td.tx[q.idx] + Math.cos(player.heading) * td.tz[q.idx];
  G.wrongT = (dot < -0.35 && player.speed > 4 && G.state === 'racing') ? G.wrongT + dt : Math.max(0, G.wrongT - dt * 3);
  if (G.wrongT > 0.8) hud.centerHold('WRONG WAY', 'warn'); else if (G.wrongT === 0 && hud.el.center.className === 'warn') hud.centerHold('');

  // audio
  const gi2 = gearInfo(Math.abs(player.vf), player.vf < -0.5);
  audio.update({
    speed: player.speed, top: PHYS.topSpeed, throttle: G.state === 'racing' ? player.throttle : 0.15, rpm: gi2.rpm,
    skid: player.skid * (player.speed > 6 ? 1 : 0) + (player.contact ? 0.5 : 0), boosting: player.boosting, offroad: !player.onRoad, active: true,
  });

  if (G.state === 'finished' && !G.resultsShown && performance.now() > G.resultsAt) showResults();
  if (G.resultsShown) { G.refreshT = (G.refreshT || 0) - dt; if (G.refreshT <= 0) { G.refreshT = 0.5; refreshResults(); } }
}

// ------------------------------------------------------------------------------------------
// boot
// ------------------------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => { if (document.hidden && (G.state === 'racing' || G.state === 'countdown')) setPaused(true); });
canvas.addEventListener('pointerdown', () => canvas.focus());

buildMenu();
loadTrack(settings.track);
enterMenu();
document.getElementById('loading').hidden = true;
requestAnimationFrame((t) => { lastT = t; frame(t); });

// Test / debug hooks (also used by scripts/smoke.mjs).
window.__vf = {
  G, settings, cam, get cars() { return cars; }, get player() { return player; },
  loadTrack, startRace, enterMenu, rankCars,
  /** Advance the simulation by `sec` seconds without rendering. */
  advance(sec) {
    const n = Math.round(sec / FIXED);
    for (let i = 0; i < n; i++) {
      if (G.state === 'countdown') { G.cd -= FIXED; if (G.cd <= 0) { G.state = 'racing'; G.raceTime = 0; } }
      simStep(FIXED);
    }
    handleEvents(); rankCars(); for (const c of cars) applyVisuals(c, 0, true);
    if (G.state !== 'menu') updateCamera(0.016, player, cam.mode, true);
    G.shake = 0;
  },
  setCamMode(m) { cam.mode = m; },
  autopilot(on) { player.auto = on; },
};
if (params.has('autopilot')) { startRace(); player.auto = true; }
