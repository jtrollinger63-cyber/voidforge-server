// Road infrastructure meshes: asphalt, kerbs, shoulders, barriers, fences, tunnels, gantries, signs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPACING } from './trackmath.js';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Grid slots (shared by car placement and painted markings). Slot 0 = pole. */
export function gridSlot(td, k) {
  const row = k >> 1, col = k & 1 ? 1 : -1;
  const dist = 10 + row * 9.5 + (col > 0 ? 4.5 : 0);
  return { idx: td.N - Math.round(dist / SPACING), lat: col * td.width * 0.2 };
}

/** Sweep a (dLat, y) profile along samples [i0..i1]; base height comes from `baseY(i, lat)`. */
function extrude(td, i0, i1, profile, latOf, baseY, tile = 0, closedLoop = false) {
  const n = i1 - i0 + 1, P = profile.length;
  const pos = new Float32Array(n * P * 3), uv = new Float32Array(n * P * 2);
  for (let a = 0; a < n; a++) {
    const i = (i0 + a) % td.N, lat0 = latOf(i), by = baseY(i, lat0);
    for (let p = 0; p < P; p++) {
      const o = a * P + p, lat = lat0 + profile[p][0];
      pos[o * 3] = td.px[i] + td.rx[i] * lat; pos[o * 3 + 1] = by + profile[p][1]; pos[o * 3 + 2] = td.pz[i] + td.rz[i] * lat;
      uv[o * 2] = p / (P - 1); uv[o * 2 + 1] = tile ? (a * SPACING) / tile : a / n;
    }
  }
  const idx = [];
  for (let a = 0; a < n - 1; a++) for (let p = 0; p < P - 1; p++) {
    const q0 = a * P + p, q1 = q0 + 1, q2 = (a + 1) * P + p, q3 = q2 + 1;
    idx.push(q0, q1, q2, q1, q3, q2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------------ textures
function asphaltTexture(td, envId, env, aniso) {
  const W = 1024, H = 1024, c = makeCanvas(W, H), g = c.getContext('2d'), rnd = mulberry32(21);
  const wet = !!env.wet;
  g.fillStyle = wet ? '#202228' : envId === 'desert' ? '#4d4743' : envId === 'circuit' ? '#3b3e44' : '#34363b'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) { const l = rnd(); g.fillStyle = l > 0.5 ? `rgba(255,255,255,${0.025 + rnd() * 0.05})` : `rgba(0,0,0,${0.06 + rnd() * 0.1})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  // patches + cracks
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.07})`; g.fillRect(rnd() * W, rnd() * H, 60 + rnd() * 160, 30 + rnd() * 100); }
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
  for (let i = 0; i < 9; i++) { g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y); for (let k = 0; k < 14; k++) { x += (rnd() - 0.5) * 40; y += rnd() * 24; g.lineTo(x, y); } g.stroke(); }
  // rubbered racing line + tyre tracks
  for (const cx of [0.3, 0.7]) { const gr = g.createLinearGradient((cx - 0.1) * W, 0, (cx + 0.1) * W, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, wet ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.26)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect((cx - 0.1) * W, 0, 0.2 * W, H); }
  if (envId === 'neon') for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(8,8,12,0.35)'; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 60, 8 + rnd() * 20, rnd() * 3, 0, 7); g.fill(); }
  // markings
  const edge = 'rgba(244,244,244,0.94)', yel = 'rgba(255,205,60,0.95)';
  const line = (u, wd, col, dash) => { g.fillStyle = col; if (!dash) g.fillRect(u * W - wd / 2, 0, wd, H); else for (let y = 0; y < H; y += H / 4) g.fillRect(u * W - wd / 2, y, wd, dash); };
  const ew = Math.max(7, (0.3 / td.width) * W);
  line(0.035, ew, edge); line(0.965, ew, edge);
  if (envId === 'circuit') { /* racing circuit: just edge lines and the rubber line */ }
  else if (envId === 'neon') { line(1 / 3, ew * 0.8, edge, H / 8); line(2 / 3, ew * 0.8, edge, H / 8); line(0.5, ew * 0.9, yel); line(0.5 + 0.012, ew * 0.9, yel); }
  else if (envId === 'mountain') { line(0.5 - 0.01, ew * 0.8, yel); line(0.5 + 0.01, ew * 0.8, yel); }
  else line(0.5, ew * 0.85, envId === 'desert' ? yel : edge, H / 8);
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function roughnessMap(env, aniso) {
  const W = 256, c = makeCanvas(W, W), g = c.getContext('2d'), rnd = mulberry32(9);
  g.fillStyle = env.wet ? '#555' : '#d8d8d8'; g.fillRect(0, 0, W, W);
  if (env.wet) for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * W, r = 10 + rnd() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,10,10,0.95)'); gr.addColorStop(1, 'rgba(10,10,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = canvasTexture(c, { repeat: true, anisotropy: aniso, srgb: false }); t.repeat.set(1, 1); return t;
}

function kerbTexture(envId, aniso) {
  const c = makeCanvas(64, 128), g = c.getContext('2d');
  const [a, b] = envId === 'circuit' ? ['#d8232a', '#f3f3f3'] : envId === 'neon' ? ['#8c8f98', '#6a6d76'] : ['#c9b88a', '#8a7b5a'];
  g.fillStyle = a; g.fillRect(0, 0, 64, 64); g.fillStyle = b; g.fillRect(0, 64, 64, 64);
  if (envId === 'circuit') { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 64, 4); g.fillRect(0, 60, 64, 8); }
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function gravelTexture(envId, env, aniso) {
  const c = makeCanvas(256, 256), g = c.getContext('2d'), rnd = mulberry32(5);
  const base = envId === 'desert' ? '#b8956a' : envId === 'neon' ? '#4a4c55' : envId === 'circuit' ? '#9a8d78' : envId === 'coast' ? '#a89c84' : '#7f7769';
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 90 + rnd() * 110; g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.85},0.5)`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2); }
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function bannerTexture(w, h, text, sub, c1 = '#0b1230', c2 = '#162a66', acc = '#00e5ff') {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, c1); gr.addColorStop(0.5, c2); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = acc; g.fillRect(0, 0, w, h * 0.05); g.fillRect(0, h * 0.95, w, h * 0.05);
  g.font = `italic 900 ${h * 0.56}px "Trebuchet MS","Segoe UI",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(text, w / 2, h * 0.43);
  g.font = `700 ${h * 0.16}px "Trebuchet MS",sans-serif`; g.fillStyle = '#ffb703'; g.fillText(sub, w / 2, h * 0.82);
  return canvasTexture(c, { anisotropy: 8 });
}

function chevronTexture() {
  const c = makeCanvas(128, 96), g = c.getContext('2d'); g.fillStyle = '#ffd400'; g.fillRect(0, 0, 128, 96);
  g.strokeStyle = '#111'; g.lineWidth = 7; g.strokeRect(5, 5, 118, 86);
  g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(40, 18); g.lineTo(88, 48); g.lineTo(40, 78); g.stroke();
  return canvasTexture(c, { anisotropy: 4 });
}

function highwaySign(text, sub) {
  const c = makeCanvas(512, 192), g = c.getContext('2d'); g.fillStyle = '#0a6b3a'; g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 176);
  g.fillStyle = '#fff'; g.font = 'bold 74px "Trebuchet MS",sans-serif'; g.textAlign = 'center'; g.fillText(text, 256, 100);
  g.font = 'bold 42px "Trebuchet MS",sans-serif'; g.fillText(sub, 256, 156);
  return canvasTexture(c, { anisotropy: 8 });
}

// ------------------------------------------------------------------------------------------------ main builder
export function buildTrackMeshes({ td, terrain, envId, env, aniso = 8, quality = 2 }) {
  const group = new THREE.Group();
  const half = td.half, N = td.N, def = td.def;
  const rnd = mulberry32(77);
  const roadLen = td.length, roadTile = roadLen / Math.round(roadLen / 24);
  const lights = []; // emissive things the world may want (tunnel lamps etc.)
  const roadY = (i, lat) => td.py[i] + lat * td.bank[i];
  const groundY = (i, lat) => (Math.abs(lat) <= half + td.shoulder + 4.2 ? roadY(i, lat) : terrain.height(td.px[i] + td.rx[i] * lat, td.pz[i] + td.rz[i] * lat));
  const isTunnel = (i) => td.tunnel[((i % N) + N) % N] === 1;

  // --- asphalt
  const wet = !!env.wet;
  const rMap = roughnessMap(env, aniso);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture(td, envId, env, aniso), roughnessMap: rMap, roughness: wet ? 1.0 : 0.95, metalness: wet ? 0.12 : 0, envMapIntensity: wet ? 1.6 : 0.6,
  });
  rMap.repeat.set(1, roadLen / 40); rMap.wrapT = THREE.RepeatWrapping;
  // road ribbon: cross-section of 5 points so banking/crown render smoothly
  const roadProfile = [[-half, 0], [-half * 0.5, 0.006], [0, 0.012], [half * 0.5, 0.006], [half, 0]];
  const roadGeo = extrude(td, 0, N, roadProfile, () => 0, (i) => td.py[i], roadTile);
  // bank: raise by lateral slope
  { const p = roadGeo.attributes.position; const P = roadProfile.length; for (let a = 0; a <= N; a++) { const i = a % N; for (let k = 0; k < P; k++) { const o = a * P + k; p.setY(o, td.py[i] + roadProfile[k][0] * td.bank[i] + roadProfile[k][1]); } } p.needsUpdate = true; roadGeo.computeVertexNormals(); }
  // remap uv.x so the 5 cross-section points span 0..1
  const road = new THREE.Mesh(roadGeo, roadMat); road.receiveShadow = true; group.add(road);

  // --- kerbs (both edges)
  const kerbW = envId === 'circuit' ? 1.6 : 1.4, kerbH = envId === 'neon' ? 0.13 : envId === 'circuit' ? 0.04 : 0.03;
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(envId, aniso), roughness: 0.75, envMapIntensity: 0.5 });
  const kTile = roadLen / Math.round(roadLen / 6);
  const kerbParts = [];
  for (const s of [-1, 1]) {
    const prof = s > 0 ? [[0, 0.0], [0.0, kerbH], [kerbW, kerbH * 0.4]] : [[-kerbW, kerbH * 0.4], [0, kerbH], [0, 0.0]];
    const g = extrude(td, 0, N, prof, () => s * half, (i, lat) => roadY(i, lat), kTile);
    if (s < 0) { /* flip uv direction so stripes still read */ }
    kerbParts.push(g);
  }
  const kerbs = new THREE.Mesh(mergeGeometries(kerbParts), kerbMat); kerbs.receiveShadow = true; kerbs.frustumCulled = false; group.add(kerbs);

  // --- shoulders: from the kerb out to the terrain
  const shMat = new THREE.MeshStandardMaterial({ map: gravelTexture(envId, env, aniso), roughness: 1, envMapIntensity: 0.3 });
  shMat.map.repeat.set(Math.max(0.3, (Math.min(half + def.runoff - 0.2, half + td.shoulder + 4) - half - 1.4) / 12), roadLen / 12);
  const shParts = [];
  const outerLat = Math.min(half + def.runoff - 0.2, half + td.shoulder + 4);
  for (const s of [-1, 1]) {
    const innerLat = half + kerbW, nSeg = 3;
    const pr = []; for (let k = 0; k <= nSeg; k++) pr.push([k / nSeg, 0]);
    const n = N + 1, P = pr.length, pos = new Float32Array(n * P * 3), uv = new Float32Array(n * P * 2);
    for (let a = 0; a < n; a++) {
      const i = a % N;
      for (let k = 0; k < P; k++) {
        const lat = s * (innerLat + (outerLat - innerLat) * (k / (P - 1)));
        const x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat;
        const yRoad = roadY(i, lat), yT = terrain.height(x, z) + 0.02, f = k / (P - 1);
        const o = a * P + k; pos[o * 3] = x; pos[o * 3 + 1] = Math.abs(lat) <= half + td.shoulder ? yRoad - 0.01 * k : yRoad + (yT - yRoad) * f * f; pos[o * 3 + 2] = z;
        uv[o * 2] = k / (P - 1); uv[o * 2 + 1] = (a * SPACING) / 12;
      }
    }
    const idx = []; for (let a = 0; a < n - 1; a++) for (let k = 0; k < P - 1; k++) { const q0 = a * P + k, q2 = (a + 1) * P + k; idx.push(q0, q0 + 1, q2, q0 + 1, q2 + 1, q2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if (s > 0) { /* winding differs per side; use DoubleSide material */ }
    shParts.push(g);
  }
  shMat.side = THREE.DoubleSide;
  const shoulders = new THREE.Mesh(mergeGeometries(shParts), shMat); shoulders.receiveShadow = true; shoulders.frustumCulled = false; group.add(shoulders);

  // --- barriers
  const barrierStyle = def.barrier || { circuit: 'jersey', neon: 'jersey', coast: 'rail', mountain: 'rail', desert: 'rail' }[envId];
  const wallLat = half + def.runoff;
  const segs = []; // [i0, i1] ranges outside tunnels
  { let s0 = -1; for (let i = 0; i <= N; i++) { const t = i < N && !isTunnel(i); if (t && s0 < 0) s0 = i; if (!t && s0 >= 0) { if (i - 1 - s0 > 4) segs.push([s0, i - 1]); s0 = -1; } } }
  const concreteTex = (() => { const c = makeCanvas(256, 64), g = c.getContext('2d'); g.fillStyle = envId === 'neon' ? '#3a3d48' : '#c5c8cf'; g.fillRect(0, 0, 256, 64);
    if (envId === 'circuit') { g.fillStyle = '#d8232a'; g.fillRect(0, 40, 128, 8); g.fillStyle = '#1f4fd8'; g.fillRect(128, 40, 128, 8); }
    if (envId === 'neon') { g.fillStyle = '#ff2bd6'; g.fillRect(0, 36, 256, 3); g.fillStyle = '#25e6ff'; g.fillRect(0, 44, 256, 3); }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
    return canvasTexture(c, { repeat: true, anisotropy: aniso }); })();
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.85, envMapIntensity: 0.5, emissive: envId === 'neon' ? 0x220820 : 0x000000, emissiveMap: envId === 'neon' ? concreteTex : null, emissiveIntensity: envId === 'neon' ? 0.55 : 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xaeb4bd, metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8ab94, roughness: 0.95 });
  const barrierGeos = { concrete: [], steel: [], stone: [] };
  const sideSkip = (s, i) => (envId === 'coast' && s > 0 && false) || false;
  for (const [i0, i1] of segs) for (const s of [-1, 1]) {
    const latOf = () => s * wallLat, base = (i, lat) => groundY(i, lat);
    if (barrierStyle === 'jersey') {
      const prof = s > 0 ? [[-0.24, 0], [-0.24, 0.1], [-0.11, 0.52], [-0.08, 0.95], [0.08, 0.95], [0.11, 0.52], [0.24, 0.1], [0.24, 0]] : [[0.24, 0], [0.24, 0.1], [0.11, 0.52], [0.08, 0.95], [-0.08, 0.95], [-0.11, 0.52], [-0.24, 0.1], [-0.24, 0]];
      barrierGeos.concrete.push(extrude(td, i0, i1, prof, latOf, base, 8));
    } else if (envId === 'coast' && s > 0) {
      barrierGeos.stone.push(extrude(td, i0, i1, [[-0.35, 0], [-0.35, 0.95], [0.35, 0.95], [0.35, 0]], latOf, base, 6));
    } else {
      const sg = s > 0 ? -1 : 1;
      barrierGeos.steel.push(extrude(td, i0, i1, [[sg * 0.06, 0.38], [sg * 0.12, 0.5], [sg * 0.06, 0.62], [sg * 0.12, 0.74], [sg * 0.06, 0.86]], latOf, base, 4));
    }
  }
  for (const [key, mat] of [['concrete', concrete], ['steel', steel], ['stone', stone]]) {
    if (!barrierGeos[key].length) continue;
    const m = new THREE.Mesh(mergeGeometries(barrierGeos[key]), mat); m.castShadow = key !== 'steel'; m.receiveShadow = true; m.frustumCulled = false;
    if (key !== 'steel') m.material.side = THREE.DoubleSide;
    group.add(m);
  }
  // guard-rail posts
  if (barrierStyle === 'rail' || envId === 'coast') {
    const spots = [];
    for (const [i0, i1] of segs) for (let i = i0; i < i1; i += 2) for (const s of [-1, 1]) {
      if (envId === 'coast' && s > 0) continue;
      const lat = s * (wallLat + (s > 0 ? -0.05 : 0.05)), x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat;
      spots.push([x, groundY(i, lat) - 0.05, z, td.heading[i]]);
    }
    if (spots.length) {
      const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.0, 0.12), new THREE.MeshStandardMaterial({ color: 0x7a7f88, metalness: 0.5, roughness: 0.6 }), spots.length);
      const d = new THREE.Object3D(); spots.forEach((p, k) => { d.position.set(p[0], p[1] + 0.45, p[2]); d.rotation.set(0, p[3], 0); d.updateMatrix(); post.setMatrixAt(k, d.matrix); });
      post.castShadow = false; post.frustumCulled = false; group.add(post);
    }
  }
  // circuit: catch fence + tyre walls on the outside of tight corners
  if (envId === 'circuit') {
    const fc = makeCanvas(64, 64), fg = fc.getContext('2d'); fg.strokeStyle = 'rgba(210,214,220,0.9)'; fg.lineWidth = 2;
    for (let i = 0; i <= 64; i += 8) { fg.beginPath(); fg.moveTo(i, 0); fg.lineTo(i, 64); fg.stroke(); fg.beginPath(); fg.moveTo(0, i); fg.lineTo(64, i); fg.stroke(); }
    const ft = canvasTexture(fc, { repeat: true, anisotropy: 4 }); const fenceMat = new THREE.MeshBasicMaterial({ map: ft, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.2 });
    ft.repeat.set(1, 1);
    const fences = [], posts = [];
    for (const [i0, i1] of segs) for (const s of [-1, 1]) { fences.push(extrude(td, i0, i1, [[0, 0.95], [0, 4.2]], () => s * (wallLat + 0.9), groundY, 5)); }
    const fm = new THREE.Mesh(mergeGeometries(fences), fenceMat); fm.frustumCulled = false; fm.renderOrder = 3; group.add(fm);
    for (let i = 0; i < N; i += 4) for (const s of [-1, 1]) { if (isTunnel(i)) continue; const lat = s * (wallLat + 0.9); posts.push([td.px[i] + td.rx[i] * lat, groundY(i, lat), td.pz[i] + td.rz[i] * lat]); }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 4.3, 6), new THREE.MeshStandardMaterial({ color: 0x8b9099, metalness: 0.7, roughness: 0.4 }), posts.length);
    const d = new THREE.Object3D(); posts.forEach((p, k) => { d.position.set(p[0], p[1] + 2.15, p[2]); d.updateMatrix(); pm.setMatrixAt(k, d.matrix); }); pm.frustumCulled = false; group.add(pm);
    // tyre walls at the outside of corners
    const tyres = [];
    for (let i = 0; i < N; i += 3) { const c = td.curv[i]; if (Math.abs(c) < 1 / 140) continue; const s = c > 0 ? 1 : -1; if ((i % 6) !== 0) continue; const lat = s * (wallLat - 0.75); tyres.push([td.px[i] + td.rx[i] * lat, groundY(i, lat), td.pz[i] + td.rz[i] * lat, i]); }
    if (tyres.length) {
      const tm = new THREE.InstancedMesh(new THREE.TorusGeometry(0.4, 0.17, 8, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 }), tyres.length * 4);
      let k = 0; tyres.forEach((p) => { for (let h = 0; h < 4; h++) { d.position.set(p[0], p[1] + 0.2 + (h >> 1) * 0.36, p[2]); d.rotation.set(0, (h * 1.3) % 6, 0); d.updateMatrix(); tm.setMatrixAt(k++, d.matrix); } });
      tm.castShadow = true; tm.frustumCulled = false; group.add(tm);
      const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 0);
    }
  }

  // --- chevron boards on tight curves
  {
    const spots = [];
    for (let i = 0; i < N; i += 8) {
      if (isTunnel(i)) continue; const c = td.curv[i];
      if (Math.abs(c) > 1 / 110) { const s = c > 0 ? 1 : -1; const lat = s * (wallLat + 1.4); spots.push([td.px[i] + td.rx[i] * lat, groundY(i, lat), td.pz[i] + td.rz[i] * lat, td.heading[i] + (c > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) * 0 + Math.PI + s * 0.5, c > 0 ? 1 : -1]); }
    }
    if (spots.length) {
      const tex = chevronTexture(), plane = new THREE.PlaneGeometry(1.5, 1.1);
      const mm = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }), spots.length);
      const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), new THREE.MeshStandardMaterial({ color: 0x777b84 }), spots.length);
      const d = new THREE.Object3D(); spots.forEach((p, k) => { d.position.set(p[0], p[1] + 1.55, p[2]); d.rotation.set(0, p[3], 0); d.scale.set(p[4] > 0 ? 1 : -1, 1, 1); d.updateMatrix(); mm.setMatrixAt(k, d.matrix); d.position.set(p[0], p[1] + 0.9, p[2]); d.scale.set(1, 1, 1); d.updateMatrix(); pm.setMatrixAt(k, d.matrix); });
      mm.frustumCulled = false; pm.frustumCulled = false; group.add(mm, pm);
    }
  }

  // --- tunnels
  const tunnelRanges = [];
  { let s0 = -1; for (let i = 0; i <= N; i++) { const t = i < N && td.tunnel[i]; if (t && s0 < 0) s0 = i; if (!t && s0 >= 0) { tunnelRanges.push([s0, i - 1]); s0 = -1; } } }
  if (tunnelRanges.length) {
    const tw = half + 1.6, wallH = 3.2, topH = 4.6, prof = [];
    prof.push([-tw, 0], [-tw, wallH]);
    for (let a = 1; a < 14; a++) { const ang = Math.PI - (a / 14) * Math.PI; prof.push([Math.cos(ang) * tw, wallH + Math.sin(ang) * topH]); }
    prof.push([tw, wallH], [tw, 0]);
    const concreteTun = new THREE.MeshStandardMaterial({ color: envId === 'neon' ? 0x3a3a46 : 0x7a7871, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.25 });
    const lampMat = new THREE.MeshBasicMaterial({ color: envId === 'neon' ? 0x66e0ff : 0xffcf80, toneMapped: false });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.08, 2.2);
    const lampSpots = [];
    for (const [i0, i1] of tunnelRanges) {
      const shell = extrude(td, i0, i1, prof, () => 0, (i) => td.py[i], 10);
      // shell lateral positions should follow banking: lift by bank at lat
      const p = shell.attributes.position; const P = prof.length;
      for (let a = 0; a <= i1 - i0; a++) { const i = i0 + a; for (let k = 0; k < P; k++) { const o = a * P + k; p.setY(o, td.py[i] + prof[k][1] + prof[k][0] * td.bank[i] * 0.0); } }
      p.needsUpdate = true; shell.computeVertexNormals();
      const m = new THREE.Mesh(shell, concreteTun); m.receiveShadow = true; m.frustumCulled = false; group.add(m);
      for (let i = i0 + 2; i < i1 - 1; i += 4) for (const s of [-1, 1]) { const lat = s * tw * 0.45, x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat; lampSpots.push([x, td.py[i] + wallH + topH * 0.88, z, td.heading[i]]); }
      // portals
      for (const [i, flip] of [[i0, 1], [i1, -1]]) {
        const sh = new THREE.Shape(); const ow = tw + 4.2, oh = 11.5; sh.moveTo(-ow, -0.5); sh.lineTo(ow, -0.5); sh.lineTo(ow, oh); sh.lineTo(-ow, oh); sh.closePath();
        const hole = new THREE.Path(); hole.moveTo(-tw, 0); hole.lineTo(-tw, wallH);
        for (let a = 1; a < 14; a++) { const ang = Math.PI - (a / 14) * Math.PI; hole.lineTo(Math.cos(ang) * tw, wallH + Math.sin(ang) * topH); }
        hole.lineTo(tw, wallH); hole.lineTo(tw, 0); hole.closePath(); sh.holes.push(hole);
        const pg = new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: false });
        const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: envId === 'neon' ? 0x2c2c38 : 0x8c887e, roughness: 0.9 }));
        pm.position.set(td.px[i], td.py[i], td.pz[i]); pm.rotation.y = td.heading[i] + (flip > 0 ? Math.PI : 0); pm.position.addScaledVector(new THREE.Vector3(td.tx[i], 0, td.tz[i]), flip > 0 ? 1.1 : -1.1);
        pm.castShadow = true; pm.receiveShadow = true; group.add(pm);
      }
      // road surface inside the tunnel is the normal ribbon
    }
    if (lampSpots.length) {
      const lm = new THREE.InstancedMesh(lampGeo, lampMat, lampSpots.length);
      const d = new THREE.Object3D(); lampSpots.forEach((p, k) => { d.position.set(p[0], p[1], p[2]); d.rotation.set(0, p[3], 0); d.updateMatrix(); lm.setMatrixAt(k, d.matrix); });
      lm.frustumCulled = false; group.add(lm);
    }
  }

  // --- start/finish gantry + grid markings
  {
    const h = td.heading[0], start = new THREE.Group(); start.position.set(td.px[0], td.py[0], td.pz[0]); start.rotation.y = h; group.add(start);
    const cv = makeCanvas(128, 64), cg = cv.getContext('2d'); for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { cg.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5'; cg.fillRect(x * 8, y * 16, 8, 16); }
    const checker = new THREE.Mesh(new THREE.PlaneGeometry(td.width, 3), new THREE.MeshStandardMaterial({ map: canvasTexture(cv, { anisotropy: 8 }), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    checker.rotation.x = -Math.PI / 2; checker.position.y = 0.03; start.add(checker);
    const steel2 = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.7, roughness: 0.35 });
    const gx = half + 2.4;
    for (const sx of [-gx, gx]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, 9, 1.0), steel2); p.position.set(sx, 4.5, 0); p.castShadow = true; start.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(gx * 2 + 1, 2.6, 1.2), steel2); beam.position.set(0, 8.6, 0); beam.castShadow = true; start.add(beam);
    const bmat = new THREE.MeshBasicMaterial({ map: bannerTexture(1024, 160, 'START / FINISH', 'VOIDFORGE RACING'), toneMapped: false });
    for (const dz of [-0.62, 0.62]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(gx * 2 + 1, 2.5), bmat); b.position.set(0, 8.6, dz); if (dz < 0) b.rotation.y = Math.PI; start.add(b); }
    // grid boxes
    const gc = makeCanvas(64, 128), g2 = gc.getContext('2d'); g2.strokeStyle = 'rgba(255,255,255,0.9)'; g2.lineWidth = 6; g2.beginPath(); g2.moveTo(5, 122); g2.lineTo(5, 8); g2.lineTo(59, 8); g2.lineTo(59, 122); g2.stroke();
    const gmat = new THREE.MeshBasicMaterial({ map: canvasTexture(gc, { anisotropy: 8 }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const ggeo = new THREE.PlaneGeometry(2.8, 5.4).rotateX(-Math.PI / 2);
    for (let k = 0; k < 12; k++) {
      const s = gridSlot(td, k), i = ((s.idx % N) + N) % N; const m = new THREE.Mesh(ggeo, gmat);
      m.position.set(td.px[i] + td.rx[i] * s.lat, td.py[i] + s.lat * td.bank[i] + 0.035, td.pz[i] + td.rz[i] * s.lat); m.rotation.y = td.heading[i] + Math.PI; group.add(m);
    }
  }

  // --- overhead highway gantries
  if (envId !== 'circuit') {
    const texts = [['Next 2 km', envId === 'coast' ? 'Harbour View' : envId === 'desert' ? 'Redrock City' : envId === 'mountain' ? 'Summit' : 'Midtown'], ['EXIT 14', 'Services · Fuel']];
    for (let k = 0; k < 3; k++) {
      const i = Math.round((((k + 0.5) / 3) * N + 40) % N); if (isTunnel(i) || Math.abs(td.curv[i]) > 1 / 400) continue;
      const g = new THREE.Group(); g.position.set(td.px[i], td.py[i], td.pz[i]); g.rotation.y = td.heading[i];
      const post = new THREE.MeshStandardMaterial({ color: 0x8d939e, metalness: 0.7, roughness: 0.45 }); const gxx = half + 1.8;
      for (const sx of [-gxx, gxx]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 0.4), post); p.position.set(sx, 3.6, 0); g.add(p); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(gxx * 2, 0.35, 0.35), post); bar.position.set(0, 7.0, 0); g.add(bar);
      const t = texts[k % 2]; const sg = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2), new THREE.MeshBasicMaterial({ map: highwaySign(t[0], t[1]), toneMapped: false, side: THREE.DoubleSide })); sg.position.set(-1.5 + k, 5.9, 0.0); g.add(sg);
      group.add(g);
    }
  }

  return { group, tunnelRanges, dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } };
}
