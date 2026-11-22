/**
 * Fully synthesised audio (WebAudio): zero shipped audio files, original sounds.
 * Spatialisation is cheap on purpose: distance gain + stereo pan + a shared short "street slap" reverb send.
 */
import type { WeaponId } from '../gameplay/weapons.ts';

interface ShotProfile { crack: number; thump: number; thumpDur: number; body: number; tail: number; pitch: number; }
const SHOT: Record<WeaponId, ShotProfile> = {
  knife: { crack: 0, thump: 0, thumpDur: 0, body: 0, tail: 0, pitch: 1 },
  p50:   { crack: 0.9, thump: 0.8, thumpDur: 0.09, body: 0.6, tail: 0.5, pitch: 1.0 },
  m9:    { crack: 0.7, thump: 0.55, thumpDur: 0.07, body: 0.5, tail: 0.35, pitch: 1.25 },
  a5:    { crack: 1.0, thump: 1.0, thumpDur: 0.11, body: 0.8, tail: 0.6, pitch: 0.9 },
  t12:   { crack: 0.8, thump: 1.5, thumpDur: 0.2, body: 1.1, tail: 0.8, pitch: 0.6 },
  r7:    { crack: 1.4, thump: 1.2, thumpDur: 0.16, body: 0.9, tail: 1.0, pitch: 0.8 },
};

export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private fxBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  volume = 0.7; musicVolume = 0.35;
  private lastStep = new Map<number, number>();
  private ambience: { stop: () => void } | null = null;
  private music: { stop: () => void } | null = null;
  private voices = 0;

  /** call from a user gesture */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch { this.ctx = null; return; }
    const c = this.ctx!;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
    this.fxBus = c.createGain(); this.musicGain = c.createGain(); this.musicGain.gain.value = this.musicVolume;
    this.fxBus.connect(comp); this.musicGain.connect(comp); comp.connect(this.master); this.master.connect(c.destination);
    // noise + reverb impulse
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const irLen = Math.floor(c.sampleRate * 0.7); const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const a = ir.getChannelData(ch); for (let i = 0; i < irLen; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2); }
    this.reverb = c.createConvolver(); this.reverb.buffer = ir;
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.fxBus);
  }

  setVolume(v: number, music: number) {
    this.volume = v; this.musicVolume = music;
    if (this.ctx) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); this.musicGain.gain.setTargetAtTime(music, this.ctx.currentTime, 0.1); }
  }

  // ---------------------------------------------------------------- primitives
  private route(gain: number, pan: number, reverb = 0.15): GainNode | null {
    const c = this.ctx; if (!c || this.voices > 60) return null;
    const g = c.createGain(); g.gain.value = gain;
    let out: AudioNode = g;
    if (c.createStereoPanner && pan !== 0) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
    out.connect(this.fxBus);
    if (reverb > 0) { const s = c.createGain(); s.gain.value = reverb; out.connect(s); s.connect(this.reverbSend); }
    this.voices++; setTimeout(() => { this.voices--; }, 1500);
    return g;
  }

  private tone(dest: AudioNode, freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number) {
    const c = this.ctx!; const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dest: AudioNode, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, when = 0, q = 0.7) {
    const c = this.ctx!; const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = false;
    const off = Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, off, dur + 0.05);
  }

  // ---------------------------------------------------------------- game sounds
  /** world sound: `dist` metres from the listener, `pan` -1..1 */
  shot(w: WeaponId, dist: number, pan: number, local: boolean) {
    if (!this.ctx) return;
    const p = SHOT[w];
    if (w === 'knife') { this.knife(dist, pan); return; }
    const att = local ? 1 : Math.max(0, 1 - dist / 85) ** 1.5;
    if (att < 0.01) return;
    const dest = this.route(0.9 * att, local ? 0 : pan, 0.28 + p.tail * 0.2); if (!dest) return;
    this.noise(dest, 0.03, 'highpass', 5000, 3000, 0.9 * p.crack);
    this.noise(dest, 0.12 + p.tail * 0.12, 'lowpass', 5200 * p.pitch, 380, 1.0 * p.body, 0, 0.9);
    this.tone(dest, 150 * p.pitch, p.thumpDur, 'sine', 1.1 * p.thump, 0, 42);
    if (dist > 25 && !local) this.noise(dest, 0.5, 'lowpass', 900, 200, 0.25 * att, 0.08 + dist / 340);  // distant rumble / delay
  }
  private knife(dist: number, pan: number) {
    const dest = this.route(Math.max(0, 1 - dist / 20) * 0.8, pan, 0.05); if (!dest) return;
    this.noise(dest, 0.14, 'bandpass', 3800, 1200, 0.6, 0, 1.2);
  }
  empty(local = true) { if (!this.ctx) return; const d = this.route(0.5, 0, 0.0); if (d) this.tone(d, 900, 0.03, 'square', 0.3); void local; }
  reload(dist: number, pan: number, w: WeaponId) {
    if (!this.ctx) return;
    const att = Math.max(0, 1 - dist / 22); if (att < 0.02) return;
    const d = this.route(0.7 * att, pan, 0.05); if (!d) return;
    const heavy = w === 't12' || w === 'r7';
    this.noise(d, 0.05, 'bandpass', 1800, 900, 0.7, 0.15); this.tone(d, 280, 0.05, 'square', 0.25, 0.15);           // mag out
    this.noise(d, 0.07, 'bandpass', 2400, 1200, 0.8, 0.9); this.tone(d, 200, 0.06, 'square', 0.3, 0.92);            // mag in
    this.noise(d, 0.05, 'bandpass', 3200, 1600, 0.9, heavy ? 1.7 : 1.45); this.tone(d, 450, 0.04, 'square', 0.28, heavy ? 1.7 : 1.45); // bolt / rack
  }
  equip(dist = 0, pan = 0) { if (!this.ctx) return; const d = this.route(Math.max(0, 1 - dist / 14) * 0.6, pan, 0.03); if (d) { this.noise(d, 0.06, 'bandpass', 1500, 800, 0.6); this.tone(d, 320, 0.04, 'square', 0.18, 0.02); } }
  /** footsteps on cobbles / stone; `id` rate-limits per player */
  step(id: number, dist: number, pan: number, speedFrac: number, crouch: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime; if (now - (this.lastStep.get(id) ?? 0) < 0.12) return; this.lastStep.set(id, now);
    const att = Math.max(0, 1 - dist / 30) ** 1.6 * (crouch ? 0.35 : 0.5 + 0.5 * speedFrac); if (att < 0.01) return;
    const d = this.route(0.55 * att, pan, 0.1); if (!d) return;
    this.noise(d, 0.07, 'bandpass', 700 + Math.random() * 250, 260, 0.9, 0, 0.9);
    this.tone(d, 95 + Math.random() * 20, 0.06, 'sine', 0.6, 0, 55);
    this.noise(d, 0.025, 'highpass', 3500, 2500, 0.25);   // grit
  }
  jump() { if (!this.ctx) return; const d = this.route(0.3, 0, 0.1); if (d) this.noise(d, 0.08, 'bandpass', 600, 300, 0.5); }
  land(strength: number) { if (!this.ctx) return; const d = this.route(Math.min(0.9, 0.3 + strength * 0.08), 0, 0.2); if (d) { this.tone(d, 80, 0.12, 'sine', 0.9, 0, 40); this.noise(d, 0.09, 'lowpass', 900, 200, 0.6); } }
  hitMarker(head: boolean, kill: boolean) {
    if (!this.ctx) return; const d = this.route(0.55, 0, 0.0); if (!d) return;
    this.tone(d, head ? 2300 : 1500, 0.045, 'square', 0.28);
    if (head) this.tone(d, 3100, 0.07, 'triangle', 0.22, 0.02);
    if (kill) { this.tone(d, 880, 0.12, 'triangle', 0.3, 0.05); this.tone(d, 1320, 0.2, 'triangle', 0.3, 0.12); }
  }
  hurt(heavy: boolean) { if (!this.ctx) return; const d = this.route(heavy ? 0.9 : 0.6, 0, 0.1); if (d) { this.tone(d, 110, 0.18, 'sine', 0.9, 0, 50); this.noise(d, 0.12, 'lowpass', 1400, 250, 0.7); } }
  impact(dist: number, pan: number, kind: 'world' | 'player') {
    if (!this.ctx) return; const att = Math.max(0, 1 - dist / 28) ** 1.5; if (att < 0.03) return;
    const d = this.route(0.45 * att, pan, 0.1); if (!d) return;
    if (kind === 'player') { this.noise(d, 0.09, 'lowpass', 1100, 250, 0.9); this.tone(d, 130, 0.07, 'sine', 0.6, 0, 70); }
    else { this.noise(d, 0.06, 'bandpass', 2600, 1200, 0.7, 0, 1.5); this.tone(d, 1800 + Math.random() * 600, 0.03, 'triangle', 0.15, 0.005); }
  }
  uiClick() { if (!this.ctx) return; const d = this.route(0.35, 0, 0); if (d) { this.tone(d, 640, 0.04, 'triangle', 0.3); this.tone(d, 960, 0.05, 'triangle', 0.2, 0.025); } }
  uiError() { if (!this.ctx) return; const d = this.route(0.4, 0, 0); if (d) { this.tone(d, 180, 0.12, 'sawtooth', 0.3); } }
  buy() { if (!this.ctx) return; const d = this.route(0.5, 0, 0.02); if (d) { this.tone(d, 780, 0.05, 'triangle', 0.3); this.tone(d, 1170, 0.09, 'triangle', 0.3, 0.05); this.noise(d, 0.04, 'highpass', 4000, 3000, 0.3, 0.02); } }
  beep(freq = 1000, vol = 0.4) { if (!this.ctx) return; const d = this.route(vol, 0, 0.2); if (d) this.tone(d, freq, 0.09, 'sine', 0.5); }
  countdown() { if (!this.ctx) return; const d = this.route(0.4, 0, 0.1); if (d) this.tone(d, 660, 0.12, 'triangle', 0.4); }
  roundStart() { if (!this.ctx) return; const d = this.route(0.7, 0, 0.35); if (!d) return; this.tone(d, 220, 0.5, 'sawtooth', 0.35); this.tone(d, 330.5, 0.5, 'sawtooth', 0.3); this.tone(d, 440, 0.45, 'triangle', 0.3, 0.05); }
  roundEnd(win: boolean) {
    if (!this.ctx) return; const d = this.route(0.6, 0, 0.3); if (!d) return;
    const notes = win ? [392, 494, 587, 784] : [330, 277, 233, 196];
    notes.forEach((n, i) => this.tone(d, n, 0.28, win ? 'triangle' : 'sawtooth', win ? 0.35 : 0.2, i * 0.12));
  }
  plantStart() { if (!this.ctx) return; const d = this.route(0.4, 0, 0.1); if (d) for (let i = 0; i < 5; i++) this.tone(d, 700 + i * 90, 0.07, 'square', 0.15, i * 0.5); }
  planted() { if (!this.ctx) return; const d = this.route(0.7, 0, 0.4); if (!d) return; this.tone(d, 220, 0.8, 'sawtooth', 0.3, 0, 110); this.tone(d, 880, 0.2, 'square', 0.25); this.tone(d, 880, 0.2, 'square', 0.25, 0.3); }
  defused() { if (!this.ctx) return; const d = this.route(0.7, 0, 0.3); if (!d) return; [523, 659, 784, 1047].forEach((n, i) => this.tone(d, n, 0.18, 'triangle', 0.35, i * 0.09)); }
  explosion(dist: number) {
    if (!this.ctx) return; const att = Math.max(0.15, 1 - dist / 140); const d = this.route(1.0 * att, 0, 0.6); if (!d) return;
    this.noise(d, 1.8, 'lowpass', 1400, 50, 1.6); this.tone(d, 65, 1.2, 'sine', 1.6, 0, 22); this.noise(d, 0.4, 'highpass', 3000, 800, 0.8);
  }

  // ---------------------------------------------------------------- ambience & music
  startAmbience() {
    if (!this.ctx || this.ambience) return; const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.4;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    src.connect(f); f.connect(g); g.connect(this.fxBus); src.start();
    let alive = true;
    const bird = () => { if (!alive || !this.ctx) return; const d = this.route(0.05 + Math.random() * 0.05, Math.random() * 2 - 1, 0.3); if (d) { const base = 2400 + Math.random() * 1400; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(d, base, 0.07, 'sine', 0.5, i * 0.11, base * 1.25); } setTimeout(bird, 5000 + Math.random() * 9000); };
    setTimeout(bird, 3000);
    this.ambience = { stop: () => { alive = false; try { src.stop(); lfo.stop(); } catch { /* ignore */ } this.ambience = null; } };
  }
  stopAmbience() { this.ambience?.stop(); }

  /** slow Phrygian-flavoured pad for menus: a handful of oscillators, nearly free */
  startMusic() {
    if (!this.ctx || this.music) return; const c = this.ctx;
    const chords = [[110, 164.8, 220, 261.6], [116.5, 174.6, 233, 277.2], [98, 146.8, 196, 233], [110, 164.8, 220, 261.6]];
    let idx = 0, alive = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.connect(this.musicGain);
    const play = () => {
      if (!alive || !this.ctx) return;
      const chord = chords[idx++ % chords.length]!; const t = c.currentTime;
      for (const hz of chord) for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = det;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 2.2); g.gain.linearRampToValueAtTime(0.0001, t + 6.4);
        o.connect(g); g.connect(f); o.start(t); o.stop(t + 6.5);
      }
      setTimeout(play, 5600);
    };
    play();
    this.music = { stop: () => { alive = false; this.music = null; } };
  }
  stopMusic() { this.music?.stop(); }
}

export const sfx = new Sfx();
