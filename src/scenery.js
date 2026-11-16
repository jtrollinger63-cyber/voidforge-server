// Scenery: instanced assets placed in spatial cells (frustum-culled, LOD-switched) + per-environment set pieces.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPACING } from './trackmath.js';
import { makeCanvas, canvasTexture, mulberry32, glowTexture } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wind = { value: 0 };

function paint(geo, hex, jitter = 0, rnd = Math.random) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const j = 1 + (rnd() - 0.5) * jitter; arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
}
function flat(g) { return g.index ? g.toNonIndexed() : g; }
function merge(list) { return mergeGeometries(list.map((g) => { g = g.index ? g : g; if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })); }

function windMat(mat, amount = 0.05) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float sw = sin(uWind * 1.4 + instanceMatrix[3].x * 0.06 + instanceMatrix[3].z * 0.05);
      float hh = max(position.y - 1.2, 0.0);
      transformed.x += sw * hh * ${amount.toFixed(3)}; transformed.z += cos(uWind * 1.1 + instanceMatrix[3].z * 0.07) * hh * ${(amount * 0.6).toFixed(3)};
      #endif`);
  };
  return mat;
}

// ------------------------------------------------------------------------------------------------ geometry builders
function pineGeo(hi, rnd) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.34, 2.8, 6); trunk.translate(0, 1.4, 0); parts.push(paint(trunk, 0x4a3320, 0.2, rnd));
  const tiers = hi ? 5 : 2;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1 || 1), r = lerp(2.5, 0.9, f) * (hi ? 1 : 1.1), h = hi ? 2.5 - i * 0.2 : 4.6;
    const y = hi ? 2.2 + i * 1.5 : 2.4 + i * 3.2;
    const c = new THREE.ConeGeometry(r, h, hi ? 8 : 6); c.translate(0, y + h / 2, 0); parts.push(paint(c, new THREE.Color().setHSL(0.34 + (rnd() - 0.5) * 0.02, 0.5, 0.17 + f * 0.07), 0.25, rnd));
  }
  return merge(parts.map(flat));
}
function palmGeo(hi, rnd) {
  const parts = [], segs = hi ? 8 : 3;
  let x = 0, y = 0, ang = 0;
  const lean = 0.32, H = 8.2;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs, r0 = lerp(0.3, 0.16, t0), r1 = lerp(0.3, 0.16, t1);
    const x0 = Math.sin(t0 * lean * 2) * H * 0.5 * t0, y0 = H * t0, x1 = Math.sin(t1 * lean * 2) * H * 0.5 * t1, y1 = H * t1;
    const len = Math.hypot(x1 - x0, y1 - y0); const c = new THREE.CylinderGeometry(r1, r0, len, hi ? 7 : 5);
    c.rotateZ(-Math.atan2(x1 - x0, y1 - y0)); c.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); parts.push(paint(c, i % 2 ? 0x8b7355 : 0x9a8260, 0.18, rnd)); x = x1; y = y1;
  }
  const nF = hi ? 9 : 5;
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * Math.PI * 2 + rnd() * 0.3, L = 3.4 + rnd() * 0.8, seg = hi ? 6 : 2;
    const pos = [], idx = [], col = [];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, w = Math.sin(Math.PI * (t * 0.85 + 0.08)) * 0.42, d = t * L, drop = t * t * 1.9 - t * 0.35;
      for (const side of [-1, 1]) { pos.push(side * w, -drop, d); const g = new THREE.Color().setHSL(0.27 + t * 0.03, 0.55, 0.2 + (1 - t) * 0.07); col.push(g.r, g.g, g.b); }
    }
    for (let s = 0; s < seg; s++) { const a0 = s * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    g.rotateY(a); g.translate(x, y, 0); parts.push(g.toNonIndexed());
  }
  return merge(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}
function rockGeo(detail, seed) {
  const rnd = mulberry32(seed), g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  const ox = rnd() * 9, oz = rnd() * 9;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.32 * Math.sin(x * 2.3 + ox) * Math.cos(z * 2.1 + oz) + 0.18 * Math.sin(y * 3.7 + ox * z);
    p.setXYZ(i, x * n * (1 + 0.2 * Math.sin(z * 3 + ox)), y * n * 0.78, z * n);
  }
  g.translate(0, 0.35, 0); return paint(flat(g), 0xffffff, 0.35, rnd);
}
function cactusGeo(rnd) {
  const parts = [], mk = (r0, r1, h, x, y, z, rz = 0) => { const g = new THREE.CylinderGeometry(r0, r1, h, 7); g.rotateZ(rz); g.translate(x, y, z); parts.push(paint(g, 0x4f8a45, 0.2, rnd)); };
  mk(0.45, 0.5, 5.5, 0, 2.75, 0); mk(0.28, 0.3, 2.6, 1.1, 3.6, 0); mk(0.28, 0.3, 1.3, 0.55, 2.8, 0, Math.PI / 2); mk(0.26, 0.28, 2.0, -1.0, 2.8, 0); mk(0.26, 0.28, 1.2, -0.5, 2.1, 0, Math.PI / 2);
  return merge(parts.map(flat));
}
function bushGeo(rnd) { const g = new THREE.IcosahedronGeometry(1, 0); g.scale(1, 0.65, 1); g.translate(0, 0.5, 0); return paint(flat(g), 0x4b6a2e, 0.35, rnd); }
function deadTreeGeo(rnd) {
  const parts = [], trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.4, 5); trunk.translate(0, 1.7, 0); parts.push(paint(trunk, 0x5a4a3a, 0.3, rnd));
  for (let i = 0; i < 4; i++) { const b = new THREE.CylinderGeometry(0.05, 0.1, 1.6, 4); b.translate(0, 0.8, 0); b.rotateZ(0.9 * (i % 2 ? 1 : -1)); b.rotateY(i * 1.7); b.translate(0, 2 + i * 0.35, 0); parts.push(paint(b, 0x5a4a3a, 0.3, rnd)); }
  return merge(parts.map(flat));
}

// ------------------------------------------------------------------------------------------------ cell scatterer
class Scatter {
  constructor(group, cell = 200) { this.group = group; this.cell = cell; this.cells = []; this.acc = 1; }
  add({ geos, mat, items, d0 = 220, d1 = 700, cast = false }) {
    const by = new Map();
    for (const it of items) { const k = Math.floor(it.x / this.cell) + ',' + Math.floor(it.z / this.cell); let a = by.get(k); if (!a) by.set(k, (a = [])); a.push(it); }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (const list of by.values()) {
      let cx = 0, cz = 0; for (const it of list) { cx += it.x; cz += it.z; } cx /= list.length; cz /= list.length;
      let rad = 0; for (const it of list) rad = Math.max(rad, Math.hypot(it.x - cx, it.z - cz));
      const meshes = [];
      geos.forEach((geo, lod) => {
        if (!geo) { meshes.push(null); return; }
        const m = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry || 0, 0); dummy.scale.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
          if (it.color) { col.set(it.color); m.setColorAt(i, col); }
        });
        m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.castShadow = cast && lod === 0; m.receiveShadow = false; m.visible = false;
        this.group.add(m); meshes.push(m);
      });
      this.cells.push({ cx, cz, rad, meshes, d0, d1 });
    }
  }
  update(camera, dt) {
    this.acc += dt; if (this.acc < 0.2) return; this.acc = 0;
    const px = camera.position.x, pz = camera.position.z;
    for (const c of this.cells) {
      const d = Math.hypot(c.cx - px, c.cz - pz) - c.rad * 0.7;
      const l0 = d < c.d0, l1 = !l0 && d < c.d1;
      if (c.meshes[0]) c.meshes[0].visible = l0 || (l1 && !c.meshes[1]);
      if (c.meshes[1]) c.meshes[1].visible = l1;
    }
  }
}

// ------------------------------------------------------------------------------------------------ textures for buildings / signs
function windowTexture(variant, aniso) {
  const W = 256, H = 512, c = makeCanvas(W, H), g = c.getContext('2d'), rnd = mulberry32(31 + variant * 7);
  const pal = [['#ffd9a0', '#ffb36b', '#ffe9c4'], ['#7fe9ff', '#3cc8ff', '#cfe9ff'], ['#ff7ad9', '#a97bff', '#ffd1f2']][variant % 3];
  g.fillStyle = '#0d0f16'; g.fillRect(0, 0, W, H);
  const cw = 16, ch = 22;
  for (let y = 6; y < H - 6; y += ch) for (let x = 6; x < W - 6; x += cw) {
    const lit = rnd() < 0.3; g.fillStyle = lit ? pal[(rnd() * 3) | 0] : rnd() < 0.5 ? '#141826' : '#1a2030'; g.fillRect(x, y, cw - 4, ch - 8);
  }
  const map = canvasTexture(c, { repeat: true, anisotropy: aniso });
  // emissive: only the lit windows
  const e = makeCanvas(W, H), eg = e.getContext('2d'), rnd2 = mulberry32(31 + variant * 7);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H);
  for (let y = 6; y < H - 6; y += ch) for (let x = 6; x < W - 6; x += cw) { const lit = rnd2() < 0.3; const col = pal[(rnd2() * 3) | 0]; rnd2(); if (lit) { eg.fillStyle = col; eg.fillRect(x, y, cw - 4, ch - 8); } }
  const emi = canvasTexture(e, { repeat: true, anisotropy: aniso });
  return { map, emi };
}
function neonTexture(text, c1, c2, w = 512, h = 192) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#05060b'; g.fillRect(0, 0, w, h);
  g.strokeStyle = c2; g.lineWidth = 10; g.shadowColor = c2; g.shadowBlur = 22; g.strokeRect(14, 14, w - 28, h - 28);
  g.font = `900 ${h * 0.5}px "Trebuchet MS","Segoe UI",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = c1; g.shadowBlur = 30; g.fillStyle = c1; g.fillText(text, w / 2, h / 2 + 4); g.fillText(text, w / 2, h / 2 + 4);
  return canvasTexture(c, { anisotropy: 8 });
}
function adTexture(text, sub, hue) {
  const w = 512, h = 256, c = makeCanvas(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, `hsl(${hue},80%,38%)`); gr.addColorStop(1, `hsl(${hue + 50},85%,22%)`); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 6; i++) g.fillRect(-40 + i * 110, 0, 50, h);
  g.font = `italic 900 ${h * 0.34}px "Trebuchet MS",sans-serif`; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(text, w / 2, h * 0.5);
  g.font = `700 ${h * 0.11}px "Trebuchet MS",sans-serif`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(sub, w / 2, h * 0.75);
  return canvasTexture(c, { anisotropy: 8 });
}

// ------------------------------------------------------------------------------------------------ main
export function buildScenery({ scene, td, terrain, envId, env, preset, aniso }) {
  const rnd = mulberry32(2024 + envId.length * 131);
  const group = new THREE.Group(); scene.add(group);
  const sc = new Scatter(group, 220);
  const dens = preset.scenery, N = td.N, half = td.half, wallLat = half + td.def.runoff;
  const tmpQ = {};
  const dummy = new THREE.Object3D();
  const farD = (d) => d * preset.far;

  /** random points around the track: lateral offset from the barrier outward */
  const around = (count, { min = 4, span = 90, pw = 1.6, slope = 9, yMin = -1e9, yMax = 1e9, clear = 0, filter = null } = {}) => {
    const out = []; let guard = 0; count = Math.round(count * dens);
    while (out.length < count && guard++ < count * 25) {
      const i = (rnd() * N) | 0, side = rnd() > 0.5 ? 1 : -1;
      const lat = side * (wallLat + min + Math.pow(rnd(), pw) * span);
      const x = td.px[i] + td.rx[i] * lat + (rnd() - 0.5) * 6, z = td.pz[i] + td.rz[i] * lat + (rnd() - 0.5) * 6;
      td.nearest(x, z, -1, 18, tmpQ);
      if (tmpQ.dist < wallLat + min * 0.8 + clear) continue;
      if (td.tunnelF[tmpQ.idx] > 0.01) continue;
      const y = terrain.height(x, z);
      if (y < yMin || y > yMax) continue;
      const dx = terrain.height(x + 3, z) - y, dz = terrain.height(x, z + 3) - y;
      if (Math.hypot(dx, dz) / 3 > slope) continue;
      if (filter && !filter(x, y, z, side, i)) continue;
      out.push({ x, y, z, ry: rnd() * 6.28, side, i });
    }
    return out;
  };
  const treeMat = windMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMapIntensity: 0.4 }), 0.05);
  const palmMat = windMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.4 }), 0.085);
  const stdMat = (extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMapIntensity: 0.4, ...extra });
  const nearStart = (x, z, r) => Math.hypot(x - td.px[0], z - td.pz[0]) < r;

  // ---------------- shared decorations: reflective delineator posts along the road edge
  if (envId !== 'circuit' && envId !== 'neon') {
    const items = [];
    for (let i = 0; i < N; i += 10) for (const s of [-1, 1]) { if (td.tunnel[i]) continue; const lat = s * (wallLat + 0.6); items.push({ x: td.px[i] + td.rx[i] * lat, z: td.pz[i] + td.rz[i] * lat, y: terrain.height(td.px[i] + td.rx[i] * lat, td.pz[i] + td.rz[i] * lat), ry: td.heading[i] }); }
    const g = new THREE.BoxGeometry(0.1, 0.9, 0.05); g.translate(0, 0.45, 0); paint(g, 0xf2f2f2); const r = new THREE.BoxGeometry(0.11, 0.18, 0.06); r.translate(0, 0.78, 0); paint(r, 0xff4020);
    sc.add({ geos: [mergeGeometries([g, r])], mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x220500 }), items, d0: farD(240), d1: 0 });
  }

  // ================================================================== COAST
  if (envId === 'coast') {
    const palms = around(520, { min: 3, span: 55, yMin: 1.2, yMax: 60, slope: 0.6 }).map((p) => ({ ...p, s: 0.8 + rnd() * 0.7, ry: p.ry }));
    sc.add({ geos: [palmGeo(true, rnd), palmGeo(false, rnd)], mat: palmMat, items: palms, d0: farD(150), d1: farD(520), cast: true });
    const bush = around(380, { min: 2, span: 40, yMin: 1, slope: 0.7 }).map((p) => ({ ...p, s: 0.8 + rnd() * 1.1, color: rnd() > 0.5 ? '#6a8f3a' : '#9aaa4a' }));
    sc.add({ geos: [bushGeo(rnd), null], mat: stdMat(), items: bush, d0: farD(200), d1: 0 });
    const rocks = around(160, { min: 3, span: 80, yMin: -0.5, slope: 2 }).map((p) => ({ ...p, sx: 1 + rnd() * 3, sy: 1 + rnd() * 2.4, sz: 1 + rnd() * 3, color: rnd() > 0.5 ? '#8a8377' : '#a39a88' }));
    sc.add({ geos: [rockGeo(1, 3), rockGeo(0, 3)], mat: stdMat(), items: rocks, d0: farD(220), d1: farD(700), cast: true });
    // sea stacks in the water
    const stacks = []; for (let k = 0; k < 400 && stacks.length < 18; k++) {
      const i = (rnd() * N) | 0, lat = (wallLat + 40 + rnd() * 160) * 1; const x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat, y = terrain.height(x, z);
      if (y < -4 && y > -30) stacks.push({ x, y: -0.5, z, ry: rnd() * 6.28, sx: 6 + rnd() * 9, sy: 8 + rnd() * 18, sz: 6 + rnd() * 9, color: '#7b756c' });
    }
    sc.add({ geos: [rockGeo(1, 9), rockGeo(0, 9)], mat: stdMat(), items: stacks, d0: farD(600), d1: farD(1800) });
    // lighthouse on a headland
    { let best = null, bs = -1; for (let k = 0; k < 300; k++) { const i = (rnd() * N) | 0, lat = wallLat + 18 + rnd() * 70, x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat, y = terrain.height(x, z); if (y > 3 && y < 22 && (!best || y > bs)) { best = { x, z, y }; bs = y; } }
      if (best) { const lg = new THREE.Group(); lg.position.set(best.x, best.y, best.z);
        const cy = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.2, 26, 16), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 })); cy.position.y = 13; cy.castShadow = true; lg.add(cy);
        for (const y of [6, 14, 22]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(2.35 - y * 0.03 + 0.1, 2.45 - y * 0.03 + 0.2, 3.2, 16), new THREE.MeshStandardMaterial({ color: 0xd8232a, roughness: 0.7 })); st.position.y = y; lg.add(st); }
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b0, toneMapped: false })); lamp.position.y = 27.4; lg.add(lamp);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0x222831 })); roof.position.y = 29.7; lg.add(roof);
        group.add(lg); } }
    // villas on the inland slopes
    { const wall = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.9 }), roofM = new THREE.MeshStandardMaterial({ color: 0xc9562e, roughness: 0.8 });
      let placed = 0; for (let k = 0; k < 600 && placed < 26 * dens; k++) { const i = (rnd() * N) | 0, side = -1, lat = side * (wallLat + 20 + rnd() * 90), x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat; td.nearest(x, z, -1, 18, tmpQ); if (tmpQ.dist < wallLat + 18) continue; const y = terrain.height(x, z); if (y < 4 || y > 60) continue; if (Math.hypot(terrain.height(x + 6, z) - y, terrain.height(x, z + 6) - y) / 6 > 0.3) continue;
        const v = new THREE.Group(); v.position.set(x, y, z); v.rotation.y = rnd() * 6.28; const w = 9 + rnd() * 6, d = 7 + rnd() * 5, h = 4 + rnd() * 2;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall); b.position.y = h / 2; b.castShadow = true; v.add(b);
        const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4), roofM); r.rotation.y = Math.PI / 4; r.position.y = h + 1.1; r.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); v.add(r); group.add(v); placed++; } }
  }

  // ================================================================== MOUNTAIN
  if (envId === 'mountain') {
    const pines = around(4200, { min: 2.5, span: 120, yMin: 1, slope: 0.85, pw: 1.3 }).map((p) => ({ ...p, s: 0.8 + rnd() * 1.1, color: rnd() > 0.5 ? '#ffffff' : '#d0e6c8' }));
    sc.add({ geos: [pineGeo(true, rnd), pineGeo(false, rnd)], mat: treeMat, items: pines, d0: farD(130), d1: farD(650), cast: true });
    const rocks = around(300, { min: 2, span: 90, slope: 3 }).map((p) => ({ ...p, sx: 1.5 + rnd() * 3.5, sy: 1.5 + rnd() * 3.5, sz: 1.5 + rnd() * 3.5, color: rnd() > 0.5 ? '#7a756e' : '#8c867a' }));
    sc.add({ geos: [rockGeo(1, 5), rockGeo(0, 5)], mat: stdMat(), items: rocks, d0: farD(200), d1: farD(800), cast: true });
    const big = around(60, { min: 6, span: 140, slope: 4 }).map((p) => ({ ...p, sx: 6 + rnd() * 10, sy: 7 + rnd() * 12, sz: 6 + rnd() * 10, color: '#6f6b64' }));
    sc.add({ geos: [rockGeo(1, 12), rockGeo(0, 12)], mat: stdMat(), items: big, d0: farD(350), d1: farD(1500) });
    const bush = around(500, { min: 2, span: 40, slope: 0.7 }).map((p) => ({ ...p, s: 0.7 + rnd() * 0.9, color: '#5a7a3a' }));
    sc.add({ geos: [bushGeo(rnd), null], mat: stdMat(), items: bush, d0: farD(150), d1: 0 });
    // lodge in the valley
    { const i = 40, lat = wallLat + 38, x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat, y = terrain.height(x, z); const L = new THREE.Group(); L.position.set(x, y, z); L.rotation.y = td.heading[i];
      const b = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 10), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 })); b.position.y = 2.5; b.castShadow = true; L.add(b);
      const r = new THREE.Mesh(new THREE.ConeGeometry(11.2, 4.6, 4), new THREE.MeshStandardMaterial({ color: 0x3a2f2a, roughness: 0.9 })); r.rotation.y = Math.PI / 4; r.scale.set(1, 1, 0.58); r.position.y = 7.2; L.add(r);
      const win = new THREE.MeshBasicMaterial({ color: 0xffd28a, toneMapped: false }); for (const wx of [-5, 0, 5]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.6), win); w.position.set(wx, 2.6, 5.02); L.add(w); } group.add(L); }
  }

  // ================================================================== DESERT
  if (envId === 'desert') {
    const cac = around(460, { min: 4, span: 120, slope: 0.6, yMax: 40 }).map((p) => ({ ...p, s: 0.8 + rnd() * 1.0 }));
    sc.add({ geos: [cactusGeo(rnd), null], mat: stdMat(), items: cac, d0: farD(300), d1: 0, cast: true });
    const rocks = around(520, { min: 3, span: 140, slope: 3 }).map((p) => ({ ...p, sx: 1 + rnd() * 3.5, sy: 1 + rnd() * 3.5, sz: 1 + rnd() * 3.5, color: rnd() > 0.5 ? '#b0794d' : '#c08a58' }));
    sc.add({ geos: [rockGeo(1, 21), rockGeo(0, 21)], mat: stdMat(), items: rocks, d0: farD(220), d1: farD(900), cast: true });
    const big = around(80, { min: 8, span: 160, slope: 4 }).map((p) => ({ ...p, sx: 8 + rnd() * 14, sy: 10 + rnd() * 18, sz: 8 + rnd() * 14, color: rnd() > 0.5 ? '#a9623a' : '#b87445' }));
    sc.add({ geos: [rockGeo(1, 33), rockGeo(0, 33)], mat: stdMat(), items: big, d0: farD(400), d1: farD(1800) });
    const dry = around(500, { min: 2, span: 100, slope: 0.7 }).map((p) => ({ ...p, s: 0.6 + rnd() * 0.8, color: rnd() > 0.5 ? '#8a7a4a' : '#a89a60' }));
    sc.add({ geos: [bushGeo(rnd), null], mat: stdMat(), items: dry, d0: farD(180), d1: 0 });
    const dead = around(40, { min: 6, span: 80, slope: 0.6 }).map((p) => ({ ...p, s: 0.9 + rnd() * 0.6 }));
    sc.add({ geos: [deadTreeGeo(rnd), null], mat: stdMat(), items: dead, d0: farD(300), d1: 0 });
    // power line along a straight stretch
    { const pts = []; const a = Math.round(N * 0.1), b2 = Math.round(N * 0.34); for (let i = a; i < b2; i += 12) { const lat = wallLat + 7, x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat; pts.push([x, terrain.height(x, z), z, td.heading[i]]); }
      const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 11, 6), new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }), pts.length); const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0x4a3a2c }), pts.length);
      pts.forEach((p, k) => { dummy.position.set(p[0], p[1] + 5.5, p[2]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pole.setMatrixAt(k, dummy.matrix); dummy.position.set(p[0], p[1] + 10.2, p[2]); dummy.rotation.set(0, p[3] + Math.PI / 2 + Math.PI / 2, 0); dummy.updateMatrix(); arm.setMatrixAt(k, dummy.matrix); });
      pole.frustumCulled = false; arm.frustumCulled = false; group.add(pole, arm);
      const wirePos = []; for (let k = 0; k < pts.length - 1; k++) for (const off of [-1.4, 0, 1.4]) { const a1 = pts[k], b1 = pts[k + 1]; const cxa = Math.cos(a1[3]) * off, cza = -Math.sin(a1[3]) * off, cxb = Math.cos(b1[3]) * off, czb = -Math.sin(b1[3]) * off; for (let s = 0; s < 6; s++) { const t0 = s / 6, t1 = (s + 1) / 6; const sag = (t) => -Math.sin(Math.PI * t) * 0.9; wirePos.push(lerp(a1[0] + cxa, b1[0] + cxb, t0), lerp(a1[1], b1[1], t0) + 10.1 + sag(t0), lerp(a1[2] + cza, b1[2] + czb, t0), lerp(a1[0] + cxa, b1[0] + cxb, t1), lerp(a1[1], b1[1], t1) + 10.1 + sag(t1), lerp(a1[2] + cza, b1[2] + czb, t1)); } }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3)); const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x222222 })); wl.frustumCulled = false; group.add(wl); }
    // gas station near the start
    { const i = 10, lat = wallLat + 30, x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat, y = terrain.height(x, z), G = new THREE.Group(); G.position.set(x, y, z); G.rotation.y = td.heading[i] + Math.PI / 2;
      const can = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 9), new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.6 })); can.position.y = 5.2; can.castShadow = true; G.add(can);
      for (const px of [-6, 6]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 5.2, 8), new THREE.MeshStandardMaterial({ color: 0xcfcfcf })); p.position.set(px, 2.6, 2.5); G.add(p); }
      const store = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 7), new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.95 })); store.position.set(0, 2.1, -9); store.castShadow = true; G.add(store);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), new THREE.MeshBasicMaterial({ map: adTexture('GAS', 'Fuel · Food · Rest', 14), toneMapped: false, side: THREE.DoubleSide })); sign.position.set(-10, 8.5, 4); const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7, 6), new THREE.MeshStandardMaterial({ color: 0x777777 })); pl.position.set(-10, 3.5, 4); G.add(sign, pl); group.add(G); }
  }

  // ================================================================== CIRCUIT
  if (envId === 'circuit') {
    const pines = around(900, { min: 14, span: 160, slope: 0.7, pw: 1.4 }).map((p) => ({ ...p, s: 0.8 + rnd() * 1.0, color: '#ffffff' }));
    sc.add({ geos: [pineGeo(true, rnd), pineGeo(false, rnd)], mat: treeMat, items: pines, d0: farD(140), d1: farD(700), cast: true });
    const bush = around(300, { min: 6, span: 50, slope: 0.7 }).map((p) => ({ ...p, s: 0.8 + rnd() * 0.8, color: '#4f7a34' }));
    sc.add({ geos: [bushGeo(rnd), null], mat: stdMat(), items: bush, d0: farD(150), d1: 0 });
    const heading = td.heading[0], sx = td.px[0], sz = td.pz[0];
    const toWorld = (g, lx, lz, ry = 0) => { g.position.set(sx + td.rx[0] * -lx + td.tx[0] * lz, td.py[0], sz + td.rz[0] * -lx + td.tz[0] * lz); g.rotation.y = heading + ry; };
    // grandstands: main straight, right side (local +x = right of track => td.rx direction)
    const crowd = (() => { const c = makeCanvas(256, 64), g = c.getContext('2d'); g.fillStyle = '#2a2f3a'; g.fillRect(0, 0, 256, 64); const cols = ['#e63946', '#f1faee', '#ffb703', '#4cc9f0', '#8ac926', '#ff7ab6', '#fff', '#6a4c93']; const r = mulberry32(5); for (let i = 0; i < 1400; i++) { g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect(r() * 256, r() * 64, 3, 3 + r() * 3); } return canvasTexture(c, { repeat: true, anisotropy: 4 }); })();
    const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }), conc = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, roughness: 0.9 });
    const stand = (len, off, z0, ry = 0, tiers = 6) => {
      const G = new THREE.Group(); toWorld(G, 0, 0); const holder = new THREE.Group(); G.add(holder);
      for (let t = 0; t < tiers; t++) { const h = 1.45 * (t + 1); const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, len), [standMat, conc, standMat, conc, conc, conc]); m.position.set(-(off + t * 2.4), h / 2, z0); m.castShadow = true; m.receiveShadow = true; holder.add(m); }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.4, len + 2), new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.55 })); roof.position.set(-(off + 8.5), 11.8, z0); roof.castShadow = true; holder.add(roof);
      for (let k = 0; k <= 4; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11.8, 0.5), conc); p.position.set(-(off + 2.2), 5.9, z0 - len / 2 + (len * k) / 4); holder.add(p); }
      group.add(G); G.rotation.y = td.heading[0] + ry;
    };
    stand(120, half + 20, 30); stand(70, half + 20, -120);
    // far side stands
    const farG = new THREE.Group(); toWorld(farG, 0, 0); const fh = new THREE.Group(); farG.add(fh); fh.rotation.y = Math.PI;
    for (let t = 0; t < 5; t++) { const h = 1.45 * (t + 1); const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 90), [standMat, conc, standMat, conc, conc, conc]); m.position.set(-(half + 20 + t * 2.4), h / 2, 20); m.castShadow = true; fh.add(m); }
    group.add(farG); farG.rotation.y = td.heading[0];
    // pit building on the far side + pit lane
    { const pit = new THREE.Group(); toWorld(pit, 0, 0); const holder = new THREE.Group(); pit.add(holder);
      const gd = (() => { const c = makeCanvas(512, 128), g = c.getContext('2d'); g.fillStyle = '#d9dde4'; g.fillRect(0, 0, 512, 128); for (let i = 0; i < 12; i++) { g.fillStyle = '#2a2e38'; g.fillRect(8 + i * 42, 40, 34, 78); g.fillStyle = ['#d8232a', '#1f6fe5', '#ffb703', '#2bb673'][i % 4]; g.fillRect(8 + i * 42, 24, 34, 10); } g.fillStyle = '#3a4150'; g.fillRect(0, 0, 512, 14); return canvasTexture(c, { anisotropy: 8 }); })();
      const b = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 260), [new THREE.MeshStandardMaterial({ map: (() => { gd.repeat.set(1, 1); return gd; })(), roughness: 0.7 }), conc, conc, conc, conc, conc]);
      b.position.set(half + 38, 4.5, 40); b.castShadow = true; holder.add(b);
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(10, 260).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 })); lane.position.set(half + 28, 0.05, 40); holder.add(lane);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 14), new THREE.MeshStandardMaterial({ color: 0xcfd5de, roughness: 0.5, metalness: 0.2 })); tower.position.set(half + 38, 11, -110); tower.castShadow = true; holder.add(tower);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(13, 6), new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.05, metalness: 0.6 })); glass.position.set(half + 32.9, 17, -110); glass.rotation.y = -Math.PI / 2; holder.add(glass);
      group.add(pit); pit.rotation.y = td.heading[0]; pit.scale.x = -1; }
    // pedestrian bridge over the straight
    { const br = new THREE.Group(); const i = 32; br.position.set(td.px[i], td.py[i], td.pz[i]); br.rotation.y = td.heading[i]; const steel = new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 0.6, roughness: 0.4 }); const span = half + 14;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.5, 3.2), steel); deck.position.y = 8.6; deck.castShadow = true; br.add(deck);
      const roofB = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.3, 3.8), new THREE.MeshStandardMaterial({ color: 0x1b2a5e, roughness: 0.4 })); roofB.position.y = 11.5; br.add(roofB);
      for (const s2 of [-1, 1]) for (const z of [-1.4, 1.4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.15), steel); p.position.set(s2 * span * 0.5, 10, z); br.add(p); }
      for (const s2 of [-span + 1, span - 1]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 8.6, 3.2), steel); pl.position.set(s2, 4.3, 0); pl.castShadow = true; br.add(pl); }
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.5, 2.2), new THREE.MeshBasicMaterial({ map: adTexture('VOIDFORGE MOTORS', 'Built for the extraordinary', 205), toneMapped: false, side: THREE.DoubleSide })); ad.position.set(0, 9.9, 1.62); br.add(ad); const ad2 = ad.clone(); ad2.position.z = -1.62; br.add(ad2);
      group.add(br); }
    // flags + light towers + sponsor boards
    { const flagTex = [0xd8232a, 0x1f6fe5, 0xffb703, 0x2bb673, 0xffffff]; const poles = [];
      for (let i = 0; i < N; i += 24) for (const s of [-1, 1]) { const lat = s * (wallLat + 4); poles.push([td.px[i] + td.rx[i] * lat, terrain.height(td.px[i] + td.rx[i] * lat, td.pz[i] + td.rz[i] * lat), td.pz[i] + td.rz[i] * lat, i]); }
      const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5 }), poles.length); const fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 1.3).translate(1.1, 0, 0), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), poles.length);
      poles.forEach((p, k) => { dummy.position.set(p[0], p[1] + 3.5, p[2]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pm.setMatrixAt(k, dummy.matrix); dummy.position.set(p[0], p[1] + 6.2, p[2]); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.updateMatrix(); fm.setMatrixAt(k, dummy.matrix); fm.setColorAt(k, new THREE.Color(flagTex[k % flagTex.length])); });
      pm.frustumCulled = false; fm.frustumCulled = false; group.add(pm, fm);
      const boards = []; for (let k = 0; k < 14; k++) { const i = Math.round((k / 14) * N + 20) % N; if (Math.abs(td.curv[i]) > 1 / 300) continue; const s = k % 2 ? 1 : -1; const lat = s * (wallLat + 2.2); const bg = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.4), new THREE.MeshBasicMaterial({ map: adTexture(['VOIDFORGE', 'APEX TYRES', 'NOVA FUEL', 'KESTREL', 'HELION'][k % 5], 'Official partner', (k * 47) % 360), toneMapped: false })); bg.position.set(td.px[i] + td.rx[i] * lat, terrain.height(td.px[i] + td.rx[i] * lat, td.pz[i] + td.rz[i] * lat) + 2.4, td.pz[i] + td.rz[i] * lat); bg.rotation.y = td.heading[i] + (s > 0 ? -Math.PI / 2 : Math.PI / 2); group.add(bg); } }
  }

  // ================================================================== NEON CITY
  const night = [];
  if (envId === 'neon') {
    const tex = [0, 1, 2].map((v) => windowTexture(v, aniso));
    const mats = tex.map((t) => new THREE.MeshStandardMaterial({ color: 0x24262f, map: t.map, emissive: 0xffffff, emissiveMap: t.emi, emissiveIntensity: 0.85, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.9 }));
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.8 });
    const lots = []; const taken = [];
    const tryLot = (i, side, off, wmin, wmax) => {
      const w = wmin + rnd() * (wmax - wmin), d = wmin + rnd() * (wmax - wmin), h = 35 + Math.pow(rnd(), 1.7) * 230 * (0.55 + Math.min(1, (off - wallLat) / 90));
      const lat = side * (off + d / 2), x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat;
      td.nearest(x, z, -1, 18, tmpQ); if (tmpQ.dist < wallLat + Math.max(w, d) * 0.5 + 3) return false;
      for (const t of taken) if (Math.hypot(t[0] - x, t[1] - z) < (t[2] + Math.max(w, d)) * 0.55) return false;
      taken.push([x, z, Math.max(w, d)]); lots.push({ x, z, w, d, h, ry: td.heading[i], mat: (rnd() * 3) | 0, i, side, y: terrain.height(x, z) }); return true;
    };
    for (let i = 0; i < N; i += 12) for (const side of [-1, 1]) { if (td.tunnel[i]) continue; tryLot(i, side, wallLat + 5 + rnd() * 6, 22, 46); tryLot(i, side, wallLat + 62 + rnd() * 30, 30, 62); tryLot(i, side, wallLat + 140 + rnd() * 50, 40, 80); }
    // merge per cell + material
    const buckets = new Map();
    for (const L of lots) {
      const g = new THREE.BoxGeometry(L.w, L.h, L.d); g.translate(0, L.h / 2, 0);
      const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const nx = Math.abs(nrm.getX(k)), ny = Math.abs(nrm.getY(k)); if (ny > 0.5) { uv.setXY(k, 0, 0); continue; } const u = (nx > 0.5 ? L.d : L.w) / 12 * uv.getX(k), v = L.h / 28 * uv.getY(k); uv.setXY(k, u, v); }
      g.rotateY(L.ry); g.translate(L.x, L.y, L.z);
      const key = Math.floor(L.x / 260) + ',' + Math.floor(L.z / 260) + ',' + L.mat; let b = buckets.get(key); if (!b) buckets.set(key, (b = { mat: L.mat, geos: [] })); b.geos.push(g);
      // rooftop details + red aircraft beacon
      if (L.h > 120) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); m.position.set(L.x, L.y + L.h + 4, L.z); group.add(m); const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 14, 5), roofMat); ant.position.set(L.x, L.y + L.h + 6, L.z); group.add(ant); }
    }
    for (const b of buckets.values()) { const m = new THREE.Mesh(mergeGeometries(b.geos), mats[b.mat]); m.castShadow = false; m.receiveShadow = false; group.add(m); }
    // neon signs on the buildings closest to the road
    const names = ['NEON', 'RAMEN', 'VOID', 'HOTEL', 'SAKURA', 'TURBO', 'ARCADE', 'BAR', 'NOODLE', 'CYBER', 'NOVA', 'KARAOKE'];
    const cols = [['#ff4fd8', '#ff9af0'], ['#33f0ff', '#a6fbff'], ['#ffb14a', '#ffe0a8'], ['#7a6bff', '#c3bcff'], ['#47ff9a', '#b8ffd9']];
    lots.filter((L) => L.mat >= 0).slice(0, 400).forEach((L, k) => {
      if (k % 2) return; const c = cols[k % cols.length], tx = neonTexture(names[k % names.length], c[0], c[1]);
      const face = L.side > 0 ? -1 : 1, off = L.d / 2 + 0.2, wdt = 9 + rnd() * 9, y = L.y + 7 + rnd() * Math.min(60, L.h * 0.6);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(wdt, wdt * 0.375), new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, side: THREE.DoubleSide }));
      const nx = td.rx[L.i] * face, nz = td.rz[L.i] * face; s.position.set(L.x + nx * off, y, L.z + nz * off); s.lookAt(s.position.x + nx, y, s.position.z + nz); group.add(s);
    });
    // overhead billboards across the boulevard + street lamps + traffic lights
    for (let k = 0; k < 8; k++) { const i = Math.round(((k + 0.3) / 8) * N) % N; if (td.tunnel[i] || Math.abs(td.curv[i]) > 1 / 300) continue; const g = new THREE.Group(); g.position.set(td.px[i], td.py[i], td.pz[i]); g.rotation.y = td.heading[i];
      const steel = new THREE.MeshStandardMaterial({ color: 0x20232d, metalness: 0.8, roughness: 0.4 }); const w = half + 2.5; for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 10, 0.7), steel); p.position.set(s * w, 5, 0); g.add(p); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.6, 0.6), steel); bar.position.y = 9.8; g.add(bar);
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, 4.2), new THREE.MeshBasicMaterial({ map: neonTexture(names[(k * 3) % names.length] + ' ' + (k + 1), cols[k % 5][0], cols[k % 5][1], 768, 192), toneMapped: false, side: THREE.DoubleSide })); ad.position.set(0, 12.2, 0); g.add(ad); group.add(g); }
    // lamps with warm glow
    const lampSpots = []; for (let i = 0; i < N; i += 13) for (const s of [-1, 1]) { if (td.tunnel[i]) continue; const lat = s * (wallLat + 1.3); lampSpots.push([td.px[i] + td.rx[i] * lat, td.py[i], td.pz[i] + td.rz[i] * lat, i, s]); }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.2, 9.6, 6), new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.7, roughness: 0.5 }), lampSpots.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.22, 0.7), new THREE.MeshBasicMaterial({ color: 0xffe9c0, toneMapped: false }), lampSpots.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,225,170,0.9)', 'rgba(255,190,110,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }), lampSpots.length);
    const glowPos = new Float32Array(lampSpots.length * 3);
    lampSpots.forEach((p, k) => { dummy.position.set(p[0], p[1] + 4.8, p[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pole.setMatrixAt(k, dummy.matrix);
      const hx = p[0] - td.rx[p[3]] * p[4] * 1.9, hz = p[2] - td.rz[p[3]] * p[4] * 1.9; dummy.position.set(hx, p[1] + 9.7, hz); dummy.rotation.set(0, td.heading[p[3]], 0); dummy.updateMatrix(); head.setMatrixAt(k, dummy.matrix); glowPos[k * 3] = hx; glowPos[k * 3 + 1] = p[1] + 9.6; glowPos[k * 3 + 2] = hz;
      dummy.position.set(hx - td.rx[p[3]] * p[4] * 4, p[1] + 0.09, hz - td.rz[p[3]] * p[4] * 4); dummy.rotation.set(0, 0, 0); dummy.scale.set(22, 1, 22); dummy.updateMatrix(); pool.setMatrixAt(k, dummy.matrix); });
    pole.frustumCulled = head.frustumCulled = pool.frustumCulled = false; group.add(pole, head, pool);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    const halo = new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTexture('rgba(255,235,190,1)', 'rgba(255,200,120,0)'), size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 })); halo.frustumCulled = false; group.add(halo);
    // the "building the road runs through": a slab above the underpass
    for (const [i0, i1] of (td.def.tunnels || []).map(([a, b]) => [Math.round(a / SPACING), Math.round(b / SPACING)])) {
      const im = Math.round((i0 + i1) / 2), len = (i1 - i0) * SPACING + 30;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(70, 150, len), mats[1]); slab.position.set(td.px[im], td.py[im] + 8.5 + 75, td.pz[im]); slab.rotation.y = td.heading[im]; group.add(slab);
    }
  }

  // wind clock + update
  return {
    group,
    update(camera, dt, time) { wind.value = time; sc.update(camera, dt); },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}
