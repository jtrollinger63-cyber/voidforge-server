// Terrain: a height function (used by physics, scenery and the mesh) built around the road corridor.
import * as THREE from 'three';
import { makeNoise, makeCanvas, canvasTexture, mulberry32 } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const terrace = (w, n) => { const k = w * n, f = Math.floor(k), r = k - f; return (f + sstep(0.15, 0.85, r)) / n; };

export function createTerrain(td, envId, env, seed = 7) {
  const T = env.terrain, noise = makeNoise(seed), b = td.bounds;
  const half = td.half, flatEdge = half + td.shoulder + 6, D1 = 34;
  const q = {};
  // --- smooth "mean road height" field cached on a coarse grid (inverse distance weighting of the road samples)
  const M = 900, gStep = 24;
  const gx0 = b.minx - M, gz0 = b.minz - M, gw = Math.ceil((b.maxx - b.minx + 2 * M) / gStep) + 1, gh = Math.ceil((b.maxz - b.minz + 2 * M) / gStep) + 1;
  const idwGrid = new Float32Array(gw * gh), c = td.coarse;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = gx0 + i * gStep, z = gz0 + j * gStep;
    let sw = 0, sy = 0;
    for (let k = 0; k < c.n; k++) { const dx = x - c.x[k], dz = z - c.z[k], w = 1 / Math.pow(dx * dx + dz * dz + 3600, 1.25); sw += w; sy += w * c.y[k]; }
    idwGrid[j * gw + i] = sy / sw;
  }
  const idw = (x, z) => {
    const fx = clamp((x - gx0) / gStep, 0, gw - 1.001), fz = clamp((z - gz0) / gStep, 0, gh - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, o = j * gw + i;
    return idwGrid[o] * (1 - u) * (1 - v) + idwGrid[o + 1] * u * (1 - v) + idwGrid[o + gw] * (1 - u) * v + idwGrid[o + gw + 1] * u * v;
  };
  const pad = T.islandPad ?? 60, ex = Math.max(b.maxx - b.minx, 200) / 2 + pad, ez = Math.max(b.maxz - b.minz, 200) / 2 + pad; // the shoreline hugs the road
  const mound = td.def.tunnels && !T.flat ? 46 : 0;

  function base(x, z, d) {
    let h = idw(x, z);
    const nAmp = T.noiseAmp * sstep(12, 260, d);
    h += noise.fbm(x * T.noiseScale, z * T.noiseScale, 5) * nAmp;
    if (T.far) {
      const w = sstep(T.farStart, T.farStart + 420, d);
      if (envId === 'mountain') h += (noise.ridged(x * 0.0016 + 40, z * 0.0016, 5) - 0.35) * T.far * 1.8 * w + w * 40;
      else if (T.canyon) { const m = 0.55 + 0.45 * (noise.fbm(x * 0.003 + 9, z * 0.003, 3) * 0.7 + 0.5); h += 120 * terrace(sstep(60, 230, d) * clamp(m, 0, 1), 6) + 18 * noise.fbm(x * 0.02, z * 0.02, 2) * sstep(60, 230, d); }
      else h += (noise.ridged(x * 0.0014 + 11, z * 0.0014, 4) - 0.4) * T.far * w;
    }
    if (T.island) {
      const e = Math.hypot((x - b.cx) / ex, (z - b.cz) / ez);
      h -= 34 * sstep(0.78, 0.97, e) + 220 * sstep(0.95, 1.2, e);
      h += 14 * noise.fbm(x * 0.006, z * 0.006, 3) * (1 - sstep(0.7, 1.0, e));
    }
    return h;
  }

  function height(x, z) {
    td.nearest(x, z, -1, 18, q);
    const d = q.dist;
    const lat = clamp(q.lat, -(half + td.shoulder), half + td.shoulder);
    const roadH = q.cy + lat * q.bank;
    const tf = td.tunnelF[q.idx];
    let cw = 1 - sstep(flatEdge, flatEdge + D1, d);
    cw *= 1 - tf;
    const bs = base(x, z, d);
    let h = lerp(bs, roadH, cw);
    if (mound > 0 && tf > 0) h += (mound * tf + 6) * (1 - sstep(10, 95, d)) * tf;
    h -= 0.3 * (1 - sstep(half - 1, half + td.shoulder + 3, d)) * (1 - tf);
    return h;
  }

  /** Mesh: coloured, lit terrain with detail texture. */
  function buildMesh(renderer) {
    const margin = 760, step = 14;
    const x0 = b.minx - margin, z0 = b.minz - margin, W = b.maxx - b.minx + 2 * margin, H = b.maxz - b.minz + 2 * margin;
    const nx = Math.ceil(W / step), nz = Math.ceil(H / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const C = T.colors, cLow = new THREE.Color(C.low), cMid = new THREE.Color(C.mid), cHigh = new THREE.Color(C.high), cRock = new THREE.Color(C.rock), tmp = new THREE.Color();
    const rnd = mulberry32(3);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step, o = j * (nx + 1) + i;
      const y = height(x, z);
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      uv[o * 2] = x / 14; uv[o * 2 + 1] = z / 14;
    }
    // colours from height + slope
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const o = j * (nx + 1) + i, y = pos[o * 3 + 1];
      const yl = pos[(j * (nx + 1) + Math.max(0, i - 1)) * 3 + 1], yr = pos[(j * (nx + 1) + Math.min(nx, i + 1)) * 3 + 1];
      const yu = pos[(Math.max(0, j - 1) * (nx + 1) + i) * 3 + 1], yd = pos[(Math.min(nz, j + 1) * (nx + 1) + i) * 3 + 1];
      const slope = Math.hypot(yr - yl, yd - yu) / (2 * step);
      const x = pos[o * 3], z = pos[o * 3 + 2];
      const n = noise.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
      if (envId === 'coast') { tmp.copy(cMid).lerp(cLow, 1 - sstep(0.5, 5, y)); tmp.lerp(cHigh, sstep(30, 70, y)); }
      else if (envId === 'mountain') { tmp.copy(cLow).lerp(cMid, sstep(10, 60, y)); tmp.lerp(cHigh, sstep(80, 170, y)); if (T.snow) tmp.lerp(new THREE.Color('#f2f6fa'), sstep(T.snow + 60 * (n - 0.5), T.snow + 110, y) * (1 - sstep(0.6, 1.1, slope))); }
      else if (T.canyon) { tmp.copy(cLow).lerp(cMid, sstep(2, 40, y)); const band = (Math.sin(y * 0.55 + n * 3) * 0.5 + 0.5); tmp.lerp(cHigh, sstep(30, 90, y) * 0.8); tmp.lerp(cRock, band * sstep(18, 60, y) * 0.55); }
      else if (envId === 'neon') { tmp.copy(cMid); }
      else { tmp.copy(cMid).lerp(cLow, n * 0.5); tmp.lerp(cHigh, sstep(25, 60, y) * 0.5); }
      if (slope > 0.5 && envId !== 'neon') tmp.lerp(cRock, sstep(0.5, 1.0, slope));
      tmp.multiplyScalar(0.86 + n * 0.28);
      col[o * 3] = tmp.r; col[o * 3 + 1] = tmp.g; col[o * 3 + 2] = tmp.b;
    }
    const idx = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, bb = a + 1, c2 = a + nx + 1, d = c2 + 1;
      idx[k++] = a; idx[k++] = c2; idx[k++] = bb; idx[k++] = bb; idx[k++] = c2; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    // detail texture
    const cv = makeCanvas(256, 256), ctx = cv.getContext('2d');
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = 100 + (rnd() * 90) | 0; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.globalAlpha = 0.35; ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3); }
    ctx.globalAlpha = 1;
    const tex = canvasTexture(cv, { repeat: true, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: envId === 'neon' ? 0.55 : 1, metalness: 0 });
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.frustumCulled = false;
    return mesh;
  }

  const seaLevel = T.island ? 0 : -1e9;
  return { height, buildMesh, seaLevel, bounds: b, noise, idw };
}
