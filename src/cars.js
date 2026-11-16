// The garage: six original cars, their physical parameters, upgrades and derived stats.
// Brand: "Voidforge Motors" (fictional). Numbers are tuned for fun, not realism-for-its-own-sake.

export const CARS = [
  {
    id: 'aurelia', name: 'Aurelia A1', cls: 'Sports Coupe', tagline: 'Light, nimble, endlessly playable.',
    price: 0, reqLevel: 1, shape: 'coupe',
    mass: 1120, hp: 262, topKmh: 262, redline: 8200, idle: 950, gears: 6, drive: 'RWD', turbo: 0,
    engine: { kind: 'i4', cyl: 4, rough: 0.5, bark: 0.4 },
    wheelbase: 2.46, trackW: 1.52, length: 4.18, width: 1.78, wf: 0.52, cgH: 0.46, rw: 0.325,
    muF: 1.42, muR: 1.4, B: 11.0, brakeG: 1.25, df: 0.1, lock: 0.6, steerSpeed: 26, rollF: 0.55, rollK: 0.07, pitchK: 0.05, nitro: 0.9,
    colors: ['#d92b2b', '#1f6fff'], stripe: false, rim: 'spoke5', brake: '#e4572e',
  },
  {
    id: 'brawler', name: 'Brawler GT', cls: 'Muscle Car', tagline: 'Big V8, bigger attitude. Handle with care.',
    price: 0, reqLevel: 1, shape: 'muscle',
    mass: 1720, hp: 540, topKmh: 288, redline: 6600, idle: 750, gears: 6, drive: 'RWD', turbo: 0,
    engine: { kind: 'v8', cyl: 8, rough: 0.9, bark: 1.0 },
    wheelbase: 2.86, trackW: 1.64, length: 4.82, width: 1.92, wf: 0.55, cgH: 0.55, rw: 0.35,
    muF: 1.22, muR: 1.14, B: 8.5, brakeG: 1.05, df: 0.06, lock: 0.56, steerSpeed: 24, rollF: 0.62, rollK: 0.11, pitchK: 0.08, nitro: 1.0,
    colors: ['#f0a81a', '#222428'], stripe: true, rim: 'classic', brake: '#d1d5db',
  },
  {
    id: 'vantara', name: 'Vantara V10', cls: 'Supercar', tagline: 'Mid-engine drama with a screaming V10.',
    price: 42000, reqLevel: 3, shape: 'super',
    mass: 1430, hp: 640, topKmh: 322, redline: 8700, idle: 1000, gears: 7, drive: 'RWD', turbo: 0,
    engine: { kind: 'v10', cyl: 10, rough: 0.35, bark: 0.85 },
    wheelbase: 2.7, trackW: 1.68, length: 4.55, width: 1.96, wf: 0.43, cgH: 0.42, rw: 0.345,
    muF: 1.5, muR: 1.52, B: 10.5, brakeG: 1.4, df: 0.28, lock: 0.54, steerSpeed: 28, rollF: 0.5, rollK: 0.06, pitchK: 0.05, nitro: 1.0,
    colors: ['#6a2bd9', '#e8e8ee'], stripe: false, rim: 'split10', brake: '#f2c200',
  },
  {
    id: 'ridgeback', name: 'Ridgeback RX', cls: 'Rally Special', tagline: 'Turbocharged, soft, and fearless on any surface.',
    price: 28000, reqLevel: 2, shape: 'rally',
    mass: 1290, hp: 410, topKmh: 238, redline: 7200, idle: 900, gears: 6, drive: 'AWD', turbo: 0.42,
    engine: { kind: 'f4t', cyl: 4, rough: 0.8, bark: 0.7 },
    wheelbase: 2.6, trackW: 1.58, length: 4.4, width: 1.84, wf: 0.58, cgH: 0.54, rw: 0.34,
    muF: 1.3, muR: 1.28, B: 9.0, brakeG: 1.2, df: 0.12, lock: 0.64, steerSpeed: 25, rollF: 0.58, rollK: 0.1, pitchK: 0.07, nitro: 0.9, loose: 1.35,
    colors: ['#1d63d6', '#ffd23d'], stripe: true, rim: 'mesh', brake: '#d91f26',
  },
  {
    id: 'kestrel', name: 'Kestrel R', cls: 'Track Car', tagline: 'Pure grip. Wings, slicks and razor precision.',
    price: 64000, reqLevel: 5, shape: 'track',
    mass: 890, hp: 500, topKmh: 304, redline: 9200, idle: 1100, gears: 6, drive: 'RWD', turbo: 0,
    engine: { kind: 'v6', cyl: 6, rough: 0.3, bark: 0.9 },
    wheelbase: 2.56, trackW: 1.66, length: 4.3, width: 1.94, wf: 0.45, cgH: 0.36, rw: 0.335,
    muF: 1.72, muR: 1.72, B: 13.0, brakeG: 1.7, df: 0.8, lock: 0.5, steerSpeed: 30, rollF: 0.5, rollK: 0.035, pitchK: 0.03, nitro: 0.8,
    colors: ['#18c4a8', '#15181e'], stripe: true, rim: 'turbine', brake: '#2e86de',
  },
  {
    id: 'helion', name: 'Helion X', cls: 'Hypercar', tagline: 'Twin-turbo hybrid. Absurd speed, absurd grip.',
    price: 160000, reqLevel: 7, shape: 'hyper',
    mass: 1310, hp: 1050, topKmh: 376, redline: 8000, idle: 1000, gears: 7, drive: 'AWD', turbo: 0.35,
    engine: { kind: 'v8tt', cyl: 8, rough: 0.25, bark: 0.6 },
    wheelbase: 2.74, trackW: 1.72, length: 4.7, width: 2.0, wf: 0.44, cgH: 0.38, rw: 0.35,
    muF: 1.62, muR: 1.66, B: 11.5, brakeG: 1.6, df: 0.6, lock: 0.5, steerSpeed: 30, rollF: 0.5, rollK: 0.04, pitchK: 0.035, nitro: 1.25,
    colors: ['#0e0f12', '#00e5ff'], stripe: false, rim: 'turbine', brake: '#00b4d8',
  },
];

export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

export const UPGRADES = [
  { id: 'engine', name: 'Engine', desc: '+power and +top speed', max: 3, base: 0.12 },
  { id: 'tires', name: 'Tyres', desc: '+grip in corners', max: 3, base: 0.1 },
  { id: 'brakes', name: 'Brakes', desc: '+braking power', max: 3, base: 0.07 },
  { id: 'nitro', name: 'Nitro', desc: '+capacity and +thrust', max: 3, base: 0.09 },
  { id: 'weight', name: 'Weight', desc: '-mass for quicker turn-in', max: 3, base: 0.08 },
];

export const PAINTS = [
  ['Racing Red', '#d92b2b'], ['Solar Orange', '#ff7a1a'], ['Canary', '#ffd21f'], ['Lime Rush', '#8ee000'], ['Emerald', '#13a85b'],
  ['Teal Storm', '#18c4a8'], ['Cyan Flash', '#00c2ff'], ['Kobalt', '#1f5fe0'], ['Nightfall', '#1b2a6b'], ['Royal Violet', '#6a2bd9'],
  ['Hot Pink', '#ff4fa3'], ['Pearl White', '#f1f3f6'], ['Silver Arrow', '#aab2bd'], ['Gunmetal', '#4a525c'], ['Obsidian', '#0e0f12'],
];
export const FINISHES = [
  { id: 'gloss', name: 'Gloss', metal: 0.2, rough: 0.28, clear: 1.0 },
  { id: 'metallic', name: 'Metallic', metal: 0.85, rough: 0.3, clear: 1.0 },
  { id: 'pearl', name: 'Pearl', metal: 0.5, rough: 0.2, clear: 1.0, sheen: true },
  { id: 'matte', name: 'Matte', metal: 0.1, rough: 0.72, clear: 0.0 },
];
export const RIMS = [
  { id: 'spoke5', name: 'Apex 5' }, { id: 'split10', name: 'Split-10' }, { id: 'mesh', name: 'Lattice' },
  { id: 'turbine', name: 'Turbine' }, { id: 'classic', name: 'Heritage' },
];
export const RIM_COLORS = [
  ['Chrome', '#e4e8ee'], ['Graphite', '#2c2f36'], ['Gold', '#d4a43a'], ['Bronze', '#8a5a2b'], ['Matte Black', '#101114'], ['Hyper Blue', '#2f7bff'],
];

export const upgradeCost = (car, id, level) => Math.round((car.price * 0.06 + 2500) * level * (id === 'engine' ? 1.4 : 1));

/** Fold upgrades into a car spec and derive everything the physics + UI need. */
export function deriveSpec(car, up = {}) {
  const lv = (id) => up[id] || 0;
  const s = { ...car };
  s.upgradeLevels = { engine: lv('engine'), tires: lv('tires'), brakes: lv('brakes'), nitro: lv('nitro'), weight: lv('weight') };
  s.hp = car.hp * (1 + 0.12 * lv('engine'));
  s.topKmh = car.topKmh * (1 + 0.025 * lv('engine'));
  s.muF = car.muF * (1 + 0.1 * lv('tires')); s.muR = car.muR * (1 + 0.1 * lv('tires'));
  s.brakeG = car.brakeG * (1 + 0.07 * lv('brakes'));
  s.nitroCap = 0.9 + 0.3 * lv('nitro'); s.nitroForce = (0.5 + 0.12 * lv('nitro')) * car.nitro;
  s.mass = car.mass * (1 - 0.03 * lv('weight'));
  s.a = car.wheelbase * (1 - car.wf);   // CG -> front axle
  s.b = car.wheelbase * car.wf;         // CG -> rear axle
  s.Iz = s.mass * Math.pow(0.5 * car.wheelbase, 2) * 0.95;
  // gearbox: geometric ratios from a launch gear to the top gear, top gear hits redline at top speed
  const redRad = (car.redline * Math.PI) / 30;
  const vTop = s.topKmh / 3.6;
  const gTop = (redRad * car.rw) / vTop;
  const spread = car.gears >= 7 ? 4.3 : 3.7;
  s.ratios = [];
  for (let i = 0; i < car.gears; i++) s.ratios.push(gTop * Math.pow(spread, (car.gears - 1 - i) / (car.gears - 1)));
  s.reverseRatio = s.ratios[0] * 1.05;
  s.eta = 0.9;
  // torque scale from horsepower (peak power occurs where torque*omega is max)
  const shape = torqueShape;
  let bestP = 0;
  for (let x = 0.3; x <= 1.0; x += 0.01) bestP = Math.max(bestP, shape(x) * x * redRad);
  s.torquePeak = (s.hp * 745.7) / (bestP * (1 + car.turbo * 0.9));
  // aerodynamic drag calibrated so the car tops out near its quoted top speed in top gear
  const crr = 0.014;
  const thrustTop = s.torquePeak * shape(1.0) * (1 + car.turbo * 0.9) * gTop * s.eta / car.rw;
  s.dragK = Math.max(0.1, (thrustTop - crr * s.mass * 9.81) / (vTop * vTop));
  s.crr = crr;
  s.downK = (car.df * s.mass * 9.81) / Math.pow(200 / 3.6, 2); // downforce N per (m/s)^2
  // stats for UI (0..100)
  const pw = s.hp / s.mass;
  s.stats = {
    speed: clamp100((s.topKmh - 200) / 1.8),
    accel: clamp100((pw - 0.18) * 90),
    handling: clamp100(((s.muF + s.muR) / 2 - 1.1) * 110 + car.df * 25 + (1 - car.cgH) * 10 - (s.mass - 900) / 60),
    braking: clamp100((s.brakeG - 0.9) * 105),
    grip: clamp100(((s.muF + s.muR) / 2 - 1.1) * 135 + car.df * 14),
  };
  s.pi = Math.round(300 + (s.stats.speed + s.stats.accel + s.stats.handling + s.stats.braking + s.stats.grip) * 1.28);
  return s;
}

export function torqueShape(x) { // normalised torque vs rpm/redline
  const t = 0.42 + 1.75 * x - 1.45 * x * x;
  return Math.max(0.35, t);
}

const clamp100 = (v) => Math.max(4, Math.min(100, Math.round(v)));
