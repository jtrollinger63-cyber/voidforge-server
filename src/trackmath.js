// Pure track geometry (no DOM, no rendering) so it can run in Node for validation.
import { CatmullRomCurve3, Vector3 } from 'three';

export const SPACING = 3; // metres between centre-line samples

/**
 * Turn a track definition (a closed loop of control points) into evenly spaced
 * samples with tangent / right-normal / signed curvature, plus a fast nearest-point query.
 */
export function buildTrackData(def) {
  const pts = def.points.map(([x, z]) => new Vector3(x, 0, z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 6000;
  const length = curve.getLength();
  const N = Math.round(length / SPACING);
  const spaced = curve.getSpacedPoints(N); // N+1 points, last duplicates first
  // Rotate so sample 0 (the start/finish line) sits where the definition asks, e.g. mid-straight.
  let off = 0;
  if (def.startAt) {
    let bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(spaced[i].x - def.startAt[0], spaced[i].z - def.startAt[1]);
      if (d < bd) { bd = d; off = i; }
    }
  }
  const px = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0; i < N; i++) { const q = spaced[(i + off) % N]; px[i] = q.x; pz[i] = q.z; }

  const tx = new Float32Array(N), tz = new Float32Array(N);   // unit forward tangent
  const rx = new Float32Array(N), rz = new Float32Array(N);   // unit right normal
  const heading = new Float32Array(N);                         // atan2(tx, tz)
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz;
    rx[i] = -dz; rz[i] = dx;
    heading[i] = Math.atan2(dx, dz);
  }

  // Signed curvature (1/m). Positive = turning left (heading increasing).
  const curvRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 2) % N, b = (i + 2) % N;
    let d = heading[b] - heading[a];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    curvRaw[i] = d / (4 * SPACING);
  }
  const curv = smooth(curvRaw, 3);

  const width = def.width ?? 26;
  const half = width / 2;
  const runoff = def.runoff ?? 9; // grass between road edge and wall

  // Start/finish is sample 0; sample 0 heading is the grid direction.
  function nearest(x, z, hint = -1, win = 18) {
    let best = Infinity, bi = 0, bt = 0;
    const test = (i) => {
      const j = (i + 1) % N;
      const sx = px[j] - px[i], sz = pz[j] - pz[i];
      const l2 = sx * sx + sz * sz;
      let t = ((x - px[i]) * sx + (z - pz[i]) * sz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (px[i] + sx * t), dz = z - (pz[i] + sz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    };
    if (hint >= 0) {
      for (let k = -win; k <= win; k++) test(((hint + k) % N + N) % N);
      // if the hint window lost the car (teleport), fall back to a global search
      if (best > (half + runoff + 40) ** 2) { best = Infinity; for (let i = 0; i < N; i++) test(i); }
    } else {
      for (let i = 0; i < N; i++) test(i);
    }
    const j = (bi + 1) % N;
    const cx = px[bi] + (px[j] - px[bi]) * bt, cz = pz[bi] + (pz[j] - pz[bi]) * bt;
    const rxi = rx[bi] + (rx[j] - rx[bi]) * bt, rzi = rz[bi] + (rz[j] - rz[bi]) * bt;
    const rl = Math.hypot(rxi, rzi) || 1;
    const lat = ((x - cx) * rxi + (z - cz) * rzi) / rl; // + = right of centre line
    return { idx: bi, t: bt, lat, cx, cz, rx: rxi / rl, rz: rzi / rl, dist: Math.sqrt(best) };
  }

  return { N, length: N * SPACING, px, pz, tx, tz, rx, rz, heading, curv, width, half, runoff, nearest, curve };
}

function smooth(arr, r) {
  const n = arr.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += arr[((i + k) % n + n) % n];
    out[i] = s / (2 * r + 1);
  }
  return out;
}

/** Diagnostics used by the validator and unit checks. */
export function analyzeTrack(td) {
  const { N, px, pz, curv, half, runoff } = td;
  let minR = Infinity, minRi = 0;
  for (let i = 0; i < N; i++) {
    const r = 1 / Math.max(Math.abs(curv[i]), 1e-6);
    if (r < minR) { minR = r; minRi = i; }
  }
  // closest approach between portions of the track that are far apart along its length
  const gap = Math.round(200 / SPACING);
  let minSep = Infinity, mi = 0, mj = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + gap; j < N; j++) {
      if (N - (j - i) < gap) continue; // wrap-around neighbours
      const d = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
      if (d < minSep) { minSep = d; mi = i; mj = j; }
    }
  }
  const needSep = 2 * (half + runoff) + 16;
  return { length: td.length, minRadius: minR, minRadiusAt: minRi, minSeparation: minSep, minSepAt: [mi, mj], needSeparation: needSep };
}
