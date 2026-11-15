// Procedural audio (Web Audio): engine, tyre squeal, wind, impacts, countdown beeps. No asset files.
export class AudioEngine {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(ctx.destination);

    // engine: two detuned oscillators through a low-pass, with a sub for body
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 800; this.engFilter.Q.value = 2;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'triangle';
    const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.22; const g3 = ctx.createGain(); g3.gain.value = 0.6;
    this.o1.connect(g1).connect(this.engFilter); this.o2.connect(g2).connect(this.engFilter); this.o3.connect(g3).connect(this.engFilter);
    this.engFilter.connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start(); this.o3.start();

    // noise bed (white noise, looped)
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return { f, g };
    };
    this.skid = mkNoise('bandpass', 1900, 3.5);
    this.wind = mkNoise('lowpass', 500, 0.5);
    this.grass = mkNoise('lowpass', 380, 0.7);
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  /** st: { speed (m/s), top, throttle (0..1), skid (0..1), boosting, offroad, rpm (0..1) } */
  update(st) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = st.rpm;
    const base = 52 + rpm * 190;
    this.o1.frequency.setTargetAtTime(base, t, 0.04);
    this.o2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.o3.frequency.setTargetAtTime(base * 0.25, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(380 + rpm * 1400 + st.throttle * 700, t, 0.06);
    this.eng.gain.setTargetAtTime(st.active ? 0.14 + st.throttle * 0.16 + rpm * 0.05 : 0, t, 0.06);
    this.skid.g.gain.setTargetAtTime(st.skid * 0.22, t, 0.05);
    this.skid.f.frequency.setTargetAtTime(1500 + st.speed * 12, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(1, st.speed / st.top) ** 1.6 * 0.3 + (st.boosting ? 0.1 : 0), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + st.speed * 14, t, 0.1);
    this.grass.g.gain.setTargetAtTime(st.offroad ? Math.min(1, st.speed / 25) * 0.28 : 0, t, 0.08);
  }

  thump(intensity) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + intensity * 40;
    const g = ctx.createGain(); const v = Math.min(1, intensity / 18) * 0.9;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const og = ctx.createGain(); og.gain.setValueAtTime(v * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.35);
  }

  beep(freq = 440, dur = 0.18, vol = 0.35) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  whoosh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.8);
  }

  silence() { if (this.ready) this.update({ rpm: 0, throttle: 0, skid: 0, speed: 0, top: 68, boosting: false, offroad: false, active: false }); }
}
