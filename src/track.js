// Track meshes: road, kerbs, barriers, start line + gantry. Geometry comes from trackmath.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPACING } from './trackmath.js';
import { makeCanvas, canvasTexture, mulberry32, shade } from './util.js';

/** A strip along the track between two (lateral, height) points, with v = distance / tile. */
function ribbon(td, latA, yA, latB, yB, tile) {
  const { N, px, pz, rx, rz } = td;
  const cols = N + 1;
  const pos = new Float32Array(cols * 2 * 3);
  const uv = new Float32Array(cols * 2 * 2);
  for (let i = 0; i < cols; i++) {
    const k = i % N;
    const o = i * 6;
    pos[o] = px[k] + rx[k] * latA; pos[o + 1] = yA; pos[o + 2] = pz[k] + rz[k] * latA;
    pos[o + 3] = px[k] + rx[k] * latB; pos[o + 4] = yB; pos[o + 5] = pz[k] + rz[k] * latB;
    const v = (i * SPACING) / tile;
    uv[i * 4] = 0; uv[i * 4 + 1] = v; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
  }
  const idx = new Uint32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.set([a, b, c, b, d, c], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

function roadTexture(theme, aniso) {
  const W = 512, H = 512; // one tile = 20 m long, full road width
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = theme.road; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(7);
  for (let i = 0; i < 9000; i++) {
    const l = rnd();
    g.fillStyle = l > 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // rubbered-in racing lines
  for (const cx of [0.3, 0.7]) {
    const grad = g.createLinearGradient((cx - 0.09) * W, 0, (cx + 0.09) * W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.20)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect((cx - 0.09) * W, 0, 0.18 * W, H);
  }
  // edge lines
  g.fillStyle = 'rgba(245,245,245,0.92)';
  g.fillRect(0.032 * W, 0, 0.012 * W, H);
  g.fillRect(0.956 * W, 0, 0.012 * W, H);
  // dashed centre line (4 m on, 6 m off)
  g.fillStyle = 'rgba(255,214,64,0.9)';
  for (const y0 of [0, 256]) g.fillRect(0.495 * W, y0, 0.01 * W, 102);
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function stripeTexture(a, b, w = 64, h = 128, aniso = 4) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = b; g.fillRect(0, h / 2, w, h / 2);
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function wallTexture(aniso) {
  const c = makeCanvas(32, 128), g = c.getContext('2d');
  g.fillStyle = '#e8e8ea'; g.fillRect(0, 0, 32, 128);
  g.fillStyle = '#d8262c'; g.fillRect(0, 0, 32, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 100, 32, 28);
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function checkerTexture() {
  const c = makeCanvas(128, 64), g = c.getContext('2d');
  const n = 8;
  for (let y = 0; y < 4; y++) for (let x = 0; x < n * 2; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
    g.fillRect(x * (128 / (n * 2)), y * 16, 128 / (n * 2), 16);
  }
  return canvasTexture(c, { anisotropy: 8 });
}

function bannerTexture(text, sub) {
  const c = makeCanvas(1024, 160), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#0b1230'); grad.addColorStop(0.5, '#162a66'); grad.addColorStop(1, '#0b1230');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#00e5ff'; g.fillRect(0, 0, 1024, 8); g.fillRect(0, 152, 1024, 8);
  g.font = 'italic 900 92px "Trebuchet MS","Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText(text, 512, 66);
  g.font = '700 26px "Trebuchet MS","Segoe UI",sans-serif'; g.fillStyle = '#ffb703'; g.fillText(sub, 512, 128);
  return canvasTexture(c, { anisotropy: 8 });
}

export function buildTrackMeshes(td, theme, aniso = 8) {
  const group = new THREE.Group();
  const { half, runoff, length } = td;
  const roadTile = length / Math.round(length / 20);
  const kerbTile = length / Math.round(length / 6);
  const wallTile = length / Math.round(length / 8);

  // road
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(theme, aniso), roughness: 0.92, metalness: 0 });
  const road = new THREE.Mesh(ribbon(td, -half, 0.02, half, 0.02, roadTile), roadMat);
  road.receiveShadow = true;
  group.add(road);

  // kerbs (red / white)
  const kerbMat = new THREE.MeshStandardMaterial({ map: stripeTexture('#d8232a', '#f2f2f2', 64, 128, aniso), roughness: 0.7 });
  const kg = mergeGeometries([
    ribbon(td, half, 0.035, half + 1.4, 0.035, kerbTile),
    ribbon(td, -half - 1.4, 0.035, -half, 0.035, kerbTile),
  ]);
  const kerbs = new THREE.Mesh(kg, kerbMat); kerbs.receiveShadow = true; group.add(kerbs);

  // barriers
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(aniso), roughness: 0.75, side: THREE.DoubleSide });
  const H = 1.15, T = 0.55;
  const parts = [];
  for (const s of [-1, 1]) {
    const l0 = s * (half + runoff), l1 = s * (half + runoff + T);
    parts.push(ribbon(td, l0, 0, l0, H, wallTile), ribbon(td, l0, H, l1, H, wallTile), ribbon(td, l1, H, l1, 0, wallTile));
  }
  const walls = new THREE.Mesh(mergeGeometries(parts), wallMat);
  walls.castShadow = true; walls.receiveShadow = true;
  group.add(walls);

  // start / finish line + gantry at sample 0
  const heading = td.heading[0];
  const start = new THREE.Group();
  start.position.set(td.px[0], 0, td.pz[0]);
  start.rotation.y = heading;
  const checker = new THREE.Mesh(new THREE.PlaneGeometry(td.width, 3), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }));
  checker.rotation.x = -Math.PI / 2; checker.position.y = 0.045; checker.receiveShadow = true;
  start.add(checker);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.7, roughness: 0.35 });
  const gx = half + 2.2;
  for (const sx of [-gx, gx]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.5, 0.9), steel); p.position.set(sx, 4.25, 0); p.castShadow = true; start.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gx * 2 + 0.9, 2.4, 1.1), steel); beam.position.set(0, 8.2, 0); beam.castShadow = true; start.add(beam);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTexture('START / FINISH', 'VOIDFORGE RACING'), toneMapped: false });
  for (const dz of [-0.57, 0.57]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(gx * 2 + 0.9, 2.3), bannerMat);
    b.position.set(0, 8.2, dz); if (dz < 0) b.rotation.y = Math.PI; start.add(b);
  }
  group.add(start);

  return { group, dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } };
}

/** Painted grid boxes behind the start line. */
export function buildGridMarks(td, slots) {
  const g = new THREE.Group();
  const c = makeCanvas(64, 128), x = c.getContext('2d');
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 6;
  x.beginPath(); x.moveTo(4, 120); x.lineTo(4, 8); x.lineTo(60, 8); x.lineTo(60, 120); x.stroke();
  const tex = canvasTexture(c, { anisotropy: 8 });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const geo = new THREE.PlaneGeometry(2.6, 5.2);
  for (const s of slots) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, Math.PI); // lie flat, closed end of the box toward +z (the direction of travel)
    const holder = new THREE.Group(); holder.add(m);
    holder.position.set(s.x, 0.05, s.z); holder.rotation.y = s.heading;
    g.add(holder);
  }
  return g;
}
