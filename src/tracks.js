// Track layouts + environment themes. Coordinates are metres; [x, z, y(height)].
// Top-down on screen: +x right, +z DOWN. Driving direction is left-turn = counter-clockwise on screen.

/**
 * Build smooth spline control points from a closed polygon of corners [x, z, y, radius].
 * Each corner becomes a true circular arc of that radius, so corner speeds are predictable.
 * Long straights get intermediate points so the spline stays straight.
 */
export function roundedLoop(corners, maxGap = 140) {
  const n = corners.length;
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l, l]; };
  const arcs = corners.map((c, i) => {
    const p = corners[(i + n - 1) % n], q = corners[(i + 1) % n];
    const din = dir(p, c), dout = dir(c, q);
    const dot = Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1]));
    const phi = Math.acos(dot);
    if (phi < 0.02) return { c, A: c, B: c, mid: [], phi: 0 };
    let r = c[3] ?? 60;
    // two neighbouring fillets must fit inside the segment between them
    r = Math.min(r, (0.49 * Math.min(din[2], dout[2])) / Math.tan(phi / 2));
    const t = r * Math.tan(phi / 2);
    const A = [c[0] - din[0] * t, c[1] - din[1] * t];
    const sgn = din[0] * dout[1] - din[1] * dout[0] > 0 ? 1 : -1; // + = right turn on screen
    const inX = -din[1] * sgn, inZ = din[0] * sgn;                  // unit vector from A toward the arc centre
    const O = [A[0] + inX * r, A[1] + inZ * r];
    const steps = Math.max(2, Math.ceil(phi / 0.26));
    const mid = [];
    for (let k = 0; k <= steps; k++) {
      const psi = (phi * k) / steps;
      mid.push([O[0] + r * (-inX * Math.cos(psi) + din[0] * Math.sin(psi)), O[1] + r * (-inZ * Math.cos(psi) + din[1] * Math.sin(psi))]);
    }
    return { c, A, B: mid[mid.length - 1], mid, phi, r };
  });
  // x,z points + remember which corner each belongs to (for the height anchors)
  const pts = [], anchorAt = [];
  for (let i = 0; i < n; i++) {
    const a = arcs[i], b = arcs[(i + 1) % n];
    if (a.mid.length) { for (const p of a.mid) pts.push([p[0], p[1], 0]); if (a.c[2] != null) anchorAt.push({ idx: pts.length - 1 - Math.floor(a.mid.length / 2), y: a.c[2] }); }
    else { pts.push([a.c[0], a.c[1], 0]); if (a.c[2] != null) anchorAt.push({ idx: pts.length - 1, y: a.c[2] }); }
    const from = a.mid.length ? a.B : a.c, to = b.mid.length ? b.A : b.c;
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const k = Math.floor(len / maxGap);
    for (let m = 1; m <= k; m++) { const f = m / (k + 1); pts.push([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 0]); }
  }
  // distribute height smoothly along the path between corner anchors
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % pts.length][0] - pts[i - 1][0], pts[i % pts.length][1] - pts[i - 1][1]));
  const total = cum[pts.length];
  const an = anchorAt.map((a) => ({ s: cum[a.idx], y: a.y })).sort((u, v) => u.s - v.s);
  const yAt = (s) => {
    for (let k = 0; k < an.length; k++) {
      const u = an[k], v = an[(k + 1) % an.length];
      const sv = k + 1 < an.length ? v.s : v.s + total, su = u.s;
      const ss = s < an[0].s ? s + total : s;
      if (ss >= su && ss <= sv) { const f = (ss - su) / Math.max(1e-6, sv - su); const e = f * f * (3 - 2 * f); return u.y + (v.y - u.y) * (0.5 * f + 0.5 * e); }
    }
    return an[0].y;
  };
  pts.forEach((p, i) => { p[2] = yAt(cum[i]); });
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1.5) out.push(p); }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1.5) out.pop();
  return out;
}

// -------------------------------------------------------------------------------------------------
// Environments (lighting, sky, terrain flavour). Referenced by TRACKS[].env
// -------------------------------------------------------------------------------------------------
export const ENVS = {
  coast: {
    name: 'Coastal', night: false,
    sky: { top: '#2a7de1', mid: '#7ab8f2', horizon: '#dcefff' }, sunDir: [-0.45, 0.5, 0.6], sun: '#fff0d6', sunI: 3.8,
    hemi: ['#c4e0ff', '#8ea866', 1.1], env: 0.95, exposure: 1.08,
    fog: { color: '#cfe4f6', near: 180, far: 1800 }, cloud: { cover: 0.52, speed: 0.004 },
    grade: { sat: 1.12, contrast: 1.06, tint: [1.02, 1.0, 0.96], bloom: 0.28 },
    terrain: { noiseAmp: 14, noiseScale: 0.0042, island: { rx: 1.0, rz: 1.0 }, islandPad: 22, sea: true, far: 40, farStart: 300,
      colors: { low: '#e2d2a4', mid: '#79ab4a', high: '#9a9c84', rock: '#8c8478' } },
    dust: '#cdbd98',
  },
  neon: {
    name: 'Neon City', night: true, wet: true,
    sky: { top: '#03061a', mid: '#0f1740', horizon: '#47206e' }, sunDir: [-0.35, 0.65, 0.45], sun: '#8ea8ff', sunI: 0.9,
    hemi: ['#4a5bb0', '#1a1030', 0.55], env: 0.55, exposure: 1.15,
    fog: { color: '#1a0f3c', near: 60, far: 1100 }, cloud: { cover: 0.25, speed: 0.002 },
    grade: { sat: 1.3, contrast: 1.14, tint: [1.04, 0.96, 1.08], bloom: 0.75 },
    terrain: { noiseAmp: 1.5, noiseScale: 0.01, flat: true, far: 0, farStart: 900,
      colors: { low: '#16161c', mid: '#1b1b22', high: '#22222a', rock: '#2a2a33' } },
    dust: '#6a6a88',
  },
  mountain: {
    name: 'Mountain', night: false,
    sky: { top: '#3560a0', mid: '#9ab6d4', horizon: '#e6eef2' }, sunDir: [0.6, 0.38, -0.55], sun: '#ffe8c4', sunI: 3.0,
    hemi: ['#b4cce6', '#566a46', 0.9], env: 0.8, exposure: 1.0,
    fog: { color: '#c8d5de', near: 120, far: 1300 }, cloud: { cover: 0.62, speed: 0.003 },
    grade: { sat: 1.05, contrast: 1.08, tint: [0.98, 1.0, 1.03], bloom: 0.22 },
    terrain: { noiseAmp: 38, noiseScale: 0.0035, far: 260, farStart: 200, snow: 150,
      colors: { low: '#3f6a34', mid: '#4f7a3c', high: '#9a9a96', rock: '#77716a' } },
    dust: '#a8a090',
  },
  desert: {
    name: 'Desert', night: false,
    sky: { top: '#2873c2', mid: '#dcb88e', horizon: '#ffe5bd' }, sunDir: [0.4, 0.78, 0.35], sun: '#ffd9a0', sunI: 4.8,
    hemi: ['#ffe9cc', '#c99358', 1.25], env: 1.0, exposure: 1.18,
    fog: { color: '#f0d3a9', near: 140, far: 1500 }, cloud: { cover: 0.2, speed: 0.003 },
    grade: { sat: 1.1, contrast: 1.1, tint: [1.06, 1.0, 0.9], bloom: 0.3 },
    terrain: { noiseAmp: 12, noiseScale: 0.005, canyon: true, far: 120, farStart: 250,
      colors: { low: '#e8bd7c', mid: '#d99a5c', high: '#c0744a', rock: '#b0603c' } },
    dust: '#e0bd86',
  },
  circuit: {
    name: 'Circuit', night: false,
    sky: { top: '#2f7fe0', mid: '#86bff2', horizon: '#e4f2ff' }, sunDir: [-0.35, 0.68, 0.5], sun: '#fff4e2', sunI: 3.3,
    hemi: ['#c4e0ff', '#6a8f4c', 1.0], env: 0.9, exposure: 1.0,
    fog: { color: '#d4e8f8', near: 220, far: 2000 }, cloud: { cover: 0.4, speed: 0.004 },
    grade: { sat: 1.08, contrast: 1.05, tint: [1.0, 1.0, 1.0], bloom: 0.25 },
    terrain: { noiseAmp: 7, noiseScale: 0.004, far: 70, farStart: 400,
      colors: { low: '#5d9a3a', mid: '#4c8a30', high: '#6a9a4a', rock: '#7a7a72' } },
    dust: '#9a8a6a',
  },
};

// -------------------------------------------------------------------------------------------------
// Tracks
// -------------------------------------------------------------------------------------------------
export const TRACKS = [
  {
    id: 'circuit', name: 'Voidforge International', env: 'circuit', width: 17, runoff: 12, shoulder: 3, bank: 0.8,
    tagline: 'Professional Circuit', blurb: 'Grandstands, pit lane and a classic mix of fast sweepers, a long straight and a heavy braking hairpin.',
    laps: 3, difficulty: 3, unlock: 0, startAt: [0, 0],
    points: roundedLoop([
      [-420, 0, 0, 150], [520, 0, 0, 90], [620, -250, 3, 110], [330, -330, 5, 70], [360, -470, 7, 60],
      [60, -520, 8, 90], [-140, -400, 6, 60], [-40, -300, 4, 45], [-330, -210, 2, 100], [-520, -60, 0, 90],
    ]),
  },
  {
    id: 'coast', name: 'Azure Coast Highway', env: 'coast', width: 14, runoff: 3.5, shoulder: 3.5, bank: 1,
    tagline: 'Coastal Highway', blurb: 'Seaside cliffs, palm-lined straights, a tunnel through the headland and scenic overlooks.',
    laps: 3, difficulty: 2, unlock: 0, startAt: null,
    tunnels: [[2450, 2850]],
    points: [
      [0, 0, 6], [-180, -20, 9], [-380, -70, 15], [-590, -80, 22], [-760, -30, 26], [-880, 70, 22], [-930, 210, 17],
      [-890, 350, 14], [-780, 440, 16], [-640, 470, 22], [-500, 430, 28], [-380, 365, 30], [-260, 350, 24], [-140, 405, 17],
      [-30, 430, 12], [90, 390, 9], [160, 290, 8], [165, 170, 7], [110, 70, 6],
    ].map(([x, z, y]) => [x * 1.4, z * 1.4, y * 1.25]),
  },
  {
    id: 'neon', name: 'Neon District', env: 'neon', width: 18, runoff: 3, shoulder: 3, bank: 0,
    tagline: 'Neon City', blurb: 'Rain-slicked boulevards between glowing skyscrapers, tight 90-degree corners and a plaza underpass.',
    laps: 3, difficulty: 3, unlock: 2, startAt: [0, 0],
    tunnels: [[1300, 1480]],
    points: roundedLoop([
      [-400, 0, 0, 70], [420, 0, 0, 55], [420, -360, 2, 55], [140, -360, 4, 60], [140, -200, 4, 50], [-120, -200, 3, 55],
      [-120, -520, 1, 55], [620, -520, 0, 60], [620, 240, 0, 55], [-300, 240, 0, 60], [-460, 40, 0, 70],
    ], 120),
  },
  {
    id: 'mountain', name: 'Skyline Pass', env: 'mountain', width: 12.5, runoff: 3, shoulder: 3.5, bank: 1.1,
    tagline: 'Mountain Pass', blurb: 'Switchbacks up the mountainside, a ridge-top tunnel and a plunging descent through the pines.',
    laps: 2, difficulty: 4, unlock: 3, startAt: [300, 0],
    tunnels: [[3050, 3420]],
    points: roundedLoop([
      [-260, 0, 2, 120], [880, 0, 4, 45], [880, -280, null, 38], [800, -280, null, 38], [800, -110, null, 38],
      [720, -110, null, 38], [720, -280, null, 38], [640, -280, null, 38], [640, -110, null, 38], [560, -110, null, 38], [560, -460, 104, 55],
      [-380, -460, 106, 55], [-380, -110, null, 40], [-460, -110, null, 38], [-460, -310, null, 38], [-540, -310, null, 38],
      [-540, -60, 22, 55], [-420, 40, 6, 80],
    ], 130),
  },
  {
    id: 'desert', name: 'Redrock Canyon Run', env: 'desert', width: 15, runoff: 4, shoulder: 3.5, bank: 1,
    tagline: 'Desert Canyon', blurb: 'Vast sweeping highway between canyon walls: high speed, long straights and dust on the wind.',
    laps: 3, difficulty: 3, unlock: 4, startAt: [200, 0],
    points: roundedLoop([
      [-500, 0, 8, 300], [1050, 0, 14, 190], [1180, -520, 24, 210], [700, -640, 16, 160], [420, -330, 10, 150],
      [60, -420, 6, 150], [-120, -900, 20, 190], [-760, -840, 30, 170], [-880, -300, 18, 200],
    ], 160),
  },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
