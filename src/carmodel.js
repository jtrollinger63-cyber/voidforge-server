// Procedural car models: lofted bodywork, glass greenhouse, detailed wheels, interior, lights, aero parts.
// Model space: +x = LEFT of the car, +y up, +z forward. Origin at the middle of the wheelbase on the ground.
import * as THREE from 'three';
import { SHAPES, interp } from './carshapes.js';
import { FINISHES } from './cars.js';
import { makeCanvas, canvasTexture } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------
// shared materials / textures
// ------------------------------------------------------------------------------------------------
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // carbon fibre twill
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#0c0d10'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
    const a = ((x + y) / 8) % 2 === 0;
    const gr = g.createLinearGradient(x, y, x + 8, y + 8);
    gr.addColorStop(0, a ? '#2b2e35' : '#14161a'); gr.addColorStop(1, a ? '#16181d' : '#2a2d33');
    g.fillStyle = gr; g.fillRect(x, y, 8, 8);
  }
  const carbonTex = canvasTexture(c, { repeat: true, anisotropy: 4 }); carbonTex.repeat.set(3, 3);
  // tyre tread bump
  const t = makeCanvas(256, 64), tg = t.getContext('2d');
  tg.fillStyle = '#808080'; tg.fillRect(0, 0, 256, 64);
  tg.fillStyle = '#202020'; for (const y of [14, 26, 38, 50]) tg.fillRect(0, y, 256, 3);
  tg.fillStyle = '#303030'; for (let x = 0; x < 256; x += 12) { tg.fillRect(x, 4, 4, 8); tg.fillRect(x + 6, 52, 4, 8); }
  const treadTex = canvasTexture(t, { repeat: true, anisotropy: 4, srgb: false });
  SHARED = {
    carbonTex, treadTex,
    carbon: new THREE.MeshStandardMaterial({ map: carbonTex, roughness: 0.35, metalness: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.06 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa1ad, metalness: 1, roughness: 0.28 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.7, metalness: 0.2 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.92, bumpMap: treadTex, bumpScale: 1.4 }),
    sidewall: new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.95 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x8b9099, metalness: 1, roughness: 0.4 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.55, metalness: 0.1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x04070b, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.66, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide }),
    lens: new THREE.MeshStandardMaterial({ color: 0xdfe9ff, emissive: 0xcfe0ff, emissiveIntensity: 0.4, roughness: 0.15 }),
    housing: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.25, metalness: 0.8 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.0, roughness: 0.3 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3 }),
  };
  return SHARED;
}

// ------------------------------------------------------------------------------------------------
// loft: sweep rings along z into a smooth surface with material groups
// ------------------------------------------------------------------------------------------------
function loft(stations, K, { closed, matOf, topK, cap }) {
  const S = stations.length;
  const nExtra = cap ? 2 : 0;
  const pos = new Float32Array((S * K + nExtra) * 3), uv = new Float32Array((S * K + nExtra) * 2);
  for (let s = 0; s < S; s++) for (let k = 0; k < K; k++) {
    const o = s * K + k;
    pos[o * 3] = stations[s].ring[k * 2]; pos[o * 3 + 1] = stations[s].ring[k * 2 + 1]; pos[o * 3 + 2] = stations[s].z;
    uv[o * 2] = k / K; uv[o * 2 + 1] = s / (S - 1);
  }
  const buckets = [[], [], []];
  const kEnd = closed ? K : K - 1;
  for (let s = 0; s < S - 1; s++) for (let k = 0; k < kEnd; k++) {
    const m = matOf ? matOf(s, k) : 0;
    if (m < 0) continue;
    const a = s * K + k, b = s * K + ((k + 1) % K), c = (s + 1) * K + k, d = (s + 1) * K + ((k + 1) % K);
    buckets[m].push(a, b, c, b, d, c);
  }
  if (cap) {
    // fan-close both end rings to their centroid
    for (const [s, ci, flip] of [[0, S * K, true], [S - 1, S * K + 1, false]]) {
      let cx = 0, cy = 0;
      for (let k = 0; k < K; k++) { cx += stations[s].ring[k * 2]; cy += stations[s].ring[k * 2 + 1]; }
      const o = ci; pos[o * 3] = cx / K; pos[o * 3 + 1] = cy / K; pos[o * 3 + 2] = stations[s].z; uv[o * 2] = 0.5; uv[o * 2 + 1] = s / (S - 1);
      for (let k = 0; k < K; k++) {
        const a = s * K + k, b = s * K + ((k + 1) % K);
        if (flip) buckets[0].push(ci, b, a); else buckets[0].push(ci, a, b);
      }
    }
  }
  // winding check: the top-centre quad must face +y
  const midS = Math.floor(S / 2), a = midS * K + topK, b = midS * K + ((topK + 1) % K), c = (midS + 1) * K + topK;
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const e1 = [pos[b * 3] - ax, pos[b * 3 + 1] - ay, pos[b * 3 + 2] - az], e2 = [pos[c * 3] - ax, pos[c * 3 + 1] - ay, pos[c * 3 + 2] - az];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  if (ny < 0) for (const bk of buckets) for (let i = 0; i < bk.length; i += 3) { const t = bk[i + 1]; bk[i + 1] = bk[i + 2]; bk[i + 2] = t; }
  const index = [], groups = [];
  buckets.forEach((bk, m) => { if (bk.length) { groups.push({ start: index.length, count: bk.length, m }); index.push(...bk); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  groups.forEach((gr) => g.addGroup(gr.start, gr.count, gr.m));
  g.computeVertexNormals();
  return g;
}

function sampleRing(ctrl, K, closed) {
  const pts = ctrl.map((p) => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const out = new Float32Array(K * 2);
  for (let k = 0; k < K; k++) {
    const p = curve.getPoint(closed ? k / K : k / (K - 1));
    out[k * 2] = p.x; out[k * 2 + 1] = p.y;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// body + cabin
// ------------------------------------------------------------------------------------------------
function bodyStations(shape, spec, detail) {
  const L = spec.length, W = spec.width, hwMax = W / 2;
  const wz = [spec.wheelbase / 2, -spec.wheelbase / 2];
  const ra = spec.rw + 0.075;
  const ts = new Set([0, 0.012, 0.03, 0.06, 0.1, 0.15, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.9, 0.93, 0.955, 0.972, 0.986, 1]);
  if (detail) for (const z of wz) { const tw = (z + L / 2) / L; for (let d = -0.1; d <= 0.1001; d += 0.0125) { const tt = tw + d; if (tt > 0 && tt < 1) ts.add(+tt.toFixed(4)); } }
  const list = [...ts].sort((a, b) => a - b);
  const K = detail ? 44 : 24;
  const stations = [];
  for (const t of list) {
    const z = -L / 2 + t * L;
    const hw = hwMax * interp(shape.hw, t), yb = interp(shape.bot, t);
    let yd = interp(shape.deck, t);
    { // under the greenhouse the deck must sit below the beltline so the cabin grows out of the body
      const c = shape.cab, out = Math.max(0, c.t0 - t, t - c.t3), w = 1 - sstep(0, 0.045, out);
      yd = lerp(yd, Math.min(yd, c.belt - 0.03), w);
    }
    const ysh = yd - 0.05;
    let sill = 0.2 + yb * 0.5, lift = 0;
    for (const zw of wz) {
      const dz = z - zw;
      if (Math.abs(dz) < ra) { const a = spec.rw + Math.sqrt(ra * ra - dz * dz) * 0.97; if (a > sill) { lift = Math.max(lift, a - sill); sill = a; } }
    }
    sill = Math.min(sill, ysh - 0.15);
    const aL = clamp(lift / 0.45, 0, 1);
    const ctrl = [
      [0, yb], [hw * 0.68, yb + (sill * 0.92 - yb) * aL * 0.9 + 0.004], [hw * 0.95, sill], [hw, lerp(sill, ysh, 0.5)],
      [hw * 0.975, ysh - 0.012], [hw * 0.88, ysh + (yd - ysh) * 0.62], [hw * 0.46, yd], [0, yd],
      [-hw * 0.46, yd], [-hw * 0.88, ysh + (yd - ysh) * 0.62], [-hw * 0.975, ysh - 0.012], [-hw, lerp(sill, ysh, 0.5)], [-hw * 0.95, sill],
      [-hw * 0.68, yb + (sill * 0.92 - yb) * aL * 0.9 + 0.004],
    ];
    stations.push({ z, t, ring: sampleRing(ctrl, K, true) });
  }
  return { stations, K };
}

function cabinStations(shape, spec, detail) {
  const c = shape.cab, L = spec.length, hwMax = spec.width / 2;
  const n = detail ? 26 : 12, K = detail ? 30 : 16, stations = [];
  for (let i = 0; i <= n; i++) {
    let u = i / n;
    u = u < 0.5 ? 0.5 * Math.pow(2 * u, 1.35) : 1 - 0.5 * Math.pow(2 * (1 - u), 1.35); // denser at both ends
    const t = lerp(c.t0, c.t3, u);
    let f;
    if (t < c.t1) { const q = (t - c.t0) / (c.t1 - c.t0); f = Math.pow(sstep(0, 1, q), 1.1); }                  // rear window
    else if (t > c.t2) { const q = (t - c.t2) / (c.t3 - c.t2); f = 1 - Math.pow(sstep(0, 1, q), 1 / c.rake); } // windshield
    else f = 1;
    const H = Math.max(0.012, (c.roofY - c.belt) * f);
    const hwb = hwMax * interp(shape.hw, t) * 0.93;
    const hwr = hwb * c.roofHW * (0.8 + 0.2 * Math.sin(Math.PI * clamp((t - c.t0) / (c.t3 - c.t0), 0, 1)));
    const b = c.belt, cr = c.crown * f;
    const half = [
      [hwb, b - 0.14], [hwb * 0.99, b + 0.1 * H], [lerp(hwb, hwr, 0.35), b + 0.5 * H], [hwr * 1.04, b + 0.9 * H], [hwr * 0.55, b + H + cr * 0.7], [0, b + H + cr],
    ];
    const ctrl = [...half, ...half.slice(0, 5).reverse().map((p) => [-p[0], p[1]])];
    stations.push({ z: -L / 2 + t * L, t, u, ring: sampleRing(ctrl, K, false) });
  }
  return { stations, K };
}

function panelTexture(shape) {
  const c = makeCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(15,15,18,0.78)'; g.lineWidth = 2.4; g.lineCap = 'round';
  const line = (u0, v0, u1, v1) => { g.beginPath(); g.moveTo(u0 * 512, (1 - v0) * 512); g.lineTo(u1 * 512, (1 - v1) * 512); g.stroke(); };
  for (const sx of [0, 1]) {
    const U = (u) => (sx ? 1 - u : u);
    for (const v of shape.doors) line(U(0.13), v, U(0.37), v);
    line(U(0.13), shape.doors[0], U(0.13), shape.doors[0]);
    // fuel cap
    if (sx === 0) { g.beginPath(); g.arc(U(0.27) * 512, (1 - shape.fuel) * 512, 9, 0, 7); g.stroke(); }
  }
  // hood + boot
  line(0.41, shape.hoodLine, 0.59, shape.hoodLine); line(0.41, shape.hoodLine, 0.41, 0.97); line(0.59, shape.hoodLine, 0.59, 0.97);
  line(0.41, 0.3, 0.59, 0.3); line(0.41, 0.3, 0.41, 0.05); line(0.59, 0.3, 0.59, 0.05);
  return canvasTexture(c, { anisotropy: 8 });
}

// ------------------------------------------------------------------------------------------------
// wheels
// ------------------------------------------------------------------------------------------------
function rimShape(style, R) {
  const sh = new THREE.Shape(); sh.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hole = (pts) => { const p = new THREE.Path(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); sh.holes.push(p); };
  const sector = (a0, a1, r0, r1, n = 5) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
    for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); pts.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
    return pts;
  };
  const circ = (cx, cy, r, n = 10) => { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; };
  if (style === 'spoke5') { for (let k = 0; k < 5; k++) hole(sector((k * 72 + 11) * Math.PI / 180, (k * 72 + 61) * Math.PI / 180, R * 0.36, R * 0.9)); }
  else if (style === 'split10') { for (let k = 0; k < 10; k++) { const a = k * 36; hole(sector((a + 4) * Math.PI / 180, (a + 15) * Math.PI / 180, R * 0.4, R * 0.9, 3)); hole(sector((a + 20) * Math.PI / 180, (a + 31) * Math.PI / 180, R * 0.4, R * 0.9, 3)); } }
  else if (style === 'mesh') { for (let ring = 0; ring < 3; ring++) { const rr = R * (0.45 + ring * 0.2), n = 12 + ring * 4; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; hole(circ(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.058, 6)); } } }
  else if (style === 'turbine') { for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; hole(sector(a + 0.05, a + 0.2, R * 0.38, R * 0.9, 3).map(([x, y], i, arr) => { const r = Math.hypot(x, y), an = Math.atan2(y, x) + (r - R * 0.38) / R * 0.7; return [Math.cos(an) * r, Math.sin(an) * r]; })); } }
  else if (style === 'classic') { for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; hole(circ(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.17, 14)); } }
  return sh;
}

const rimCache = new Map();
function rimGeometry(style, R) {
  const key = style + R.toFixed(3);
  if (rimCache.has(key)) return rimCache.get(key);
  const g = new THREE.ExtrudeGeometry(rimShape(style, R), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.007, bevelSegments: 1, curveSegments: 10 });
  g.rotateY(Math.PI / 2); // face along +x
  g.computeVertexNormals();
  rimCache.set(key, g);
  return g;
}

function tireGeometry(rw, rimR, tw) {
  const hw = tw / 2, pts = [];
  const half = [[rimR * 0.97, 0.9], [rimR * 1.04, 1.0], [rimR + (rw - rimR) * 0.45, 1.04], [rw * 0.975, 0.92], [rw * 0.997, 0.62], [rw, 0.28], [rw, 0]];
  for (const [r, f] of half) pts.push(new THREE.Vector2(r, -f * hw));
  for (let i = half.length - 2; i >= 0; i--) pts.push(new THREE.Vector2(half[i][0], half[i][1] * hw));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);
  return g;
}

function buildWheel(spec, side, front, look, detail) {
  const S = shared();
  const rw = spec.rw, rimR = rw * 0.66;
  const tw = (0.215 + (spec.width - 1.78) * 0.55 + (front ? 0 : 0.03)) * (0.95 + spec.hp / 6000);
  const group = new THREE.Group();   // placed at wheel centre
  const flip = new THREE.Group();    // mirrors right-hand wheels
  const spin = new THREE.Group();    // rolls
  group.add(flip); flip.add(spin);
  if (side < 0) flip.rotation.y = Math.PI;
  const tire = new THREE.Mesh(tireGeometry(rw, rimR, tw), S.rubber); tire.castShadow = detail; spin.add(tire);
  const rimMat = new THREE.MeshStandardMaterial({ color: look.rimColor, metalness: 0.95, roughness: 0.22 });
  const rim = new THREE.Mesh(rimGeometry(look.rim, rimR * 0.98), rimMat);
  rim.position.x = tw * 0.5 - 0.058; spin.add(rim);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.92, tw * 0.78, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
  barrel.rotation.z = Math.PI / 2; spin.add(barrel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.24, 0.05, 16), S.steel);
  hub.rotation.z = Math.PI / 2; hub.position.x = tw * 0.5 - 0.075; spin.add(hub);
  const info = { group, flip, spin, rim, rimMat, tw, rimR, caliper: null };
  if (detail) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2, nut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 6), S.chrome);
      nut.rotation.z = Math.PI / 2; nut.position.set(tw * 0.5 - 0.052, Math.sin(a) * rimR * 0.2, Math.cos(a) * rimR * 0.2); spin.add(nut);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.9, rimR * 0.9, 0.03, 36), S.disc);
    disc.rotation.z = Math.PI / 2; disc.position.x = tw * 0.5 - 0.12; spin.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.075, rimR * 0.5, rimR * 0.34), new THREE.MeshStandardMaterial({ color: look.brake, roughness: 0.4, metalness: 0.3 }));
    cal.position.set(tw * 0.5 - 0.12, rimR * 0.62 * Math.sin(0.5), rimR * 0.62 * Math.cos(0.5) * (front ? 1 : -1)); // fixed to the pivot (does not roll)
    flip.add(cal); info.caliper = cal;
  }
  return info;
}

// ------------------------------------------------------------------------------------------------
// main builder
// ------------------------------------------------------------------------------------------------
export function buildCar(spec, look, opts = {}) {
  const high = opts.detail !== false;
  const S = shared();
  // cabin numbers in carshapes.js are written nose-first; the loft runs tail (t=0) -> nose (t=1), so mirror them here
  const raw = SHAPES[spec.shape], c0 = raw.cab;
  const shape = { ...raw, cab: { ...c0, t0: 1 - c0.t3, t1: 1 - c0.t2, t2: 1 - c0.t1, t3: 1 - c0.t0, pillars: c0.pillars.map(([a, b]) => [1 - b, 1 - a]) } };
  const L = spec.length, W = spec.width, hw = W / 2;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);   // rolls / pitches
  const fin = FINISHES.find((f) => f.id === look.finish) || FINISHES[0];
  const paint = new THREE.MeshPhysicalMaterial({
    color: look.paint, metalness: fin.metal, roughness: fin.rough, clearcoat: fin.clear, clearcoatRoughness: 0.06, envMapIntensity: 1.15,
    map: high ? panelTexture(shape) : null, iridescence: fin.sheen ? 0.5 : 0, iridescenceIOR: 1.4,
  });

  // --- bodywork
  const bs = bodyStations(shape, spec, high);
  const bodyGeo = loft(bs.stations, bs.K, { closed: true, topK: bs.K / 2, cap: true });
  const bodyMesh = new THREE.Mesh(bodyGeo, paint); bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; body.add(bodyMesh);
  bodyMesh.userData.basePos = bodyGeo.attributes.position.array.slice();

  const cs = cabinStations(shape, spec, high);
  const cab = shape.cab;
  const matOf = (s, k) => {
    const a = cs.stations[s], b = cs.stations[s + 1];
    const tt = (a.t + b.t) / 2, u = (a.u + b.u) / 2, f = (k + 0.5) / (cs.K - 1);
    const sf = f < 0.5 ? f * 2 : (1 - f) * 2; // 0 at the beltline, 1 on the roof centre
    let m;
    // sf follows the control points: 0 base, 0.2 sill band, 0.4/0.6 window sides, 0.8 roof edge, 1.0 roof centre
    if (sf < 0.2) m = 0;
    else if (sf >= 0.6) m = tt < cab.t1 - 0.004 || tt > cab.t2 + 0.004 ? 1 : 0;
    else m = 1;
    if (m === 1) for (const [p0, p1] of cab.pillars) if (u >= p0 && u <= p1) m = 0;
    return m;
  };
  const cabGeo = loft(cs.stations, cs.K, { closed: false, matOf, topK: Math.floor(cs.K / 2) });
  const cabMats = [paint, S.glass];
  const cabinMesh = new THREE.Mesh(cabGeo, cabMats); cabinMesh.castShadow = true; body.add(cabinMesh);
  if (high) { // dark headliner visible from inside (cockpit camera)
    const liner = new THREE.Mesh(cabGeo, [new THREE.MeshStandardMaterial({ color: 0x131419, roughness: 0.95, side: THREE.BackSide }), new THREE.MeshBasicMaterial({ visible: false })]);
    body.add(liner);
  }

  const parts = new THREE.Group(); body.add(parts);
  const add = (geo, mat, x, y, z, parent = parts) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = high; parent.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const zAt = (t) => -L / 2 + t * L;
  const hwAt = (t) => hw * interp(shape.hw, t);
  const deckAt = (t) => interp(shape.deck, t);
  const botAt = (t) => interp(shape.bot, t);

  // --- dark underside + wheel liners
  box(W * 0.78, 0.04, L * 0.82, S.dark, 0, botAt(0.5) + 0.01, 0, parts);
  const wheelPos = [[hw - 0.0, spec.wheelbase / 2, true], [-hw, spec.wheelbase / 2, true], [hw, -spec.wheelbase / 2, false], [-hw, -spec.wheelbase / 2, false]];
  const track = spec.trackW / 2;
  for (const [sx, z] of [[1, spec.wheelbase / 2], [-1, spec.wheelbase / 2], [1, -spec.wheelbase / 2], [-1, -spec.wheelbase / 2]]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(spec.rw + 0.05, spec.rw + 0.05, 0.3, 18, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, side: THREE.DoubleSide }));
    liner.rotation.z = Math.PI / 2; liner.position.set(sx * (track - 0.2), spec.rw, z); parts.add(liner);
  }

  // --- aero parts
  if (high) {
    if (shape.splitter > 0) box(W * 0.8, 0.014, 0.07 + 0.06 * shape.splitter, S.carbon, 0, botAt(1) - 0.05, L / 2 - 0.02, parts);
    if (shape.diffuser > 0) { box(W * 0.62, 0.03, 0.34, S.carbon, 0, botAt(0) + 0.02, -L / 2 + 0.12, parts); for (let i = -2; i <= 2; i++) box(0.015, 0.1 * shape.diffuser + 0.04, 0.3, S.carbon, i * 0.16, botAt(0) + 0.08, -L / 2 + 0.14, parts); }
    if (shape.skirts > 0) for (const sx of [-1, 1]) box(0.05, 0.05, spec.wheelbase * 0.72, S.carbon, sx * (hw - 0.02), 0.2, 0, parts);
  }
  // wings
  const wy = deckAt(0.06), wz = zAt(0.06);
  const endplate = (sx, h, d, x, y, z) => box(0.014, h, d, paint, sx * x, y, z, parts);
  switch (shape.wing) {
    case 'duck': box(W * 0.78, 0.022, 0.14, S.carbon, 0, wy + 0.01, zAt(0.025), parts); break;
    case 'lip': box(W * 0.74, 0.025, 0.1, paint, 0, wy + 0.0, zAt(0.015), parts); break;
    case 'wing': case 'gtwing': {
      const big = shape.wing === 'gtwing', ww = W * (big ? 0.96 : 0.86), wh = wy + (big ? 0.32 : 0.2), wzz = zAt(big ? 0.035 : 0.05);
      box(ww, 0.028, big ? 0.36 : 0.26, S.carbon, 0, wh, wzz, parts);
      if (big) box(ww * 0.98, 0.02, 0.16, S.carbon, 0, wh + 0.07, wzz - 0.06, parts);
      for (const sx of [-1, 1]) { box(0.03, wh - wy + 0.02, 0.1, S.carbon, sx * W * 0.24, (wh + wy) / 2, wzz, parts); endplate(sx, big ? 0.2 : 0.14, big ? 0.4 : 0.3, ww / 2, wh + 0.02, wzz); }
      break;
    }
    case 'rallywing': {
      const y = cab.roofY - 0.02, z = zAt(cab.t1);
      box(W * 0.8, 0.03, 0.3, paint, 0, y + 0.09, z - 0.14, parts).rotation.x = 0.12;
      for (const sx of [-1, 1]) { box(0.016, 0.2, 0.36, paint, sx * W * 0.4, y + 0.02, z - 0.12, parts); box(0.03, 0.1, 0.08, S.dark, sx * W * 0.25, y - 0.02, z - 0.02, parts); }
      break;
    }
    case 'active': {
      const y = wy + 0.3, z = zAt(0.07);
      box(W * 0.92, 0.024, 0.34, S.carbon, 0, y, z, parts);
      for (const sx of [-1, 1]) { box(0.028, 0.34, 0.12, S.carbon, sx * W * 0.17, y - 0.16, z, parts); box(0.014, 0.18, 0.38, S.carbon, sx * W * 0.46, y + 0.02, z, parts); }
      break;
    }
    default: break;
  }
  // hood scoops / vents / roof scoops
  if (shape.scoop === 'hood') {
    const g = new THREE.BoxGeometry(0.46, 0.1, 0.55); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.62); p.setZ(i, p.getZ(i) * 0.82); }
    g.computeVertexNormals(); add(g, paint, 0, deckAt(0.78) + 0.04, zAt(0.78), parts);
    box(0.34, 0.012, 0.06, S.dark, 0, deckAt(0.78) + 0.06, zAt(0.78) + 0.24, parts);
  } else if (shape.scoop === 'vents') {
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) box(0.22, 0.01, 0.025, S.carbon, sx * 0.3, deckAt(0.8) + 0.012 - i * 0.002, zAt(0.77) + i * 0.05, parts);
  }
  if (shape.roofScoop && high) box(0.22, 0.1, 0.34, shape.scoop === 'roof' ? S.carbon : S.dark, 0, cab.roofY + 0.05, zAt(cab.t2 - 0.05), parts);
  if (shape.sideIntake && high) for (const sx of [-1, 1]) box(0.05, 0.2, 0.55, S.dark, sx * (hw * 0.97), 0.56, zAt(0.4), parts);
  if (high) for (const sx of [-1, 1]) { // mirrors + door handles
    const mz = zAt(lerp(cab.t3, cab.t0, 0.14)), my = cab.belt + 0.07, mx = hwAt(lerp(cab.t3, cab.t0, 0.14)) * 0.95 + 0.07;
    const st = box(0.14, 0.014, 0.02, S.trim, sx * (mx - 0.05), my - 0.03, mz, parts); st.rotation.z = -0.25 * sx;
    const m = box(0.08, 0.07, 0.13, paint, sx * mx, my, mz, parts); m.rotation.y = -sx * 0.12;
    box(0.012, 0.02, 0.09, S.chrome, sx * (hwAt(0.5) + 0.002), cab.belt - 0.09, zAt(shape.doors[0] + (shape.doors[1] - shape.doors[0]) * 0.12), parts);
  }

  // upper-surface height of the body at (t, x): used to seat lamps / vents on the bodywork
  const surf = (t, x) => {
    let si = 0; for (let i = 0; i < bs.stations.length; i++) if (bs.stations[i].t <= t) si = i;
    const ring = bs.stations[si].ring, K = bs.K; let best = -1;
    for (let k = 0; k < K; k++) {
      const x0 = ring[k * 2], y0 = ring[k * 2 + 1], x1 = ring[((k + 1) % K) * 2], y1 = ring[((k + 1) % K) * 2 + 1];
      if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) { const f = (x - x0) / (x1 - x0), y = y0 + (y1 - y0) * f; if (y > best) best = y; }
    }
    return best < 0 ? deckAt(t) : best;
  };
  const surfTilt = (t, x) => Math.atan2(surf(Math.min(1, t + 0.012), x) - surf(Math.max(0, t - 0.012), x), L * 0.024);
  // --- grille, lamps
  const front = L / 2, rear = -L / 2;
  const gy = (botAt(0.99) + deckAt(0.99)) / 2, grilleCanvas = makeCanvas(128, 64), gg = grilleCanvas.getContext('2d');
  gg.fillStyle = '#050506'; gg.fillRect(0, 0, 128, 64); gg.strokeStyle = '#2a2d33'; gg.lineWidth = 2;
  for (let y = 6; y < 64; y += 7) { gg.beginPath(); gg.moveTo(4, y); gg.lineTo(124, y); gg.stroke(); }
  if (shape.grille === 'muscle') { gg.fillStyle = '#c9ced6'; gg.fillRect(0, 0, 128, 5); gg.fillRect(0, 59, 128, 5); }
  const grilleMat = new THREE.MeshStandardMaterial({ map: canvasTexture(grilleCanvas, { anisotropy: 4 }), roughness: 0.4, metalness: 0.5 });
  const gw = shape.grille === 'low' ? W * 0.42 : W * 0.5, gh = shape.grille === 'low' ? 0.1 : 0.15;
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), grilleMat);
  grille.position.set(0, gy - 0.01, front + 0.004); body.add(grille);
  const headMat = S.lens.clone(), tailMat = new THREE.MeshStandardMaterial({ color: 0x990909, emissive: 0xff1010, emissiveIntensity: 0.9, roughness: 0.25 });
  const amberF = S.amber.clone(), amberR = S.amber.clone(), revMat = S.reverse.clone();
  const lampT = 0.962, lampX = hwAt(lampT) * 0.62, lampY = surf(lampT, lampX) - 0.012, lampZ = zAt(lampT);
  const lampTilt = -surfTilt(lampT, lampX);
  for (const sx of [-1, 1]) {
    const grp = new THREE.Group(); grp.position.set(sx * lampX, lampY, lampZ); grp.rotation.x = lampTilt; grp.rotation.y = sx * 0.3; body.add(grp);
    if (shape.head === 'round' || shape.head === 'rally') {
      for (const dx of [0, 0.19]) { const d = add(new THREE.CylinderGeometry(0.085, 0.09, 0.05, 20), S.chrome, (sx > 0 ? -dx : dx) * 0.9 + (sx > 0 ? 0.05 : -0.05), 0, 0, grp); d.rotation.x = Math.PI / 2; const l = add(new THREE.CircleGeometry(0.068, 20), headMat, 0, 0, 0.03, d); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.026, 0); }
    } else if (shape.head === 'hyper') {
      box(0.34, 0.035, 0.05, S.housing, 0, 0, 0, grp); box(0.3, 0.014, 0.052, headMat, 0, 0.005, 0.002, grp); box(0.16, 0.03, 0.05, headMat, sx * 0.1, -0.05, 0, grp).rotation.z = 0.25 * sx;
    } else {
      box(0.34, 0.05, 0.04, S.housing, 0, 0, 0, grp); box(0.31, 0.024, 0.046, headMat, 0, 0.004, 0.004, grp); box(0.12, 0.016, 0.056, amberF, sx * -0.08, -0.025, 0.004, grp);
    }
    if (shape.head === 'rally') for (const dx of [0.18, 0.4]) { const l = add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16), headMat, sx * dx * 0.7, -0.15, 0.06, grp); l.rotation.x = Math.PI / 2; }
    // tail lamps
    const tT = 0.04, tx = hwAt(tT) * 0.62, ty = surf(tT, tx) - 0.01, tz = zAt(tT);
    const tg = new THREE.Group(); tg.position.set(sx * tx, ty, tz); tg.rotation.x = -surfTilt(tT, tx) + Math.PI; tg.rotation.y = sx * 0.28; tg.rotation.z = Math.PI; body.add(tg);
    if (shape.tail === 'blocks') for (let i = 0; i < 3; i++) box(0.1, 0.12, 0.04, tailMat, sx * (i * 0.12 - 0.04), 0, 0, tg);
    else if (shape.tail === 'small') { box(0.22, 0.12, 0.04, tailMat, 0, 0, 0, tg); box(0.07, 0.05, 0.04, revMat, sx * -0.08, -0.08, 0, tg); }
    else { box(0.42, 0.045, 0.04, tailMat, sx * 0.05, 0, 0, tg); box(0.18, 0.03, 0.04, amberR, sx * -0.12, -0.05, 0, tg); box(0.08, 0.025, 0.04, revMat, sx * 0.2, -0.06, 0, tg); }
  }
  if (shape.tail === 'bar') box(W * 0.4, 0.022, 0.03, tailMat, 0, surf(0.035, 0) - 0.015, zAt(0.035), parts).rotation.x = -surfTilt(0.035, 0);
  // plates
  if (high) {
    const pc = makeCanvas(128, 64), px = pc.getContext('2d'); px.fillStyle = '#f2f2f2'; px.fillRect(0, 0, 128, 64); px.fillStyle = '#10213f'; px.fillRect(0, 0, 128, 10);
    px.fillStyle = '#111'; px.font = 'bold 34px monospace'; px.textAlign = 'center'; px.fillText('VOID-' + String(spec.id.length * 7 + 11), 64, 48);
    const plate = new THREE.MeshStandardMaterial({ map: canvasTexture(pc, { anisotropy: 4 }), roughness: 0.5 });
    const pf = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), plate); pf.position.set(0, botAt(0.99) + 0.1, front + 0.012); body.add(pf);
    const pr = pf.clone(); pr.position.set(0, deckAt(0.03) - 0.2, rear - 0.01); pr.rotation.y = Math.PI; body.add(pr);
  }
  // exhaust tips
  const ex = shape.exhaust, flames = [];
  const exX = ex.n === 1 ? [ex.x] : ex.n === 2 ? [-ex.x, ex.x] : [-ex.x - 0.14, -ex.x, ex.x, ex.x + 0.14];
  for (const x of exX) {
    const r = ex.style === 'fat' ? 0.058 : ex.style === 'hex' ? 0.05 : 0.044;
    const tip = add(new THREE.CylinderGeometry(r, r * 0.92, 0.14, ex.style === 'hex' ? 6 : 16, 1, true), ex.style === 'hex' ? S.carbon : S.steel, x, ex.y, rear + 0.02, parts);
    tip.rotation.x = Math.PI / 2; tip.material = ex.style === 'hex' ? S.carbon : S.steel;
    const hole = add(new THREE.CircleGeometry(r * 0.92, 12), new THREE.MeshBasicMaterial({ color: 0x050403 }), x, ex.y, rear - 0.04, parts); hole.rotation.y = Math.PI;
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(x, ex.y, rear - 0.32); fl.visible = false; body.add(fl); flames.push(fl);
  }

  // --- interior
  const interior = { steering: null, cluster: null, clusterCtx: null, clusterTex: null };
  if (high) {
    const ig = new THREE.Group(); body.add(ig);
    const zF = zAt(cab.t3), zR = zAt(cab.t0), cx = (zF + zR) / 2, cLen = zF - zR, ihw = hwAt(0.5) * 0.9;
    const belt = cab.belt;
    box(ihw * 2, 0.05, cLen + 0.2, S.fabric, 0, 0.36, cx, ig);
    // dashboard
    const dash = box(ihw * 1.9, 0.16, 0.42, S.leather, 0, belt - 0.07, zF - 0.32, ig); dash.rotation.x = 0.12;
    box(ihw * 1.85, 0.05, 0.22, S.leather, 0, belt - 0.02, zF - 0.22, ig);
    // gauge cluster (canvas, emissive) facing the driver (towards -z)
    const cc = makeCanvas(256, 128); const cctx = cc.getContext('2d'); const ctex = canvasTexture(cc, { anisotropy: 4 });
    const cmat = new THREE.MeshBasicMaterial({ map: ctex, toneMapped: false });
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), cmat); cl.position.set(0.34, belt + 0.07, zF - 0.5); cl.rotation.x = 0.45; cl.rotation.y = Math.PI; ig.add(cl);
    interior.cluster = cc; interior.clusterCtx = cctx; interior.clusterTex = ctex;
    const hood = box(0.36, 0.05, 0.22, S.fabric, 0.34, belt + 0.12, zF - 0.4, ig); hood.rotation.x = 0.25;
    // steering wheel
    const tilt = new THREE.Group(); tilt.position.set(0.34, belt + 0.1, zF - 0.78); tilt.rotation.x = 0.55; ig.add(tilt);
    const sw = new THREE.Group(); tilt.add(sw);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 28), S.leather); sw.add(ring);
    for (const a of [0, 2.1, 4.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.014), S.trim); sp.position.set(Math.cos(a + 1.57) * 0.08, Math.sin(a + 1.57) * 0.08, 0); sp.rotation.z = a + 1.57; sw.add(sp); }
    const hubm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 12), S.trim); hubm.rotation.x = Math.PI / 2; sw.add(hubm);
    interior.steering = sw;
    // seats
    const seat = (x, z) => {
      box(0.5, 0.13, 0.52, S.leather, x, 0.45, z, ig);
      const back = box(0.5, 0.58, 0.12, S.leather, x, 0.78, z - 0.28, ig); back.rotation.x = 0.2;
      box(0.26, 0.2, 0.1, S.leather, x, 1.12, z - 0.35, ig).rotation.x = 0.18;
      box(0.06, 0.4, 0.1, S.trim, x - 0.26, 0.8, z - 0.27, ig); box(0.06, 0.4, 0.1, S.trim, x + 0.26, 0.8, z - 0.27, ig);
    };
    const sz = zF - 1.22;
    seat(0.34, sz); seat(-0.34, sz);
    if ((cab.t3 - cab.t0) * L > 1.9 && (spec.shape === 'muscle' || spec.shape === 'rally')) { box(1.12, 0.14, 0.5, S.leather, 0, 0.46, sz - 0.78, ig); box(1.12, 0.5, 0.1, S.leather, 0, 0.78, sz - 1.04, ig); }
    box(0.18, 0.2, 0.7, S.trim, 0, 0.5, sz + 0.1, ig); // console
    box(0.14, 0.04, 0.06, S.trim, 0, belt + 0.12, zF - 0.2, ig); // inside mirror
    if (shape.cage) {
      const tube = (a, b, r = 0.022) => { const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), S.steel); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); ig.add(m); };
      const y0 = 0.4, y1 = cab.roofY - 0.08, w = ihw * 0.9, zb = sz - 0.42;
      for (const sx of [-1, 1]) { tube(new THREE.Vector3(sx * w, y0, zb), new THREE.Vector3(sx * w * 0.9, y1, zb)); tube(new THREE.Vector3(sx * w * 0.9, y1, zb), new THREE.Vector3(sx * w * 0.8, y1 - 0.05, zF - 0.45)); tube(new THREE.Vector3(sx * w * 0.9, y1, zb), new THREE.Vector3(-sx * w * 0.9, y1 - 0.2, zb)); }
      tube(new THREE.Vector3(-w * 0.9, y1, zb), new THREE.Vector3(w * 0.9, y1, zb));
    }
  }

  // --- wheels
  const wheels = [];
  const trackHalf = spec.trackW / 2;
  const WP = [[1, spec.wheelbase / 2, true], [-1, spec.wheelbase / 2, true], [1, -spec.wheelbase / 2, false], [-1, -spec.wheelbase / 2, false]];
  const pivots = [];
  WP.forEach(([sx, z, front], i) => {
    const w = buildWheel(spec, sx, front, look, high);
    const piv = new THREE.Group(); piv.position.set(sx * (trackHalf - w.tw / 2 + 0.01 + 0.0), spec.rw, z);
    piv.add(w.group); root.add(piv); w.pivot = piv; w.front = front; w.sx = sx; w.z = z; w.x = sx * trackHalf;
    wheels.push(w); pivots.push(piv);
  });

  // headlight beam cones (additive) for night driving
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
  const beams = [];
  if (high) for (const sx of [-1, 1]) {
    const bm = new THREE.Mesh(new THREE.ConeGeometry(1.3, 14, 14, 1, true), beamMat);
    bm.rotation.x = -Math.PI / 2; bm.position.set(sx * lampX, lampY + 0.02, front + 6.9); bm.renderOrder = 5; body.add(bm); beams.push(bm);
  }
  // tail glow sprites
  const glowTex = (() => { const c = makeCanvas(64, 64), g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,60,40,1)'); gr.addColorStop(0.35, 'rgba(255,30,20,0.5)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return canvasTexture(c, { anisotropy: 1 }); })();
  const tails = [];
  for (const sx of [-1, 1]) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0 })); sp.position.set(sx * hwAt(0.04) * 0.62, surf(0.04, hwAt(0.04) * 0.62), rear - 0.1); sp.scale.setScalar(0.9); body.add(sp); tails.push(sp); }

  const zFront = zAt(cab.t3);
  const eyePoint = { x: 0.34, y: Math.max(cab.belt + 0.28, cab.roofY - 0.2), z: zFront - 0.98 };
  const hoodPoint = { x: 0, y: deckAt(cab.t3 + 0.05) + 0.3, z: zAt(Math.min(0.96, cab.t3 + 0.12)) };
  const model = {
    root, body, paint, bodyMesh, wheels, pivots, flames, beams, tails, interior, headMat, tailMat, amberF, amberR, revMat, spec, look, eyePoint, hoodPoint,
    bodyBase: bodyGeo.attributes.position.array.slice(), dents: 0, _t: 0, signalPhase: 0, grille,
  };
  model.setPaint = (hex, finish) => {
    const f = FINISHES.find((q) => q.id === (finish || look.finish)) || FINISHES[0];
    paint.color.set(hex); paint.metalness = f.metal; paint.roughness = f.rough; paint.clearcoat = f.clear; paint.iridescence = f.sheen ? 0.5 : 0;
    look.paint = hex; if (finish) look.finish = finish;
  };
  model.setRim = (style, color) => {
    look.rim = style; look.rimColor = color;
    for (const w of wheels) { w.rim.geometry = rimGeometry(style, w.rimR * 0.98); w.rimMat.color.set(color); }
  };
  model.dent = (lx, lz, s) => {
    const p = bodyGeo.attributes.position, base = model.bodyBase, n = p.count;
    const R = 0.85 + s * 0.5;
    for (let i = 0; i < n; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      const d = Math.hypot(x - lx, z - lz);
      if (d < R) {
        const f = (1 - d / R) ** 2 * s * 0.1;
        const cur = p.getX(i), cy = p.getY(i);
        const dirx = -Math.sign(lx || 1);
        p.setX(i, cur + dirx * f * (Math.abs(lx) > 0.5 ? 1 : 0.3)); p.setY(i, cy - f * 0.2);
        const sz = lz > 0 ? -1 : 1; p.setZ(i, p.getZ(i) + sz * f * (Math.abs(lx) > 0.5 ? 0.3 : 1));
      }
    }
    p.needsUpdate = true; bodyGeo.computeVertexNormals(); model.dents++;
  };
  model.repair = () => { if (!model.dents) return; bodyGeo.attributes.position.array.set(model.bodyBase); bodyGeo.attributes.position.needsUpdate = true; bodyGeo.computeVertexNormals(); model.dents = 0; };
  model.setShadows = (on) => root.traverse((o) => { if (o.isMesh) o.castShadow = on && o.material !== S.glass; });
  model.dispose = () => root.traverse((o) => { if (o.geometry && !rimCache.has(o.geometry)) o.geometry.dispose(); });
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  return model;
}

// ------------------------------------------------------------------------------------------------
// per-frame update (pose, suspension, wheels, lights, flames, cluster)
// ------------------------------------------------------------------------------------------------
export function updateCar(model, v, ctx) {
  const spec = model.spec, S = shared(), time = ctx.time;
  const root = model.root;
  // ---- pose: ground-following pitch/roll + suspension dynamics
  let gp = ctx.pitchG ?? 0, gr = ctx.rollG ?? 0;
  root.position.set(v.x, ctx.baseY ?? v.y, v.z);
  root.rotation.set(0, v.heading, 0);
  root.rotation.order = 'YXZ';
  root.rotation.x = -gp; root.rotation.z = gr;
  // engine vibration & idle shake
  const idle = clamp(1 - v.speed / 8, 0, 1) * (1 - v.throttle);
  const vib = (0.0012 + idle * 0.0016 + v.throttle * 0.0008) * (ctx.near ? 1 : 0);
  const wob = Math.sin(time * (v.rpm / 60) * 3.14) * vib;
  model.body.rotation.x = v.pitch; model.body.rotation.z = v.roll;
  model.body.position.set(wob * 0.6, v.heave + wob, 0);
  // ---- wheels: stay on the ground while the body pitches / rolls / heaves
  const stl = clamp(v.delta * 1.25, -0.7, 0.7);
  for (let i = 0; i < 4; i++) {
    const w = model.wheels[i];
    const off = clamp(v.pitch * w.z - v.roll * w.x - v.heave + (ctx.wheelOff ? ctx.wheelOff[i] : 0), -0.14, 0.14);
    w.pivot.position.y = spec.rw + off;
    w.pivot.rotation.y = w.front ? stl : 0;
    w.spin.rotation.x = w.sx > 0 ? v.wheelAngle[i] : -v.wheelAngle[i];
    if (w.caliper) w.caliper.rotation.x = 0;
  }
  // ---- lights
  const braking = (v.brakeIn > 0.05 && v.u > 0.5) || (v.throttle < 0.05 && v.ax < -5) || (v.reverse && v.throttle > 0.05 && v.u < -0.5);
  const headOn = ctx.headlights ?? 0;
  model.headMat.emissiveIntensity = 0.5 + headOn * 6;
  model.tailMat.emissiveIntensity = 0.9 + (headOn * 0.8) + (braking ? 5 : 0);
  const sig = ctx.signal || 0, blink = Math.sin(time * 9) > 0 ? 1 : 0;
  model.amberF.emissiveIntensity = sig !== 0 ? blink * 4 : 0; model.amberR.emissiveIntensity = model.amberF.emissiveIntensity;
  model.revMat.emissiveIntensity = v.reverse && v.u < -0.3 ? 3 : 0;
  for (const t of model.tails) t.material.opacity = (braking ? 0.95 : 0.15 + headOn * 0.28) * (ctx.near ? 1 : 0.6);
  for (const b of model.beams) b.material.opacity = headOn * 0.022 * (ctx.near ? 1 : 0);
  // ---- flames (nitro + backfire)
  const fl = v.boosting ? 1 : v.backfire > 0.3 ? 0.7 + Math.random() * 0.3 : 0;
  for (const f of model.flames) {
    f.visible = fl > 0;
    if (fl > 0) { f.material.opacity = 0.75 * fl; f.material.color.set(v.boosting ? 0x4db6ff : 0xffa030); f.scale.set(1 + Math.random() * 0.3, 0.7 + fl * (0.6 + Math.random() * 0.7), 1); }
  }
  // ---- steering wheel + gauge cluster (cockpit camera)
  if (model.interior.steering) model.interior.steering.rotation.z = -v.steerWheel * 2.4;
  if (ctx.cluster && model.interior.clusterCtx) drawCluster(model.interior, v);
}

function drawCluster(inter, v) {
  const g = inter.clusterCtx, W = 256, H = 128, s = v.spec;
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
  const dial = (cx, frac, label, maxLabel) => {
    g.strokeStyle = '#243'; g.lineWidth = 6; g.beginPath(); g.arc(cx, 70, 42, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
    g.strokeStyle = '#27d2ff'; g.beginPath(); g.arc(cx, 70, 42, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * clamp(frac, 0, 1))); g.stroke();
    const a = Math.PI * (0.8 + 1.4 * clamp(frac, 0, 1));
    g.strokeStyle = '#ff4d4d'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, 70); g.lineTo(cx + Math.cos(a) * 36, 70 + Math.sin(a) * 36); g.stroke();
  };
  dial(64, v.rpm / s.redline, 'rpm'); dial(192, Math.abs(v.u) * 3.6 / (s.topKmh * 1.05), 'kmh');
  g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillText(String(Math.round(Math.abs(v.u) * 3.6)), 192, 82); g.fillStyle = '#ffb703'; g.fillText(v.reverse ? 'R' : String(v.gear), 128, 112);
  inter.clusterTex.needsUpdate = true;
}
