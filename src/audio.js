// Fully synthesised audio (Web Audio): engines, turbo, backfire, tyres, wind/road, impacts, UI, countdown, music.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const ENGINES = {
  i4: { h: [1, 0.55, 0.85, 0.3, 0.4, 0.18, 0.22, 0.1], lp: 1000, am: 0, drive: 1.6, sub: 0.35 },
  v8: { h: [1, 0.95, 0.6, 0.5, 0.32, 0.25, 0.16, 0.11], lp: 800, am: 0.22, drive: 2.4, sub: 0.7 },
  v10: { h: [1, 0.62, 0.78, 0.55, 0.55, 0.38, 0.32, 0.26, 0.2, 0.15], lp: 1500, am: 0.05, drive: 1.9, sub: 0.3 },
  f4t: { h: [1, 0.75, 0.4, 0.55, 0.22, 0.25, 0.1], lp: 900, am: 0.32, drive: 2.0, sub: 0.55 },
  v6: { h: [1, 0.6, 0.65, 0.35, 0.42, 0.2, 0.22], lp: 1300, am: 0.04, drive: 1.7, sub: 0.3 },
  v8tt: { h: [1, 0.8, 0.5, 0.46, 0.3, 0.25, 0.12], lp: 1250, am: 0.08, drive: 1.5, sub: 0.45 },
};
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.ready = false; this.vol = { master: 0.8, music: 0.5, sfx: 0.9, engine: 0.85 }; this.waves = {}; this.musicKind = null; this.voices = new Set(); }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = c.createGain(); this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.busEngine = c.createGain(); this.busSfx = c.createGain(); this.busMusic = c.createGain();
    for (const b of [this.busEngine, this.busSfx, this.busMusic]) b.connect(this.master);
    // reverb send (tunnels, music)
    const len = c.sampleRate * 1.8, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb = c.createConvolver(); this.reverb.buffer = ir; this.revGain = c.createGain(); this.revGain.gain.value = 0.06; this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.sendEngine = c.createGain(); this.sendEngine.gain.value = 0.5; this.busEngine.connect(this.sendEngine); this.sendEngine.connect(this.reverb);
    this.sendSfx = c.createGain(); this.sendSfx.gain.value = 0.4; this.busSfx.connect(this.sendSfx); this.sendSfx.connect(this.reverb);
    this.sendMusic = c.createGain(); this.sendMusic.gain.value = 0.55; this.busMusic.connect(this.sendMusic); this.sendMusic.connect(this.reverb);
    // noise buffer
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    for (const [k, e] of Object.entries(ENGINES)) { const re = new Float32Array(e.h.length + 1), im = new Float32Array(e.h.length + 1); e.h.forEach((a, i) => { im[i + 1] = a; }); this.waves[k] = c.createPeriodicWave(re, im); }
    // distortion curve
    this.curve = (drive) => { const n = 512, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(x * drive) / Math.tanh(drive); } return cv; };
    // continuous noise layers (player)
    const mk = (type, f, q) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.busSfx); s.start(0, Math.random()); return { f: fl, g }; };
    this.tyre = mk('bandpass', 1700, 4); this.tyre2 = mk('highpass', 2600, 0.7); this.road = mk('lowpass', 420, 0.6); this.wind = mk('highpass', 500, 0.3); this.rumble = mk('lowpass', 160, 1.2); this.nitroNoise = mk('bandpass', 1400, 0.9);
    this.rumbleLfo = c.createOscillator(); this.rumbleLfo.frequency.value = 38; this.rumbleLfoGain = c.createGain(); this.rumbleLfoGain.gain.value = 0; this.rumbleLfo.connect(this.rumbleLfoGain); this.rumbleLfoGain.connect(this.rumble.g.gain); this.rumbleLfo.start();
    this.ready = true; this.setVolumes(this.vol);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.suspend(); else this.resume(); });
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended' && !this.forceSuspended) this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  setVolumes(v) {
    Object.assign(this.vol, v); if (!this.ready) return; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.03); this.busEngine.gain.setTargetAtTime(this.vol.engine * 0.9, t, 0.03);
    this.busSfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03); this.busMusic.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
  }
  setReverb(w) { if (this.ready) this.revGain.gain.setTargetAtTime(0.06 + w * 0.6, this.ctx.currentTime, 0.15); }

  // ----------------------------------------------------------------------------- engine voice
  createEngine(spec, { spatial = false } = {}) {
    if (!this.ready) return null;
    const c = this.ctx, E = ENGINES[spec.engine.kind] || ENGINES.i4;
    const out = c.createGain(); out.gain.value = 0;
    const pan = spatial ? c.createStereoPanner() : null; if (pan) { out.connect(pan); pan.connect(this.busEngine); } else out.connect(this.busEngine);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = E.lp; lp.Q.value = 1.2;
    const shaper = c.createWaveShaper(); shaper.curve = this.curve(E.drive * (0.8 + spec.engine.bark * 0.5)); shaper.oversample = '2x';
    const am = c.createGain(); am.gain.value = 1;
    const o1 = c.createOscillator(); o1.setPeriodicWave(this.waves[spec.engine.kind] || this.waves.i4);
    const o2 = c.createOscillator(); o2.setPeriodicWave(this.waves[spec.engine.kind] || this.waves.i4); o2.detune.value = 9;
    const sub = c.createOscillator(); sub.type = 'triangle';
    const g1 = c.createGain(), g2 = c.createGain(), gs = c.createGain(); g1.gain.value = 0.55; g2.gain.value = 0.3; gs.gain.value = E.sub * 0.5;
    o1.connect(g1); o2.connect(g2); sub.connect(gs); g1.connect(lp); g2.connect(lp); gs.connect(lp); lp.connect(shaper); shaper.connect(am); am.connect(out);
    // intake / exhaust texture
    const ns = c.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8; const ng = c.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng); ng.connect(out);
    // roughness LFO (uneven firing / boxer burble)
    let lfo = null, lfoG = null; if (E.am > 0) { lfo = c.createOscillator(); lfo.frequency.value = 9; lfoG = c.createGain(); lfoG.gain.value = E.am; lfo.connect(lfoG); lfoG.connect(am.gain); lfo.start(); }
    // turbo whine
    let tw = null, twg = null; if (spec.turbo > 0) { tw = c.createOscillator(); tw.type = 'sine'; twg = c.createGain(); twg.gain.value = 0; tw.connect(twg); twg.connect(out); tw.start(); }
    o1.start(); o2.start(); sub.start(); ns.start(0, Math.random());
    const v = { spec, E, out, pan, lp, o1, o2, sub, ng, nf, am, lfo, lfoG, tw, twg, g1, g2, gs, dead: false, lastGear: 1, shiftCool: 0, pops: 0 };
    this.voices.add(v); return v;
  }

  updateEngine(v, s) {
    if (!v || v.dead) return;
    const c = this.ctx, t = c.currentTime, E = v.E, spec = v.spec;
    const f = (s.rpm / 60) * (spec.engine.cyl / 2);
    const load = clamp(s.load, 0, 1), th = clamp(s.throttle, 0, 1);
    v.o1.frequency.setTargetAtTime(f, t, 0.03); v.o2.frequency.setTargetAtTime(f * 1.003, t, 0.03); v.sub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    v.lp.frequency.setTargetAtTime(E.lp * (0.6 + (s.rpm / spec.redline) * 1.3) * (0.7 + load * 0.9 + (s.boosting ? 0.4 : 0)), t, 0.05);
    const rpmN = s.rpm / spec.redline;
    const level = (0.1 + load * 0.34 + rpmN * 0.08) * (s.gain ?? 1) * (s.off ? 0 : 1);
    v.out.gain.setTargetAtTime(level, t, 0.04);
    v.ng.gain.setTargetAtTime((0.04 + th * 0.12) * (0.4 + rpmN), t, 0.05); v.nf.frequency.setTargetAtTime(500 + rpmN * 1800, t, 0.06);
    if (v.lfo) { v.lfo.frequency.setTargetAtTime(Math.max(5, f / 4), t, 0.1); v.lfoG.gain.setTargetAtTime(E.am * (1.2 - rpmN), t, 0.1); }
    // rev limiter chatter
    if (s.limiter) v.am.gain.setTargetAtTime(0.5 + 0.5 * Math.sin(t * 90), t, 0.01);
    else if (!v.lfo) v.am.gain.setTargetAtTime(1, t, 0.02);
    if (v.tw) { v.tw.frequency.setTargetAtTime(1500 + s.turbo * 5200, t, 0.05); v.twg.gain.setTargetAtTime(s.turbo * 0.045 * (s.gain ?? 1), t, 0.06); }
    if (v.pan) v.pan.pan.setTargetAtTime(clamp(s.pan || 0, -1, 1), t, 0.1);
    // events: gear change thunk / blow-off / backfire pops
    v.shiftCool -= 1 / 60;
    if (s.gear !== v.lastGear) { if (s.gear > v.lastGear && v.shiftCool <= 0) { this.shift(spec, s.gain ?? 1); v.shiftCool = 0.15; } v.lastGear = s.gear; }
    if (s.blowoff > 0.5 && !v.bov) { v.bov = true; this.blowoff(s.gain ?? 1); } else if (s.blowoff < 0.2) v.bov = false;
    if (s.backfire > 0.5 && !v.bf) { v.bf = true; this.backfire(s.gain ?? 1); } else if (s.backfire < 0.1) v.bf = false;
  }

  killEngine(v) { if (!v || v.dead) return; v.dead = true; const t = this.ctx.currentTime; v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { for (const n of [v.o1, v.o2, v.sub, v.lfo, v.tw]) { try { n && n.stop(); } catch (e) { /* already stopped */ } } try { v.out.disconnect(); } catch (e) { /* ok */ } }, 400); this.voices.delete(v); }

  /** player-only continuous layers */
  updatePlayer(s) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const sp = clamp(s.speed / 80, 0, 1.2);
    this.tyre.g.gain.setTargetAtTime(s.skid * (s.loose ? 0.12 : 0.3), t, 0.04); this.tyre.f.frequency.setTargetAtTime(1300 + s.speed * 11 + s.skid * 500, t, 0.06);
    this.tyre2.g.gain.setTargetAtTime(s.skid * s.skid * 0.14, t, 0.05);
    const roadK = s.surface === 'asphalt' || s.surface === 'wet' ? 0.2 : s.surface === 'curb' ? 0.22 : 0.45;
    this.road.g.gain.setTargetAtTime(Math.min(1, sp * 1.1) * roadK * 0.5 * (s.inside ? 1.4 : 1), t, 0.1); this.road.f.frequency.setTargetAtTime(240 + sp * 520 + (s.surface === 'grass' || s.surface === 'sand' ? 400 : 0), t, 0.1);
    this.wind.g.gain.setTargetAtTime(sp * sp * 0.2 + (s.boosting ? 0.06 : 0), t, 0.1); this.wind.f.frequency.setTargetAtTime(350 + sp * 1600, t, 0.1);
    const rum = s.rumble > 0.05 ? s.rumble : 0; this.rumble.g.gain.setTargetAtTime(rum * 0.22 * Math.min(1, sp * 3), t, 0.06); this.rumbleLfoGain.gain.setTargetAtTime(rum * 0.1, t, 0.1); this.rumbleLfo.frequency.setTargetAtTime(14 + sp * 55, t, 0.1);
    this.nitroNoise.g.gain.setTargetAtTime(s.boosting ? 0.1 : 0, t, 0.06); this.nitroNoise.f.frequency.setTargetAtTime(900 + sp * 1600, t, 0.1);
  }

  silence() { if (!this.ready) return; const t = this.ctx.currentTime; for (const n of [this.tyre, this.tyre2, this.road, this.wind, this.rumble, this.nitroNoise]) n.g.gain.setTargetAtTime(0, t, 0.05); for (const v of this.voices) v.out.gain.setTargetAtTime(0, t, 0.05); }

  // ----------------------------------------------------------------------------- one-shots
  burst(freq, q, dur, vol, type = 'bandpass', slideTo = null, dest = null) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); s.connect(f); f.connect(g); g.connect(dest || this.busSfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol = 0.2, type = 'sine', slideTo = null, delay = 0, dest = null) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); g.connect(dest || this.busSfx); o.start(t); o.stop(t + dur + 0.05);
  }
  shift(spec, gain = 1) { if (!this.ready) return; this.burst(180, 1, 0.07, 0.25 * gain, 'lowpass'); this.tone(90, 0.09, 0.18 * gain, 'sine', 55); if (spec.turbo > 0 || spec.engine.bark > 0.7) this.burst(900, 1.2, 0.12, 0.08 * gain, 'bandpass', 300); }
  blowoff(gain = 1) { if (this.ready) this.burst(4200, 1.4, 0.38, 0.22 * gain, 'bandpass', 2400); }
  backfire(gain = 1) { if (!this.ready) return; for (let i = 0; i < 3; i++) setTimeout(() => { if (!this.ready) return; this.burst(500 + Math.random() * 400, 0.8, 0.12, 0.34 * gain, 'lowpass'); this.tone(110 + Math.random() * 40, 0.1, 0.22 * gain, 'square', 60); }, i * (45 + Math.random() * 60)); }
  impact(k, metal = true) {
    if (!this.ready) return; const v = clamp(k / 18, 0, 1);
    this.burst(260 + v * 400, 0.7, 0.35, 0.9 * v + 0.1, 'lowpass'); this.tone(105, 0.28, 0.6 * v + 0.1, 'sine', 38);
    if (metal && v > 0.2) { this.burst(1800 + Math.random() * 1600, 4, 0.28, 0.25 * v, 'bandpass'); this.tone(620 + Math.random() * 400, 0.22, 0.1 * v, 'triangle'); }
  }
  scrape() { if (this.ready) this.burst(2400 + Math.random() * 800, 2, 0.16, 0.13, 'bandpass'); }
  nitro() { if (!this.ready) return; this.burst(600, 0.8, 0.9, 0.32, 'bandpass', 3600); this.tone(180, 0.7, 0.14, 'sawtooth', 640); }
  beep(f = 440, d = 0.2, v = 0.3) { if (this.ready) this.tone(f, d, v, 'square'); }
  ui(kind) {
    if (!this.ready) return;
    const T = { hover: [[880, 0.04, 0.05, 'sine']], click: [[620, 0.06, 0.12, 'triangle'], [930, 0.07, 0.1, 'triangle', 0.04]], confirm: [[523, 0.09, 0.16, 'triangle'], [784, 0.14, 0.16, 'triangle', 0.07]],
      back: [[520, 0.07, 0.1, 'triangle'], [390, 0.09, 0.1, 'triangle', 0.05]], error: [[180, 0.18, 0.2, 'sawtooth'], [150, 0.2, 0.18, 'sawtooth', 0.12]],
      unlock: [[523, 0.12, 0.16, 'triangle'], [659, 0.12, 0.16, 'triangle', 0.1], [784, 0.12, 0.16, 'triangle', 0.2], [1047, 0.3, 0.2, 'triangle', 0.3]], buy: [[880, 0.07, 0.12, 'square'], [1320, 0.12, 0.12, 'square', 0.07]], tick: [[1500, 0.02, 0.04, 'square']] }[kind] || [];
    for (const [f, d, v, ty, dl] of T) this.tone(f, d, v, ty, null, dl || 0);
  }
  countdown(n) { if (!this.ready) return; if (n > 0) { this.tone(440, 0.22, 0.28, 'square'); this.tone(220, 0.22, 0.16, 'sine'); } else { this.tone(880, 0.55, 0.3, 'square'); this.tone(1320, 0.55, 0.2, 'square'); this.tone(440, 0.55, 0.2, 'sawtooth'); } }
  whoosh() { if (this.ready) this.burst(400, 1.2, 0.7, 0.3, 'bandpass', 3000); }
  checkpoint() { if (this.ready) { this.tone(1046, 0.09, 0.14, 'triangle'); this.tone(1568, 0.14, 0.12, 'triangle', null, 0.06); } }
  overtake() { if (this.ready) { this.tone(660, 0.09, 0.14, 'square'); this.tone(990, 0.12, 0.14, 'square', null, 0.07); } }

  // ----------------------------------------------------------------------------- music
  startMusic(kind) {
    if (!this.ready || this.musicKind === kind) return; this.stopMusic(); this.musicKind = kind; this.step = 0; this.nextT = this.ctx.currentTime + 0.1; this.energy = 0;
    this.musicTimer = setInterval(() => this.tickMusic(), 40);
  }
  stopMusic() { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; this.musicKind = null; }
  setEnergy(e) { this.energy = e; }
  jingle(kind) {
    if (!this.ready) return; this.stopMusic();
    const seq = kind === 'win' ? [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.6], [84, 0.72], [88, 0.84], [91, 1.1]] : kind === 'lose' ? [[67, 0], [64, 0.25], [60, 0.5], [55, 0.9]] : [[69, 0], [72, 0.15], [76, 0.3], [81, 0.5]];
    seq.forEach(([n, d]) => { this.tone(midi(n), 0.45, 0.2, kind === 'lose' ? 'sawtooth' : 'triangle', null, d, this.busMusic); this.tone(midi(n - 12), 0.5, 0.12, 'sine', null, d, this.busMusic); });
    if (kind === 'win') [60, 64, 67, 72].forEach((n) => this.tone(midi(n), 1.8, 0.1, 'sawtooth', null, 1.1, this.busMusic));
  }
  mnote(freq, t, dur, vol, type, dest, cutoff = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq; let last = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); last = f; }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur); last.connect(g); g.connect(dest || this.busMusic); o.start(t); o.stop(t + dur + 0.05);
  }
  drum(kind, t, vol = 0.5) {
    const c = this.ctx;
    if (kind === 'kick') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(this.busMusic); o.start(t); o.stop(t + 0.25); }
    else { const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 1500 : 7000; const g = c.createGain(); g.gain.setValueAtTime(vol * (kind === 'snare' ? 0.7 : 0.25), t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'snare' ? 0.16 : 0.04)); s.connect(f); f.connect(g); g.connect(this.busMusic); s.start(t, Math.random()); s.stop(t + 0.2); }
  }
  tickMusic() {
    const c = this.ctx; if (!c || c.state !== 'running') { if (c) this.nextT = Math.max(this.nextT, c.currentTime); return; }
    const kind = this.musicKind; const bpm = kind === 'race' ? 132 : 78, sd = 60 / bpm / 4;
    while (this.nextT < c.currentTime + 0.25) {
      const t = this.nextT, s = this.step++, bar = Math.floor(s / 16) % 4, st = s % 16;
      if (kind === 'menu') {
        const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]][bar];
        if (st === 0) chords.forEach((n, i) => this.mnote(midi(n - 12 + (i ? 12 : 0)), t, sd * 15, 0.1, 'sawtooth', null, 700));
        if (st % 2 === 0) this.mnote(midi(chords[(st / 2) % 4] + 12), t, sd * 2.5, 0.1, 'triangle');
        if (st === 8) this.mnote(midi(chords[0] + 24), t, sd * 6, 0.05, 'sine');
      } else if (kind === 'race') {
        const roots = [38, 34, 41, 36][bar], e = this.energy || 0;
        if (st % 4 === 0) this.drum('kick', t, 0.55); if (st % 8 === 4) this.drum('snare', t, 0.5); if (st % 2 === 0 || e > 0.5) this.drum('hat', t, 0.5);
        const bass = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 5, 0, 7, 0][st];
        if (st % 2 === 0 || st % 4 === 3) this.mnote(midi(roots + bass), t, sd * 1.8, 0.18, 'sawtooth', null, 500 + e * 900);
        const arp = [0, 7, 12, 15, 12, 7, 12, 19][st % 8], ch = bar === 1 ? 0 : 3;
        if (e > 0.25 || bar % 2) this.mnote(midi(roots + 24 + arp + (bar === 2 ? 2 : 0) - ch * 0), t, sd * 0.9, 0.06 + e * 0.05, 'square', null, 1800 + e * 2500);
        if (st === 0) [0, 7, 12].forEach((n) => this.mnote(midi(roots + 12 + n), t, sd * 15, 0.045, 'sawtooth', null, 900));
      }
      this.nextT += sd;
    }
  }
}
