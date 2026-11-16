// Game: owns the renderer, the active world, cars, race rules, modes, replay, effects and audio wiring.
import * as THREE from 'three';
import { TRACKS, TRACK_BY_ID } from './tracks.js';
import { SPACING } from './trackmath.js';
import { CARS, CAR_BY_ID, PAINTS, deriveSpec } from './cars.js';
import { Vehicle, collideVehicles, clamp, lerp, wrapAngle } from './vehicle.js';
import { buildCar, updateCar } from './carmodel.js';
import { gridSlot } from './trackmesh.js';
import { buildWorld } from './world.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { Post, PRESETS, ResolutionGovernor } from './post.js';
import { Particles, SkidMarks, SpeedStreaks } from './fx.js';
import { aiDrive, buildRacingLine, makeAI } from './ai.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Save, DIFFICULTY, DRIFT_MEDALS, POINTS } from './save.js';

const FIXED = 1 / 120;
const NAMES = ['Vex', 'Nova', 'Blaze', 'Rook', 'Echo', 'Zed', 'Kira', 'Juno', 'Axel', 'Mira', 'Sable', 'Torque'];
const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });
const sleep = (ms = 16) => new Promise((r) => setTimeout(r, ms));
const hexRGB = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

export class Game {
  constructor(canvas) {
    this.canvas = canvas; this.listeners = {};
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, 7000);
    this.rig = new CameraRig(this.camera, {}); this.scene = new THREE.Scene(); this.scene.add(this.camera);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.input = new Input(); this.audio = new Audio(); this.gov = new ResolutionGovernor();
    this.state = 'boot'; this.paused = false; this.time = 0; this.acc = 0;
    this.world = null; this.cars = []; this.player = null; this.cfg = null; this.fx = null; this.hudData = {};
    this.pr = 1; this.maxPr = 1; this.preset = PRESETS.high; this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.focusCar = null; this.tunnel = 0; this.lightF = 0; this.menuOrbit = 0; this.cineT = 0;
    this.msgs = []; this.replay = null; this.rec = null; this.ghost = null; this.garage = null; this.q = {};
    addEventListener('resize', () => this.resize()); this.last = performance.now();
    this.applySettings();
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); return this; }
  emit(name, data) { for (const f of this.listeners[name] || []) f(data); }

  // ---------------------------------------------------------------------------------------------- settings / sizing
  applySettings() {
    const S = Save.settings; const preset = PRESETS[S.quality] || PRESETS.high; this.preset = preset;
    this.renderer.shadowMap.enabled = preset.shadow > 0 && S.shadows;
    this.maxPr = Math.min(window.devicePixelRatio || 1, preset.pr) * S.resScale; this.pr = Math.min(this.pr || this.maxPr, this.maxPr) || this.maxPr; if (this.pr < 0.6) this.pr = this.maxPr;
    this.renderer.setPixelRatio(this.pr);
    this.rig.settings.shake = S.camShake; this.rig.settings.fov = S.fov; this.rig.settings.motion = S.motion;
    this.audio.setVolumes({ master: S.master, music: S.music, sfx: S.sfx, engine: S.engine });
    this.post.build(preset, { bloom: S.bloom, motionBlur: S.motionBlur });
    this.resize();
    if (this.world) { this.world.lighting.sun.castShadow = this.renderer.shadowMap.enabled; }
    this.input.steerSens = S.steerSens; this.input.tilt = S.tilt;
    if (this.player) this.player.veh.assist = S.assist;
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setPixelRatio(this.pr); this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post.setSize(w, h); if (this.fx) this.fx.particles.setScale(h * this.pr, this.camera.fov);
    if (this.garage) this.garage.resize(w, h);
    this.w = w; this.h = h;
  }

  // ---------------------------------------------------------------------------------------------- world / session
  async loadWorld(trackId, onProgress) {
    this.unload();
    const def = TRACK_BY_ID[trackId];
    const prog = (label) => { onProgress && onProgress(label); return sleep(24); };
    let step = 0; const steps = ['Surveying the road', 'Sculpting terrain', 'Lighting the sky', 'Laying asphalt', 'Planting scenery'];
    this.world = buildWorld(this.renderer, def, this.preset, { aniso: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()), onProgress: () => {} });
    for (const s of steps) await prog(s);
    const W = this.world;
    this.scene = W.scene; this.scene.add(this.camera); this.post.setScene(W.scene); this.post.setGrade(W.env.grade); this.renderer.toneMappingExposure = W.env.exposure;
    this.rig.setWorld({ td: W.td, terrain: W.terrain });
    this.line = buildRacingLine(W.td);
    this.fx = { particles: new Particles(W.scene, this.preset.particles), skid: new SkidMarks(W.scene), streaks: new SpeedStreaks(this.camera) };
    this.fx.particles.setScale((this.h || 720) * this.pr, this.camera.fov);
    this.gate = this.buildGate(W.scene); this.world.lighting.sun.castShadow = this.renderer.shadowMap.enabled;
    this.trackId = trackId; this.def = def;
    return W;
  }
  unload() {
    for (const c of this.cars) { this.audio.ready && c.voice && this.audio.killEngine(c.voice); c.model && c.model.dispose(); }
    this.cars = []; this.player = null; this.ghost = null;
    if (this.fx) { this.fx.particles.dispose(); this.fx.skid.dispose(); this.fx.streaks.dispose(); this.fx = null; }
    if (this.world) { this.world.dispose(); this.world = null; }
  }

  buildGate(scene) {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x25e6ff, transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const w = 8.5;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.35), mat); p.position.set(s * w, 3.5, 0); g.add(p); }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.35, 0.35, 0.35), mat); arch.position.y = 7; g.add(arch);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 7), new THREE.MeshBasicMaterial({ color: 0x25e6ff, transparent: true, opacity: 0.07, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); sheet.position.y = 3.5; g.add(sheet);
    g.visible = false; scene.add(g); return g;
  }

  carLook(carId) { const c = CAR_BY_ID[carId], s = Save.setup(carId); return { paint: s.paint, finish: s.finish, rim: s.rim, rimColor: s.rimColor, brake: c.brake }; }

  makeEntity(carId, { isPlayer, name, paint, upgrades, slot, aiParams }) {
    const car = CAR_BY_ID[carId], spec = deriveSpec(car, upgrades || {});
    const look = isPlayer ? this.carLook(carId) : { paint, finish: ['gloss', 'metallic', 'pearl'][(Math.random() * 3) | 0], rim: car.rim, rimColor: ['#e4e8ee', '#2c2f36', '#d4a43a'][(Math.random() * 3) | 0], brake: car.brake };
    const veh = new Vehicle(spec, this.cars.length);
    const model = buildCar(spec, look, { detail: true });
    this.world.scene.add(model.root);
    const e = { id: veh.id, veh, model, name, isPlayer, look, carId, color: look.paint, ai: aiParams || null, slot, input: NEUTRAL, tick: 0, signal: 0, voice: null, prog: 0, lastCur: 0, maxLap: -1, lapStart: 0, laps: [], best: null, last: null,
      finished: false, finishTime: null, rank: slot + 1, lastRank: slot + 1, cpNext: 1, splitStart: 0, splits: [], hits: 0, hitsLap: 0, overtakes: 0, respawns: 0, distance: 0, off: 0, dist2cam: 0 };
    veh.assist = isPlayer ? Save.settings.assist : 0.6;
    return e;
  }

  /** Create everything for a session and place cars on the grid. */
  setupCars(cfg) {
    const W = this.world, td = W.td, list = [];
    const playerSetup = Save.setup(cfg.carId);
    this.player = this.makeEntity(cfg.carId, { isPlayer: true, name: 'YOU', upgrades: playerSetup.upgrades, slot: 0 });
    list.push(this.player);
    const nAI = cfg.mode === 'race' || cfg.mode === 'cup' ? cfg.aiCount : 0;
    if (nAI) {
      const diff = DIFFICULTY[cfg.diff], pPI = this.player.veh.spec.pi;
      const pool = CARS.slice().sort((a, b) => Math.abs(deriveSpec(a).pi - pPI) - Math.abs(deriveSpec(b).pi - pPI));
      const paints = PAINTS.map((p) => p[1]).filter((c) => c !== playerSetup.paint).sort(() => Math.random() - 0.5);
      const names = cfg.aiNames ? cfg.aiNames.slice() : NAMES.slice().sort(() => Math.random() - 0.5);
      for (let k = 0; k < nAI; k++) {
        const car = pool[k % Math.min(4, pool.length)];
        const e = this.makeEntity(car.id, { isPlayer: false, name: names[k], paint: paints[k % paints.length], slot: k + 1, aiParams: makeAI(diff) });
        list.push(e);
      }
    }
    // grid: AI take the front, the player starts mid-back; free modes start on the line
    const order = list.map((e, i) => i);
    if (nAI) { const pSlot = Math.min(nAI, 4); order.length = 0; let ai = 1; for (let s = 0; s < list.length; s++) order.push(s === pSlot ? 0 : ai++); }
    list.forEach((e, i) => { e.slot = order.indexOf(i); });
    for (const e of list) {
      const s = cfg.mode === 'race' || cfg.mode === 'cup' ? gridSlot(td, e.slot) : cfg.mode === 'free' || cfg.mode === 'drift' ? { idx: 3, lat: 0 } : { idx: td.N - Math.round(8 / SPACING), lat: 0 };
      e.veh.place(td, s.idx, s.lat); e.veh.held = true;
      e.model.root.visible = true; e.prog = e.veh.q.idx + e.veh.q.t - td.N; e.lastCur = e.veh.q.idx + e.veh.q.t; e.rank = e.slot + 1; e.lastRank = e.rank;
      e.model.root.position.set(e.veh.x, e.veh.y, e.veh.z);
    }
    this.cars = list; this.rig.snap(this.player.veh, this.player.model);
    // spatial engine voices for the nearest rivals are assigned lazily in updateAudio
    return list;
  }

  async startSession(cfg, onProgress) {
    this.cfg = { aiCount: 5, laps: 3, diff: 1, ...cfg }; this.state = 'loading'; this.paused = false; this.replay = null; this.rec = null;
    this.stopMenuMusic = false;
    onProgress && onProgress('Loading track…');
    await this.loadWorld(cfg.trackId, onProgress);
    onProgress && onProgress('Preparing cars');
    await sleep(20);
    this.setupCars(this.cfg);
    this.player.veh.assist = Save.settings.assist;
    // session state
    this.raceTime = 0; this.finishedAll = false; this.resultsData = null; this.ghostRec = []; this.ghostRecT = 0;
    this.drift = { chain: 0, mult: 1, chainT: 0, bank: 0, best: 0, idle: 0, active: false, time: 0, total: 0, bankFlash: 0, lastAngle: 0 };
    this.stats = { overtakes: 0, cleanLaps: 0, topSpeed: 0, hits: 0, drift: 0, distance: 0 };
    this.timeLimit = cfg.mode === 'drift' ? (cfg.duration || 150) : 0; this.timeLeft = this.timeLimit;
    this.laps = cfg.mode === 'free' || cfg.mode === 'drift' ? 0 : this.cfg.laps;
    this.record = Save.record(cfg.trackId);
    this.ghostPlay = null;
    if (cfg.mode === 'trial' && this.record && this.record.ghost && this.record.ghostCar) this.makeGhost(this.record);
    this.rec = { frames: [], t: 0, n: this.cars.length };
    this.gate.visible = false; this.fx.skid.clear();
    this.cpCount = 8; this.rig.setMode(Save.d.cam ?? 0);
    this.state = 'intro'; this.introT = 0; this.cdT = 3.99; this.cdLast = 4; this.time = 0;
    this.audio.stopMusic();
    this.emit('session', { cfg: this.cfg, def: this.def });
    return this.cars;
  }

  makeGhost(rec) {
    const car = CAR_BY_ID[rec.ghostCar]; if (!car) return;
    const spec = deriveSpec(car, {}), look = this.carLook(this.player.carId);
    const model = buildCar(spec, { ...look, paint: '#6fe3ff', finish: 'gloss' }, { detail: false });
    model.root.traverse((o) => { if (o.isMesh) { const m = Array.isArray(o.material) ? o.material.map((x) => x.clone()) : o.material.clone(); for (const x of Array.isArray(m) ? m : [m]) { x.transparent = true; x.opacity = 0.34; x.depthWrite = false; } o.material = m; o.castShadow = false; } });
    this.world.scene.add(model.root);
    this.ghostPlay = { model, frames: rec.ghost, veh: new Vehicle(spec, 99), t: 0 };
  }

  // ---------------------------------------------------------------------------------------------- main loop
  start() { this.last = performance.now(); const loop = (now) => { requestAnimationFrame(loop); this.frame(now); }; requestAnimationFrame(loop); }

  frame(now) {
    const dt = Math.min(0.1, Math.max(0.0001, (now - this.last) / 1000)); this.last = now;
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    this.pr = this.gov.sample(dt, this.maxPr, (p) => { this.pr = p; this.renderer.setPixelRatio(p); this.resize(); }, this.pr);
    const st = this.state;
    if (this.garage && (st === 'garage')) { this.garage.update(dt); this.garage.render(this.post, this.renderer, dt); return; }
    if (!this.world) { return; }
    this.time += dt;
    this.handleActions();
    const live = st === 'racing' || st === 'countdown' || st === 'finished' || st === 'intro' || st === 'results';
    if (live && !this.paused) this.stepLive(dt);
    else if (st === 'replay') this.stepReplay(dt);
    else if (st === 'menu') this.stepMenu(dt);
    // post + render
    this.updateEnvironment(dt);
    this.fx && this.fx.skid.flush();
    this.post.speed = this.player && live ? clamp(this.player.veh.speed / 80, 0, 1) : 0; this.post.boost = this.player && this.player.veh.boosting && live ? 1 : 0;
    this.post.render(dt, this.time);
  }

  handleActions() {
    const inp = this.input;
    if (inp.consume('mute')) { const s = Save.settings; s.master = s.master > 0 ? 0 : 0.8; this.audio.setVolumes({ master: s.master }); this.emit('toast', s.master ? 'Sound on' : 'Sound off'); }
    if (inp.consume('pause')) { if (this.state === 'racing' || this.state === 'countdown' || this.state === 'intro') this.setPaused(!this.paused); else if (this.state === 'replay') this.emit('replay-back'); }
    if (this.state === 'racing' || this.state === 'countdown' || this.state === 'finished' || this.state === 'replay') {
      if (inp.consume('camera')) { const name = this.rig.next(); Save.d.cam = this.rig.mode; this.emit('toast', name + ' camera'); }
      if (inp.consume('reset') && this.state === 'racing') this.resetPlayer();
    } else { inp.pressed.delete('camera'); inp.pressed.delete('reset'); }
    if (inp.consume('confirm') && this.state === 'intro') this.skipIntro();
  }

  setPaused(p) {
    if (p === this.paused) return; this.paused = p; this.audio.silence(); this.last = performance.now();
    if (p) this.audio.suspend(); else this.audio.resume();
    this.emit('pause', p);
  }

  resetPlayer() {
    const v = this.player.veh, td = this.world.td;
    const q = td.nearest(v.x, v.z, -1, 18, this.q); v.place(td, q.idx, clamp(q.lat, -td.half * 0.5, td.half * 0.5) * 0.3); v.nitro = Math.max(0, v.nitro - 0.15);
    this.fx.skid.clear(); this.rig.snap(v, this.player.model); this.drift.chain = 0; this.drift.active = false; this.emit('toast', 'Back on track');
  }

  // ---------------------------------------------------------------------------------------------- live stepping
  stepLive(dt) {
    const st = this.state, W = this.world, td = W.td;
    if (st === 'intro') {
      this.introT += dt;
      const p = this.introT / 5.2; this.rig.flyover(td, p, this.player.veh.q.idx, this.player.veh);
      this.updateVisuals(dt, false);
      if (this.introT >= 5.2) this.skipIntro();
      return;
    }
    if (st === 'countdown') {
      this.cdT -= dt; const n = Math.ceil(this.cdT);
      if (n !== this.cdLast && n >= 1 && n <= 3) { this.cdLast = n; this.audio.countdown(n); this.emit('countdown', n); }
      for (const e of this.cars) { e.veh.held = true; e.veh.throttle = e.isPlayer ? this.input.update().throttle : 0; }
      if (this.cdT <= 0) { this.state = 'racing'; this.raceTime = 0; for (const e of this.cars) { e.veh.held = false; e.lapStart = 0; } this.audio.countdown(0); this.emit('countdown', 0); this.audio.startMusic('race'); }
    }
    // fixed-step physics
    this.acc += dt; let n = 0; const pin = this.input.update();
    while (this.acc >= FIXED && n < 12) { this.physics(FIXED, pin); this.acc -= FIXED; n++; }
    if (n >= 12) this.acc = 0;
    this.afterPhysics(dt);
    this.updateVisuals(dt, true);
    const p = this.player, v = p.veh;
    this.rig.update(dt, v, p.model, { steer: pin.steer });
    if (this.state === 'racing' || this.state === 'finished' || this.state === 'countdown') this.updateHud(dt);
  }

  physics(h, pin) {
    const W = this.world, td = W.td, world = { td, terrain: W.terrain, env: W.env }, racing = this.state === 'racing' || this.state === 'finished';
    if (this.state === 'racing' || this.state === 'finished') { this.raceTime += h; if (this.timeLimit && this.state === 'racing') { this.timeLeft -= h; } }
    for (const e of this.cars) {
      const v = e.veh; let inp;
      if (v.held) inp = NEUTRAL;
      else if (e.isPlayer && !e.auto) inp = pin;
      else {
        e.tick -= h;
        if (e.tick <= 0) {
          e.tick += 1 / 60;
          if (!e.ai) e.ai = makeAI(DIFFICULTY[3]);
          let mul = 1;
          if (!e.isPlayer && this.cfg.mode !== 'trial' && this.player) { const gap = (this.player.prog - e.prog) * SPACING; mul = 1 + clamp(gap / 520, -1, 1) * DIFFICULTY[this.cfg.diff].rubber; }
          e.input = aiDrive(v, e.ai, td, this.line, this.cars, { dt: 1 / 60, speedMul: mul, wet: !!W.env.wet, time: this.time });
          e.signal = e.ai.signal;
          if (e.input.respawn) { const q = td.nearest(v.x, v.z, -1, 18, this.q); v.place(td, q.idx, 0); e.respawns++; e.ai.offT = 0; e.ai.stuck = 0; }
        }
        inp = e.input;
      }
      v.step(h, inp, world);
    }
    if (this.cars.length > 1) collideVehicles(this.cars.map((c) => c.veh));
    for (const e of this.cars) this.progress(e, h);
    if (racing && this.player && this.cfg.mode === 'drift') this.updateDrift(h);
    // recording for replay + ghost
    if (racing) {
      this.rec.t += h; if (this.rec.t >= 0.05) { this.rec.t = 0; this.recordFrame(); }
      if (this.cfg.mode === 'trial') { this.ghostRecT += h; if (this.ghostRecT >= 0.05) { this.ghostRecT = 0; const v = this.player.veh; this.ghostRec.push([+v.x.toFixed(2), +v.z.toFixed(2), +v.y.toFixed(2), +v.heading.toFixed(3), +v.u.toFixed(1), +v.delta.toFixed(3)]); } }
    }
  }

  recordFrame() {
    const f = new Float32Array(this.cars.length * 13);
    this.cars.forEach((e, i) => { const v = e.veh, o = i * 13; f[o] = v.x; f[o + 1] = v.z; f[o + 2] = v.y; f[o + 3] = v.heading; f[o + 4] = v.steerWheel; f[o + 5] = v.u; f[o + 6] = v.rpm; f[o + 7] = v.pitch; f[o + 8] = v.roll; f[o + 9] = v.skid; f[o + 10] = (v.boosting ? 1 : 0) + (v.brakeIn > 0.1 ? 2 : 0) + (v.reverse ? 4 : 0); f[o + 11] = v.delta; f[o + 12] = v.gear; });
    if (this.rec.frames.length < 30000) this.rec.frames.push(f);
  }

  /** lap bookkeeping, checkpoints, finishing */
  progress(e, h) {
    const td = this.world.td, N = td.N, v = e.veh, q = v.q, cur = q.idx + q.t;
    let d = cur - e.lastCur; if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    e.prog += d; e.lastCur = cur; if (d > 0) e.distance += d * SPACING;
    if (this.state !== 'racing' && this.state !== 'finished') return;
    if (this.laps === 0) { // free / drift: lap counter still runs for the HUD
      const fl = Math.floor(e.prog / N); if (fl > e.maxLap) e.maxLap = fl; return;
    }
    const fl = Math.floor(e.prog / N);
    if (fl > e.maxLap) {
      e.maxLap = fl;
      if (fl === 0) { e.lapStart = this.raceTime; e.splitStart = this.raceTime; e.cpNext = 1; if (e.isPlayer) { e.hitsLap = 0; this.ghostRec.length = 0; } }
      else if (fl > 0) {
        const lt = this.raceTime - e.lapStart; e.laps.push(lt); e.last = lt; e.lapStart = this.raceTime;
        const best = e.best == null || lt < e.best; if (best) e.best = lt;
        if (e.isPlayer) this.onPlayerLap(e, lt, best, fl);
        e.cpNext = 1; e.splitStart = this.raceTime; e.splits = [];
        if (fl >= this.laps && !e.finished) { e.finished = true; e.finishTime = this.raceTime; this.onFinish(e); }
      }
    }
    // checkpoints (8 per lap)
    if (fl >= 0 && !e.finished) {
      const step = N / this.cpCount, local = e.prog - fl * N;
      if (local >= e.cpNext * step && e.cpNext < this.cpCount) { const t = this.raceTime - e.lapStart; e.splits.push(t); const i = e.cpNext; e.cpNext++; if (e.isPlayer) this.onCheckpoint(i, t); }
    }
  }

  onCheckpoint(i, t) {
    this.audio.checkpoint();
    let delta = null; const rec = this.record;
    if (rec && rec.splits && rec.splits[i - 1] != null && this.cfg.mode === 'trial') delta = t - rec.splits[i - 1];
    this.splitInfo = { i, t, delta, at: this.time };
  }

  onPlayerLap(e, lt, best, lapNo) {
    const clean = e.hitsLap === 0; if (clean) this.stats.cleanLaps++; e.hitsLap = 0;
    const msg = `Lap ${lapNo} ${fmt(lt)}`;
    this.pushMsg(best ? msg + '  ★ BEST' : msg, best ? 'gold' : 'info'); if (clean) this.pushMsg('CLEAN LAP  +500', 'good');
    if (this.laps && lapNo === this.laps - 1 + 0 && lapNo >= 1 && lapNo === this.laps - 0) { /* final lap finish handled in onFinish */ }
    else if (this.laps && lapNo + 1 === this.laps) this.emit('final-lap');
    // personal best + ghost + splits (time trial and race both keep the track record)
    const rec = Save.record(this.cfg.trackId);
    if (!rec || rec.best == null || lt < rec.best) {
      const patch = { best: lt, car: e.carId, splits: e.splits.slice() };
      if (this.cfg.mode === 'trial') { patch.ghost = this.ghostRec.slice(); patch.ghostCar = e.carId; }
      this.record = { ...(rec || {}), ...patch }; Save.setRecord(this.cfg.trackId, patch); this.newRecord = true; this.emit('record', lt);
    }
    this.ghostRec.length = 0;
  }

  onFinish(e) {
    if (!e.isPlayer) return;
    this.state = 'finished'; e.auto = true; e.ai = e.ai || makeAI(DIFFICULTY[3]); this.finishAt = this.time + 3.2;
    this.pushMsg(e.rank === 1 ? 'VICTORY!' : 'FINISH', e.rank === 1 ? 'gold' : 'info');
    this.emit('finish', e); this.audio.jingle(e.rank <= 3 ? 'win' : 'lose');
  }

  ranking() {
    const key = (c) => (c.finished ? 1e8 - c.finishTime : c.prog);
    const order = this.cars.slice().sort((a, b) => key(b) - key(a)); order.forEach((c, i) => { c.rank = i + 1; }); return order;
  }

  // ---------------------------------------------------------------------------------------------- per-frame logic
  afterPhysics(dt) {
    const p = this.player, v = p.veh, td = this.world.td;
    const order = this.ranking();
    if ((this.state === 'racing') && this.cars.length > 1) {
      if (p.rank < p.lastRank && this.raceTime > 3) { const k = p.lastRank - p.rank; p.overtakes += k; this.stats.overtakes += k; this.pushMsg('OVERTAKE  +300', 'good'); this.audio.overtake(); this.emit('overtake'); }
      p.lastRank = p.rank;
    }
    // impacts: audio, camera, damage, sparks
    for (const e of this.cars) {
      const vv = e.veh;
      if (vv.impact > 2.5) {
        const dist = Math.hypot(vv.x - v.x, vv.z - v.z);
        if (e.isPlayer) { this.rig.kick(clamp(vv.impact / 16, 0.1, 1.3)); this.post.flash = Math.min(0.7, vv.impact / 25); if (vv.impact > 4) { e.hits++; e.hitsLap++; this.stats.hits++; if (this.cfg.mode === 'drift') { this.drift.chain = 0; this.drift.bank = this.drift.bank; } } }
        if (dist < 70) this.audio.impact(vv.impact * (e.isPlayer ? 1 : 0.7));
        for (const h of vv.hits) {
          if (e.model) e.model.dent(h.x, h.z, h.s);
          const sp = Math.sin(vv.heading), cp = Math.cos(vv.heading);
          const wx = vv.x + h.x * cp + h.z * sp, wz = vv.z - h.x * sp + h.z * cp;
          for (let i = 0; i < Math.round(5 + h.s * 14); i++) this.fx.particles.spark(wx, vv.y + 0.6, wz, (Math.random() - 0.5) * 9 + vv.vx * 0.2, 1 + Math.random() * 4, (Math.random() - 0.5) * 9 + vv.vz * 0.2);
          if (h.s > 0.5) for (let i = 0; i < 3; i++) this.fx.particles.debris(wx, vv.y + 0.5, wz, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6);
        }
        vv.hits.length = 0;
      } else if (vv.contact && vv.speed > 6 && Math.random() < 0.35) { // scraping along a barrier
        if (e.isPlayer) { this.audio.scrape(); this.rig.kick(0.04); }
        this.fx.particles.spark(vv.x + (Math.random() - 0.5) * 2, vv.y + 0.4, vv.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5, Math.random() * 2.5, (Math.random() - 0.5) * 5);
      }
      vv.hits.length = 0;
    }
    this.stats.topSpeed = Math.max(this.stats.topSpeed, v.speed * 3.6); this.stats.distance += v.speed * dt;
    if (this.state === 'finished' && this.time > this.finishAt && !this.resultsData) this.finishRace();
    if (this.cfg.mode === 'drift' && this.state === 'racing' && this.timeLeft <= 0) { this.state = 'finished'; this.player.finished = true; this.player.finishTime = this.timeLimit; this.finishAt = this.time + 1.2; this.player.auto = true; this.emit('finish', this.player); this.audio.jingle('win'); }
    // wrong way
    const dot = Math.sin(v.heading) * td.tx[v.q.idx] + Math.cos(v.heading) * td.tz[v.q.idx];
    this.wrongT = dot < -0.35 && v.speed > 5 && this.state === 'racing' ? (this.wrongT || 0) + dt : Math.max(0, (this.wrongT || 0) - dt * 3);
    // gate marker for the next checkpoint
    if (this.state === 'racing' && !p.finished && this.laps) {
      const N = td.N, step = N / this.cpCount, next = ((Math.max(p.maxLap, 0)) * N + p.cpNext * step), idx = Math.round(next) % N;
      this.gate.visible = true; this.gate.position.set(td.px[idx], td.py[idx], td.pz[idx]); this.gate.rotation.y = td.heading[idx];
      this.gate.children[2].material.opacity = 0.05 + 0.04 * Math.sin(this.time * 6);
      this.gate.visible = this.cfg.mode !== 'trial' || true;
    } else this.gate.visible = false;
    if (this.audio.ready) this.audio.setEnergy(clamp(v.speed / 70 + (v.boosting ? 0.3 : 0), 0, 1));
  }

  updateDrift(h) {
    const v = this.player.veh, d = this.drift;
    const slide = v.drifting && v.u > 8 && v.throttle > 0.02;
    if (slide) {
      d.idle = 0; d.chainT += h; d.active = true;
      const ang = clamp(v.driftAngle, 0, 1.1), sp = v.speed * 3.6;
      d.mult = Math.min(8, 1 + Math.floor(d.chainT / 2.2) * 0.5 + (ang > 0.55 ? 0.5 : 0));
      d.chain += (sp * 0.05 + ang * 90) * d.mult * h * 4.2 * (ang > 1.05 ? 0.4 : 1); d.lastAngle = ang; d.peak = Math.max(d.peak || 0, d.chain);
    } else if (d.chain > 0) {
      d.idle += h;
      if (d.idle > 1.0) { // bank the chain
        d.bank += Math.round(d.chain); d.best = Math.max(d.best, Math.round(d.chain)); this.stats.drift += Math.round(d.chain);
        if (d.chain > 600) this.pushMsg(`DRIFT +${Math.round(d.chain)}  x${d.mult.toFixed(1)}`, 'gold');
        d.chain = 0; d.chainT = 0; d.mult = 1; d.active = false; d.bankFlash = 1;
      }
    }
    if (!v.onRoad && d.chain > 0 && v.surface.kind !== 'curb') { d.chain = 0; d.chainT = 0; d.mult = 1; d.active = false; this.pushMsg('Drift lost!', 'bad'); }
    d.bankFlash = Math.max(0, d.bankFlash - h * 1.5);
  }

  pushMsg(text, kind = 'info') { this.msgs.push({ text, kind, t: this.time }); if (this.msgs.length > 5) this.msgs.shift(); this.emit('msg', { text, kind }); }

  // ---------------------------------------------------------------------------------------------- visuals / fx / audio
  groundAt(x, z, hint) {
    const td = this.world.td, q = td.nearest(x, z, hint, 20, this.q);
    return Math.abs(q.lat) <= td.half + td.shoulder + 0.5 ? td.roadY(q, q.lat) : this.world.terrain.height(x, z);
  }

  updateVisuals(dt, live) {
    const W = this.world, td = W.td, cam = this.camera;
    const nightK = W.env.night ? 1 : 0;
    const pv = this.player.veh; const tf = td.tunnelF[pv.q.idx] || 0; this.tunnel += (tf - this.tunnel) * Math.min(1, dt * 6);
    this.lightF = Math.max(nightK, this.tunnel);
    const camPos = cam.position;
    const fx = this.fx; const dens = this.preset.particles;
    const wheelZ = [1, 1, -1, -1], wheelX = [1, -1, 1, -1];
    const sorted = [];
    for (const e of this.cars) {
      const v = e.veh, m = e.model, d = Math.hypot(v.x - camPos.x, v.z - camPos.z); e.dist2cam = d; sorted.push(e);
      const near = d < 70 || e.isPlayer;
      const ctx = { time: this.time, near, headlights: this.lightF, signal: e.isPlayer ? (Math.abs(pv.steerWheel) > 0.5 && pv.speed < 22 ? Math.sign(-pv.steerWheel) : 0) : e.signal, cluster: e.isPlayer && this.rig.mode === 3 };
      if (near) {
        const hx = td.trackW ?? 0; const sp = Math.sin(v.heading), cp = Math.cos(v.heading), s = v.spec, tw = s.trackW / 2, wb = s.wheelbase / 2;
        const gs = [];
        for (let i = 0; i < 4; i++) gs.push(this.groundAt(v.x + cp * tw * wheelX[i] + sp * wb * wheelZ[i], v.z - sp * tw * wheelX[i] + cp * wb * wheelZ[i], v.hint));
        const front = (gs[0] + gs[1]) / 2, rear = (gs[2] + gs[3]) / 2, left = (gs[0] + gs[2]) / 2, right = (gs[1] + gs[3]) / 2;
        ctx.baseY = (front + rear) / 2; ctx.pitchG = Math.atan2(front - rear, s.wheelbase); ctx.rollG = Math.atan2(left - right, s.trackW);
        ctx.wheelOff = [gs[0] - (ctx.baseY + (front - ctx.baseY)), 0, 0, 0].map((_, i) => clamp(gs[i] - (ctx.baseY + (i < 2 ? front - ctx.baseY : rear - ctx.baseY) + ((i % 2 ? right : left) - ctx.baseY)), -0.1, 0.1));
      } else { ctx.baseY = v.y; ctx.pitchG = Math.atan(v.gradX * Math.sin(v.heading) + v.gradZ * Math.cos(v.heading)); ctx.rollG = -Math.atan(v.gradX * Math.cos(v.heading) - v.gradZ * Math.sin(v.heading)); }
      updateCar(m, v, ctx);
      m.root.visible = d < 1800;
      if (live && d < 140) this.carFx(e, dt, dens);
    }
    // 3 headlight spot lights: player + two nearest rivals
    const spots = W.lighting.spots, near2 = sorted.filter((e) => !e.isPlayer && e.dist2cam < 110).sort((a, b) => a.dist2cam - b.dist2cam).slice(0, 2);
    [this.player, ...near2].forEach((e, i) => this.setSpot(spots[i], e, i === 0 ? 8500 : 4200));
    for (let i = 1 + near2.length; i < 3; i++) spots[i].intensity = 0;
    // ghost
    if (this.ghostPlay && this.state === 'racing') this.updateGhost(dt);
    cam.getWorldPosition(this.tmpV || (this.tmpV = new THREE.Vector3()));
    W.update(dt, this.time, cam, { x: pv.x, y: pv.y, z: pv.z }, this.tunnel);
    if (fx) { fx.particles.update(dt); fx.streaks.update(dt, clamp(pv.speed / 80, 0, 1), pv.boosting ? 1 : 0); fx.particles.setScale(this.h * this.pr, cam.fov); }
    this.updateAudio(dt);
  }

  setSpot(s, e, I) {
    const v = e.veh, f = this.lightF;
    const night = this.world.env.night ? 1 : 0.3;   // tunnels need far less than a night road: the walls are metres away
    s.intensity = I * Math.min(f, 1) * (night > 0.5 ? 1 : 0.3); if (f <= 0.01) return;
    const sp = Math.sin(v.heading), cp = Math.cos(v.heading);
    s.position.set(v.x + sp * 2.1, v.y + 0.75, v.z + cp * 2.1); s.target.position.set(v.x + sp * 45, v.y - 0.3, v.z + cp * 45); s.target.updateMatrixWorld();
  }

  carFx(e, dt, dens) {
    const v = e.veh, fx = this.fx, sp = Math.sin(v.heading), cp = Math.cos(v.heading), s = v.spec, rz = -s.wheelbase / 2, tw = s.trackW / 2;
    const env = this.world.env, dust = hexRGB(env.dust);
    for (let w = 0; w < 2; w++) {
      const sx = w ? -1 : 1, wx = v.x + cp * tw * sx + sp * rz, wz = v.z - sp * tw * sx + cp * rz, key = w ? 'sk1' : 'sk0';
      if (v.skid > 0.12 && v.speed > 5) { const p = e[key]; if (p) fx.skid.add(p[0], p[2], p[1], wx, v.y, wz, 0.28 + v.skid * 0.1); e[key] = [wx, wz, v.y]; } else e[key] = null;
    }
    e.fxT = (e.fxT || 0) - dt; if (e.fxT > 0) return; e.fxT = 0.028 / Math.max(0.3, dens);
    for (let w = 0; w < 2; w++) {
      const sx = w ? -1 : 1, wx = v.x + cp * tw * sx + sp * rz, wz = v.z - sp * tw * sx + cp * rz;
      if (v.skid > 0.25) fx.particles.smoke(wx, v.y, wz, v.vx, v.vz, v.skid, this.world.env.wet ? [0.7, 0.72, 0.8] : [0.92, 0.92, 0.94]);
      else if (v.surface.resist > 0.1 && v.speed > 9) fx.particles.dust(wx, v.y, wz, v.vx, v.vz, dust, clamp(v.speed / 40, 0.4, 1.2));
      else if (v.surface.kind === 'curb' && v.speed > 20 && Math.random() < 0.3) fx.particles.dust(wx, v.y, wz, v.vx, v.vz, [0.8, 0.8, 0.8], 0.4);
    }
    if (v.boosting || v.backfire > 0.3) {
      const blue = v.boosting; for (const x of (s.engine.cyl > 6 ? [-0.5, 0.5] : [-0.45, 0.45])) { const ex = v.x + cp * x + sp * (-s.length / 2 - 0.1), ez = v.z - sp * x + cp * (-s.length / 2 - 0.1); fx.particles.flame(ex, v.y + 0.4, ez, -v.vx * 0.2 + (Math.random() - 0.5), 0.5 + Math.random(), -v.vz * 0.2 + (Math.random() - 0.5), blue); }
    }
    if (v.spinR > 0.4 && v.speed < 25 && v.skid > 0.1) fx.particles.smoke(v.x + sp * rz, v.y, v.z + cp * rz, v.vx, v.vz, 1.2);
  }

  updateGhost(dt) {
    const g = this.ghostPlay; g.t = this.raceTime - (this.player.lapStart || 0); if (this.player.maxLap < 0) g.t = 0;
    const f = g.frames, i = Math.floor(g.t / 0.05); if (i < 0 || i >= f.length - 1) { g.model.root.visible = false; return; }
    const a = f[i], b = f[i + 1], k = g.t / 0.05 - i;
    g.model.root.visible = true; const v = g.veh; v.x = lerp(a[0], b[0], k); v.z = lerp(a[1], b[1], k); v.y = lerp(a[2], b[2], k); v.heading = a[3] + wrapAngle(b[3] - a[3]) * k; v.u = lerp(a[4], b[4], k); v.delta = lerp(a[5], b[5], k); v.speed = Math.abs(v.u);
    v.pitch = v.roll = v.heave = 0; v.wheelAngle[0] += v.u * dt / v.spec.rw; v.wheelAngle[1] = v.wheelAngle[2] = v.wheelAngle[3] = v.wheelAngle[0]; v.throttle = 0; v.brakeIn = 0; v.ax = 0; v.rpm = 3000;
    updateCar(g.model, v, { time: this.time, near: false, headlights: this.lightF });
  }

  updateAudio(dt) {
    const A = this.audio; if (!A.ready) return;
    const p = this.player, v = p.veh, td = this.world.td;
    A.setReverb(this.tunnel);
    const live = this.state === 'racing' || this.state === 'countdown' || this.state === 'finished';
    if (!p.voice) p.voice = A.createEngine(v.spec, { spatial: false });
    const load = clamp(v.throttle * 0.8 + (v.boosting ? 0.2 : 0), 0, 1);
    A.updateEngine(p.voice, { rpm: v.rpm, throttle: v.throttle, load: live ? load : 0.05, turbo: v.turbo, boosting: v.boosting, gear: v.gear, blowoff: v.blowoff, backfire: v.backfire, limiter: v.rpm > v.spec.redline * 0.985 && v.throttle > 0.5, gain: 1, off: this.state === 'intro' });
    if (v.boosting && !this._nb) { A.nitro(); this._nb = true; } else if (!v.boosting) this._nb = false;
    A.updatePlayer({ speed: v.speed, skid: this.state === 'intro' ? 0 : v.skid, surface: v.surface.kind, loose: v.surface.kind !== 'asphalt' && v.surface.kind !== 'wet', rumble: v.rumble, boosting: v.boosting, inside: this.tunnel > 0.5 });
    // rivals: up to 3 spatial voices
    const camQ = this.camera, right = this.tmpR || (this.tmpR = new THREE.Vector3()); right.set(1, 0, 0).applyQuaternion(camQ.quaternion);
    const rivals = this.cars.filter((e) => !e.isPlayer).sort((a, b) => a.dist2cam - b.dist2cam);
    rivals.forEach((e, i) => {
      const ev = e.veh, want = i < 3 && e.dist2cam < 160 && live;
      if (want && !e.voice) e.voice = A.createEngine(ev.spec, { spatial: true });
      if (e.voice) {
        if (!want) { A.killEngine(e.voice); e.voice = null; return; }
        const dx = ev.x - camQ.position.x, dz = ev.z - camQ.position.z, d = Math.hypot(dx, dz);
        const pan = (dx * right.x + dz * right.z) / Math.max(d, 1);
        const gain = clamp(1 - d / 160, 0, 1) ** 1.6 * 0.55;
        A.updateEngine(e.voice, { rpm: ev.rpm, throttle: ev.throttle, load: ev.throttle * 0.8, turbo: ev.turbo, boosting: ev.boosting, gear: ev.gear, blowoff: ev.blowoff, backfire: ev.backfire, limiter: false, gain, pan });
      }
    });
  }

  updateEnvironment() { }

  // ---------------------------------------------------------------------------------------------- HUD feed
  updateHud(dt) {
    const p = this.player, v = p.veh, td = this.world.td, S = Save.settings, h = this.hudData;
    const mph = S.units === 'mph';
    h.speed = Math.round(v.speed * (mph ? 2.23694 : 3.6)); h.unit = mph ? 'MPH' : 'KM/H'; h.maxSpeed = Math.ceil((v.spec.topKmh * (mph ? 0.621 : 1) * 1.08) / 20) * 20;
    h.rpm = clamp(v.rpm / v.spec.redline, 0, 1.05); h.gear = v.reverse ? 'R' : v.speed < 0.6 && v.throttle === 0 ? 'N' : String(v.gear); h.shifting = v.shiftT > 0;
    h.nitro = v.nitro / (v.nitroCap || 1); h.boosting = v.boosting; h.boostFull = h.nitro > 0.98;
    h.pos = p.rank; h.total = this.cars.length; h.lap = clamp(p.maxLap + 1, 1, Math.max(this.laps, 1)); h.laps = this.laps; h.mode = this.cfg.mode;
    h.time = this.raceTime; h.lapTime = p.maxLap < 0 ? 0 : this.raceTime - p.lapStart; h.last = p.last; h.best = p.best ?? (this.record ? this.record.best : null); h.recordBest = this.record ? this.record.best : null;
    h.cp = p.cpNext; h.cpCount = this.cpCount; h.split = this.splitInfo && this.time - this.splitInfo.at < 3.2 ? this.splitInfo : null;
    h.drift = this.drift; h.timeLeft = this.timeLeft; h.wrongWay = (this.wrongT || 0) > 0.9; h.msgs = this.msgs; h.fps = this.fps; h.turbo = v.turbo;
    h.cars = this.cars; h.playerId = p.id; h.td = td; h.speedN = clamp(v.speed / 75, 0, 1.2); h.steer = v.steerWheel; h.surface = v.surface.kind; h.tunnel = this.tunnel;
    h.finished = this.state === 'finished'; h.state = this.state; h.nearest = null;
    this.emit('hud', h);
  }

  // ---------------------------------------------------------------------------------------------- finishing, rewards
  finishRace() {
    const p = this.player, mode = this.cfg.mode, order = this.ranking(), diff = DIFFICULTY[this.cfg.diff] || DIFFICULTY[1];
    this.state = 'results';
    for (const e of this.cars) if (!e.finished) { e.finishTime = null; }
    const rows = order.map((e, i) => ({ pos: i + 1, name: e.name, isPlayer: e.isPlayer, color: e.color, car: CAR_BY_ID[e.carId].name, time: e.finishTime, best: e.best, laps: Math.max(0, e.maxLap + 1) }));
    let credits = 0, xp = 0; const lines = [];
    const add = (label, c, x = c * 0.12) => { credits += Math.round(c); xp += Math.round(x); lines.push([label, Math.round(c)]); };
    const pos = p.rank, dm = [1, 1.25, 1.6, 2.1][this.cfg.diff] || 1;
    if (mode === 'race' || mode === 'cup') {
      const base = [12000, 8500, 6500, 4800, 3500, 2500, 1800, 1200][Math.min(7, pos - 1)] * dm; add(`Finish — P${pos}`, base, base * 0.13 + 150);
      if (p.hits === 0) add('Clean race', 2500 * dm); if (p.best != null && order.every((e) => e.best == null || e === p || p.best <= e.best)) add('Fastest lap', 1500 * dm);
      if (p.overtakes) add(`Overtakes ×${p.overtakes}`, Math.min(4500, p.overtakes * 400) * dm); if (this.stats.drift) add('Drift bonus', Math.min(5000, this.stats.drift / 25));
      if (pos === 1) add('Victory bonus', 3000 * dm);
    } else if (mode === 'trial') {
      const base = 3500; add('Session', base, base * 0.1 + p.laps.length * 60); if (this.newRecord) add('New personal best', 5000, 600); add(`Laps ×${p.laps.length}`, p.laps.length * 800);
    } else if (mode === 'drift') {
      const total = Math.round(this.drift.bank + this.drift.chain), medals = DRIFT_MEDALS[this.cfg.trackId] || [15000, 40000, 80000];
      const medal = total >= medals[2] ? 3 : total >= medals[1] ? 2 : total >= medals[0] ? 1 : 0; this.drift.total = total; this.drift.medal = medal;
      add(`Drift score ${total.toLocaleString()}`, Math.min(30000, total / 5), total / 60); if (medal) add(['Bronze', 'Silver', 'Gold'][medal - 1] + ' medal', [2500, 6000, 12000][medal - 1], medal * 300);
      const prev = Save.d.drift[this.cfg.trackId] || 0; if (total > prev) { Save.d.drift[this.cfg.trackId] = total; this.newRecord = true; }
    } else if (mode === 'free') { const km = this.stats.distance / 1000; add(`Distance ${km.toFixed(1)} km`, km * 400, km * 30); }
    const before = Save.level, owned = Save.d.owned.length; Save.addCredits(credits); const lvl = Save.addXP(xp);
    const st = Save.d.stats; if (mode === 'race' || mode === 'cup') { st.races++; if (pos === 1) st.wins++; if (pos <= 3) st.podiums++; } st.km += this.stats.distance / 1000; st.driftPts += this.stats.drift; Save.commit();
    this.resultsData = { mode, rows, credits, xp, lines, pos, levelUp: lvl || 0, before, record: this.newRecord, cfg: this.cfg, drift: mode === 'drift' ? this.drift : null, stats: this.stats, best: p.best };
    this.emit('results', this.resultsData);
  }

  // ---------------------------------------------------------------------------------------------- menu scene, replay
  skipIntro() { if (this.state !== 'intro') return; this.state = 'countdown'; this.cdT = 3.99; this.cdLast = 4; this.rig.snap(this.player.veh, this.player.model); this.emit('intro-done'); }

  async showMenuScene(trackId, onProgress) {
    this.state = 'loading'; this.paused = false;
    await this.loadWorld(trackId, onProgress);
    const cfg = { mode: 'free', trackId, carId: Save.d.selected, aiCount: 0 };
    this.cfg = cfg; this.laps = 0; this.cpCount = 8; this.drift = { chain: 0, mult: 1, chainT: 0, bank: 0, best: 0, idle: 0 }; this.stats = {}; this.ghostPlay = null; this.record = null;
    this.setupCars(cfg); const v = this.player.veh; v.held = true; this.menuOrbit = Math.random() * 6; this.state = 'menu'; this.menuT = 0;
    this.audio.stopMusic(); this.audio.startMusic('menu');
  }

  stepMenu(dt) {
    this.menuT += dt; const v = this.player.veh, p = this.player, cam = this.camera;
    v.held = true; v.throttle = 0;
    const sd = this.world.lighting.sunDir, a = Math.atan2(sd.x, sd.z) - v.heading + Math.sin(this.menuT * 0.16 + this.menuOrbit) * 1.05 + 0.25, r = 7.2 + Math.sin(this.menuT * 0.2) * 1.4;
    const sp = Math.sin(v.heading), cp = Math.cos(v.heading);
    cam.position.set(v.x + Math.sin(v.heading + a) * r, v.y + 1.1 + Math.sin(this.menuT * 0.27) * 0.5, v.z + Math.cos(v.heading + a) * r);
    this.rig.look.set(v.x, v.y + 0.55, v.z); cam.lookAt(this.rig.look); if (Math.abs(cam.fov - 34) > 0.1) { cam.fov = 34; cam.updateProjectionMatrix(); }
    this.updateVisuals(dt, false);
  }

  startReplay() {
    if (!this.rec || !this.rec.frames.length) return false;
    this.state = 'replay'; this.replay = { i: 0, t: 0, speed: 1, playing: true }; this.rig.setMode(4); this.rig.cine.until = 0;
    for (const e of this.cars) { e.veh.held = true; if (e.voice) { this.audio.killEngine(e.voice); e.voice = null; } }
    this.fx.skid.clear(); return true;
  }
  stepReplay(dt) {
    const R = this.replay, F = this.rec.frames; if (R.playing) R.t += dt * R.speed;
    const idx = R.t / 0.05, i = Math.min(F.length - 2, Math.floor(idx)), k = idx - i;
    if (R.t < 0) R.t = 0; if (idx >= F.length - 1) { R.t = (F.length - 1) * 0.05; R.playing = false; this.emit('replay-end'); }
    const a = F[Math.max(0, i)], b = F[Math.max(0, i + 1)] || a;
    this.cars.forEach((e, c) => {
      const o = c * 13, v = e.veh; v.x = lerp(a[o], b[o], k); v.z = lerp(a[o + 1], b[o + 1], k); v.y = lerp(a[o + 2], b[o + 2], k);
      v.heading = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * k; v.steerWheel = lerp(a[o + 4], b[o + 4], k); v.u = lerp(a[o + 5], b[o + 5], k); v.rpm = lerp(a[o + 6], b[o + 6], k);
      v.pitch = lerp(a[o + 7], b[o + 7], k); v.roll = lerp(a[o + 8], b[o + 8], k); v.skid = a[o + 9]; const fl = a[o + 10] | 0; v.boosting = !!(fl & 1); v.brakeIn = fl & 2 ? 1 : 0; v.reverse = !!(fl & 4); v.delta = lerp(a[o + 11], b[o + 11], k); v.gear = a[o + 12] | 0;
      v.speed = Math.abs(v.u); v.vx = Math.sin(v.heading) * v.u; v.vz = Math.cos(v.heading) * v.u; v.throttle = v.speed > 3 ? 0.6 : 0; v.heave = 0; v.rumble = 0; v.spinR = 0; v.backfire = 0; v.blowoff = 0;
      const rot = (v.u * dt * R.speed) / v.spec.rw; for (let w = 0; w < 4; w++) v.wheelAngle[w] += rot; v.q.idx = v.q.idx || 0;
      v.hint = this.world.td.nearest(v.x, v.z, v.hint, 30, this.q).idx; v.q.idx = v.hint;
    });
    this.updateVisuals(dt * (R.playing ? R.speed : 0), true);
    this.rig.update(dt, this.player.veh, this.player.model, { steer: 0 });
    this.emit('replay-tick', { t: R.t, dur: (F.length - 1) * 0.05, playing: R.playing });
  }

  // ---------------------------------------------------------------------------------------------- end session
  async endSession() {
    this.state = 'loading'; this.audio.silence(); this.audio.stopMusic();
  }
}

function fmt(t) { if (t == null) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
