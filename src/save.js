// Persistent progression + settings (localStorage, with an in-memory fallback).
import { CARS, CAR_BY_ID, upgradeCost, UPGRADES } from './cars.js';
import { TRACKS } from './tracks.js';

const KEY = 'voidforge-racing.v2';
export const DEFAULT_SETTINGS = {
  quality: 'high', resScale: 1, bloom: true, motionBlur: true, shadows: true, camShake: 1, fov: 1, motion: 1, units: 'kmh',
  master: 0.8, music: 0.5, sfx: 0.9, engine: 0.85, steerSens: 1, assist: 0.55, touchSize: 1, tilt: false, showFps: false, autoGear: true,
};
const fresh = () => ({
  v: 2, credits: 15000, xp: 0, owned: ['aurelia', 'brawler'], selected: 'aurelia', cars: {}, records: {}, drift: {}, champ: {}, cupsWon: [],
  stats: { races: 0, wins: 0, podiums: 0, km: 0, driftPts: 0 }, settings: { ...DEFAULT_SETTINGS }, seenTitle: false,
});

let mem = null;
function read() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return mem; } }
function write(d) { mem = d; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked (private mode / sandboxed iframe) */ } }

export const levelOf = (xp) => Math.floor((1 + Math.sqrt(1 + (4 * xp) / 300)) / 2);
export const xpForLevel = (l) => 300 * l * (l - 1);

class SaveStore {
  constructor() {
    const d = read();
    this.d = d && d.v === 2 ? { ...fresh(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) }, stats: { ...fresh().stats, ...(d.stats || {}) } } : fresh();
    if (typeof location !== 'undefined' && /[?&]unlockall\b/.test(location.search)) { this.d.owned = CARS.map((c) => c.id); this.d.credits = Math.max(this.d.credits, 500000); this.d.xp = Math.max(this.d.xp, xpForLevel(9)); this.cheat = true; }
    this.listeners = [];
  }
  commit() { if (!this.cheat) write(this.d); this.listeners.forEach((f) => f()); }
  on(f) { this.listeners.push(f); }
  get settings() { return this.d.settings; }
  get level() { return levelOf(this.d.xp); }
  get levelProgress() { const l = this.level, a = xpForLevel(l), b = xpForLevel(l + 1); return { level: l, into: this.d.xp - a, need: b - a, frac: (this.d.xp - a) / (b - a) }; }
  addXP(n) { const before = this.level; this.d.xp += n; const after = this.level; this.commit(); return after > before ? after : 0; }
  addCredits(n) { this.d.credits = Math.max(0, this.d.credits + n); this.commit(); }
  owns(id) { return this.d.owned.includes(id); }
  carUnlockedForPurchase(id) { return this.level >= CAR_BY_ID[id].reqLevel; }
  buyCar(id) { const c = CAR_BY_ID[id]; if (this.owns(id) || this.d.credits < c.price || !this.carUnlockedForPurchase(id)) return false; this.d.credits -= c.price; this.d.owned.push(id); this.commit(); return true; }
  grantCar(id) { if (!this.owns(id)) { this.d.owned.push(id); this.commit(); return true; } return false; }
  select(id) { if (this.owns(id)) { this.d.selected = id; this.commit(); } }
  setup(id) {
    const c = CAR_BY_ID[id]; if (!this.d.cars[id]) this.d.cars[id] = { paint: c.colors[0], finish: 'metallic', rim: c.rim, rimColor: '#e4e8ee', upgrades: {} };
    return this.d.cars[id];
  }
  patchSetup(id, patch) { Object.assign(this.setup(id), patch); this.commit(); }
  upgradeCostFor(id, up) { const lv = (this.setup(id).upgrades[up] || 0) + 1; return upgradeCost(CAR_BY_ID[id], up, lv); }
  buyUpgrade(id, up) {
    const s = this.setup(id), def = UPGRADES.find((u) => u.id === up), lv = s.upgrades[up] || 0;
    if (lv >= def.max) return false; const cost = this.upgradeCostFor(id, up); if (this.d.credits < cost) return false;
    this.d.credits -= cost; s.upgrades[up] = lv + 1; this.commit(); return true;
  }
  trackUnlocked(t) { return this.level >= t.unlock || this.cheat === true; }
  record(trackId) { return this.d.records[trackId] || null; }
  setRecord(trackId, patch) { this.d.records[trackId] = { ...(this.d.records[trackId] || {}), ...patch }; this.commit(); }
  reset() { this.d = fresh(); this.commit(); }
}
export const Save = new SaveStore();
export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');

// -------------------------------------------------------------------------------------------------
export const CUPS = [
  { id: 'rookie', name: 'Rookie Cup', blurb: 'Learn the ropes on home asphalt.', difficulty: 0, reward: { credits: 30000, car: 'ridgeback' },
    events: [{ track: 'circuit', laps: 2 }, { track: 'coast', laps: 2 }, { track: 'circuit', laps: 3 }] },
  { id: 'pro', name: 'Pro Cup', blurb: 'City nights, mountain passes and desert sprints.', difficulty: 1, req: 'rookie', reward: { credits: 80000, car: 'vantara' },
    events: [{ track: 'neon', laps: 2 }, { track: 'mountain', laps: 2 }, { track: 'coast', laps: 3 }, { track: 'desert', laps: 2 }] },
  { id: 'apex', name: 'Apex Cup', blurb: 'Every circuit. Elite opposition. One champion.', difficulty: 2, req: 'pro', reward: { credits: 200000, car: 'helion' },
    events: [{ track: 'circuit', laps: 3 }, { track: 'neon', laps: 3 }, { track: 'mountain', laps: 2 }, { track: 'desert', laps: 3 }, { track: 'coast', laps: 3 }] },
];
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
export const DIFFICULTY = [
  { id: 0, name: 'Rookie', skill: 0.84, rubber: 0.07, mistakes: 0.5, aggr: 0.25 },
  { id: 1, name: 'Pro', skill: 0.91, rubber: 0.05, mistakes: 0.28, aggr: 0.5 },
  { id: 2, name: 'Elite', skill: 0.965, rubber: 0.03, mistakes: 0.12, aggr: 0.75 },
  { id: 3, name: 'Legend', skill: 1.01, rubber: 0.0, mistakes: 0.04, aggr: 0.95 },
];
export const DRIFT_MEDALS = { circuit: [18000, 42000, 80000], coast: [14000, 34000, 66000], neon: [16000, 38000, 72000], mountain: [20000, 46000, 88000], desert: [16000, 38000, 74000] };
