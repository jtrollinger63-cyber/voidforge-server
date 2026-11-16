// Pure track geometry (no DOM / rendering) so it also runs in Node for validation and tests.
// Coordinates: x, z horizontal; y up. A track is a closed Catmull-Rom loop through [x, z, y] control points.
import { CatmullRomCurve3, Vector3 } from 'three';

export const SPACING = 3; // metres between centre-line samples

const smooth = (arr, r, wrap = true) => {
  const n = arr.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += arr[wrap ? (((i + k) % n) + n) % n : Math.min(n - 1, Math.max(0, i + k))];
    out[i] = s / (2 * r + 1);
  }
  return out;
};
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTrackData(def) {
  const pts = def.points.map((p) => new Vector3(p[0], p[2] ?? 0, p[1]));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 10000;
  const total = curve.getLength();
  const N = Math.round(total / SPACING);
  const spaced = curve.getSpacedPoints(N);

  let off = 0;
  if (def.startAt) {
    let bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(spaced[i].x - def.startAt[0], spaced[i].z - def.startAt[1]);
      if (d < bd) { bd = d; off = i; }
    }
  }
  const px = new Float32Array(N), py0 = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0; i < N; i++) { const q = spaced[(i + off) % N]; px[i] = q.x; py0[i] = q.y; pz[i] = q.z; }
  const py = smooth(py0, 3);

  const tx = new Float32Array(N), tz = new Float32Array(N), rx = new Float32Array(N), rz = new Float32Array(N);
  const heading = new Float32Array(N), slope = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l; rx[i] = -dz / l; rz[i] = dx / l;
    heading[i] = Math.atan2(dx, dz);
    slope[i] = (py[b] - py[a]) / l;
  }
  const curvRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 2) % N, b = (i + 2) % N;
    let d = heading[b] - heading[a];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    curvRaw[i] = d / (4 * SPACING);
  }
  const curv = smooth(curvRaw, 3);
  // Auto banking: outside edge raised in corners. bank = dy/dlat (+ raises the right edge), left turns (curv>0) -> right edge up.
  const bankScale = def.bank ?? 1;
  const bank = smooth(curv.map((c) => Math.max(-0.1, Math.min(0.1, c * 6 * bankScale))), 6);

  const width = def.width ?? 14;
  const half = width / 2;
  const runoff = def.runoff ?? 4;       // distance from road edge to the barrier
  const shoulder = def.shoulder ?? 3.2; // paved/gravel strip outside the kerb before the embankment

  // tunnels: [[s0, s1], ...] in metres from the start line
  const tunnel = new Uint8Array(N);
  const tunnelF = new Float32Array(N); // 0..1 smooth ramp used by the terrain
  for (const [s0, s1] of def.tunnels || []) {
    for (let i = 0; i < N; i++) {
      const s = i * SPACING;
      if (s >= s0 && s <= s1) { tunnel[i] = 1; tunnelF[i] = sstep(0, 30, s - s0) * sstep(0, 30, s1 - s); }
    }
  }

  // spatial hash of samples for fast global nearest queries
  const CELL = 40, cells = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < N; i++) {
    const k = key(Math.floor(px[i] / CELL), Math.floor(pz[i] / CELL));
    let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(i);
  }

  function segTest(i, x, z, st) {
    const j = (i + 1) % N;
    const sx = px[j] - px[i], sz = pz[j] - pz[i];
    let t = ((x - px[i]) * sx + (z - pz[i]) * sz) / (sx * sx + sz * sz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (px[i] + sx * t), dz = z - (pz[i] + sz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < st.best) { st.best = d2; st.i = i; st.t = t; }
  }
  const st = { best: 0, i: 0, t: 0 };

  /** Nearest point on the centre line. `out` (optional) is filled to avoid allocations. */
  function nearest(x, z, hint = -1, win = 18, out = {}) {
    st.best = Infinity;
    const reach = half + runoff + 45;
    if (hint >= 0) {
      for (let k = -win; k <= win; k++) segTest(((hint + k) % N + N) % N, x, z, st);
      if (st.best > reach * reach) hint = -1;
    }
    if (hint < 0) {
      st.best = Infinity;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let r = 1; r <= 4 && st.best === Infinity; r++) {
        for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
          const a = cells.get(key(ix, iz));
          if (a) for (let m = 0; m < a.length; m++) { segTest(a[m], x, z, st); segTest((a[m] + N - 1) % N, x, z, st); }
        }
      }
      if (st.best === Infinity) for (let i = 0; i < N; i++) segTest(i, x, z, st);
    }
    const i = st.i, t = st.t, j = (i + 1) % N;
    const cx = px[i] + (px[j] - px[i]) * t, cz = pz[i] + (pz[j] - pz[i]) * t;
    let rxi = rx[i] + (rx[j] - rx[i]) * t, rzi = rz[i] + (rz[j] - rz[i]) * t;
    const rl = Math.hypot(rxi, rzi) || 1; rxi /= rl; rzi /= rl;
    out.idx = i; out.t = t; out.cx = cx; out.cz = cz;
    out.cy = py[i] + (py[j] - py[i]) * t;
    out.bank = bank[i] + (bank[j] - bank[i]) * t;
    out.slope = slope[i] + (slope[j] - slope[i]) * t;
    out.rx = rxi; out.rz = rzi;
    out.lat = (x - cx) * rxi + (z - cz) * rzi;   // + = right of centre line
    out.dist = Math.sqrt(st.best);
    return out;
  }

  /** Road surface height at lateral offset `lat` for a nearest() result. */
  const roadY = (q, lat = q.lat) => q.cy + lat * q.bank;

  // Coarse samples (every 8th) for smooth inverse-distance heights used by the terrain.
  const cStep = 8, cN = Math.floor(N / cStep);
  const cx = new Float32Array(cN), cz = new Float32Array(cN), cy = new Float32Array(cN);
  for (let k = 0; k < cN; k++) { cx[k] = px[k * cStep]; cz[k] = pz[k * cStep]; cy[k] = py[k * cStep]; }

  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, miny = 1e9, maxy = -1e9;
  for (let i = 0; i < N; i++) {
    minx = Math.min(minx, px[i]); maxx = Math.max(maxx, px[i]); minz = Math.min(minz, pz[i]); maxz = Math.max(maxz, pz[i]);
    miny = Math.min(miny, py[i]); maxy = Math.max(maxy, py[i]);
  }

  return {
    def, N, length: N * SPACING, px, py, pz, tx, tz, rx, rz, heading, curv, slope, bank, tunnel, tunnelF,
    width, half, runoff, shoulder, nearest, roadY, coarse: { n: cN, x: cx, z: cz, y: cy },
    bounds: { minx, maxx, minz, maxz, miny, maxy, cx: (minx + maxx) / 2, cz: (minz + maxz) / 2 },
  };
}

/** Diagnostics used by the validator. */
export function analyzeTrack(td) {
  const { N, px, py, pz, curv, half, runoff, slope } = td;
  let minR = Infinity, minRi = 0, maxSlope = 0;
  for (let i = 0; i < N; i++) {
    const r = 1 / Math.max(Math.abs(curv[i]), 1e-6);
    if (r < minR) { minR = r; minRi = i; }
    maxSlope = Math.max(maxSlope, Math.abs(slope[i]));
  }
  const gap = Math.round(220 / SPACING);
  let minSep = Infinity, mi = 0, mj = 0;
  for (let i = 0; i < N; i += 2) for (let j = i + gap; j < N; j += 2) {
    if (N - (j - i) < gap) continue;
    const d = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
    if (d < minSep) { minSep = d; mi = i; mj = j; }
  }
  return {
    length: td.length, minRadius: minR, minRadiusAt: minRi, maxSlope, climb: td.bounds.maxy - td.bounds.miny,
    minSeparation: minSep, minSepAt: [mi, mj], needSeparation: 2 * (half + runoff) + 22,
  };
}
