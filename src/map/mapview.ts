/**
 * Builds the renderable Hill Town map from MapDef placements.
 * Every placement of a kit piece is baked into world space and merged per (16 m chunk x material),
 * so ~900 placements become a few dozen frustum-cullable draw calls (see docs/PERFORMANCE.md).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLB, floatGeometry } from '../assets/loader.ts';
import type { MapDef } from './hillfront.ts';
import { makeCobbleTextures } from './proctex.ts';

export const CHUNK = 16;

export interface MapView {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  stats: { drawCalls: number; triangles: number; placements: number; materials: number; buildMs: number };
  setShadows(on: boolean): void;
  debugColliders(map: MapDef): THREE.Group;
}

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; }

export async function buildMapView(map: MapDef): Promise<MapView> {
  const t0 = performance.now();
  const gltf = await loadGLB('kit.glb');
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // 1. per-piece parts, expressed in the piece's own space
  const pieces = new Map<string, Part[]>();
  for (const holder of root.children) {
    const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    const parts: Part[] = [];
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = floatGeometry(m.geometry);
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(rel);
      if (rel.determinant() < 0) flipWinding(g); // mirrored node (negative scale): keep faces front-facing after baking
      parts.push({ geo: g, mat: m.material as THREE.Material });
    });
    pieces.set(holder.name, parts);
  }

  // material tuning: cheap, consistent look
  const mats = new Set<THREE.Material>();
  for (const parts of pieces.values()) for (const p of parts) mats.add(p.mat);
  for (const m of mats) {
    const s = m as THREE.MeshStandardMaterial;
    if (s.map) { s.map.anisotropy = 2; s.map.colorSpace = THREE.SRGBColorSpace; }
    s.envMapIntensity = s.metalness > 0.5 ? 0.9 : 0.55;
    if (s.metalness > 0.5) s.roughness = Math.max(s.roughness, 0.45);
  }

  // 2. bake placements into buckets
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cx: number; cz: number }>();
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let missing = 0;
  const cobble = makeCobbleTextures(512, 4);
  const groundMat = new THREE.MeshStandardMaterial({ map: cobble.map, normalMap: cobble.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, metalness: 0, envMapIntensity: 0.5 });
  mats.add(groundMat);
  for (const pl of map.placements) {
    if (pl.piece === 'ground-cell') {
      // flat quad, UVs in world metres / 4 so the cobbles are seamless across cells
      const x0 = pl.x - 2, x1 = pl.x + 2, z0 = pl.z - 2, z1 = pl.z + 2, y = pl.y;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / 4, z0 / 4, x1 / 4, z0 / 4, x1 / 4, z1 / 4, x0 / 4, z1 / 4], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const cx = Math.floor(pl.x / CHUNK), cz = Math.floor(pl.z / CHUNK);
      const key = `${cx},${cz},ground`;
      let b = buckets.get(key); if (!b) { b = { mat: groundMat, geos: [], cx, cz }; buckets.set(key, b); }
      b.geos.push(g);
      continue;
    }
    const parts = pieces.get(pl.piece);
    if (!parts) { missing++; continue; }
    const k = pl.scale ?? 1;
    M.compose(P.set(pl.x, pl.y, pl.z), Q.setFromAxisAngle(UP, THREE.MathUtils.degToRad(pl.yaw)), S.set(k, k, k));
    const cx = Math.floor(pl.x / CHUNK), cz = Math.floor(pl.z / CHUNK);
    for (const part of parts) {
      const key = `${cx},${cz},${part.mat.uuid}`;
      let b = buckets.get(key);
      if (!b) { b = { mat: part.mat, geos: [], cx, cz }; buckets.set(key, b); }
      const g = part.geo.clone();
      g.applyMatrix4(M);
      b.geos.push(g);
    }
  }
  if (missing) console.warn(`[mapview] ${missing} placements reference pieces missing from kit.glb`);

  // 3. merge buckets -> meshes
  const group = new THREE.Group(); group.name = 'hillfront-map';
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.userData.chunk = [b.cx, b.cz];
    group.add(mesh); meshes.push(mesh);
    triangles += (merged.index ? merged.index.count : merged.attributes.position!.count) / 3;
  }
  for (const parts of pieces.values()) for (const p of parts) p.geo.dispose();

  return {
    group, meshes,
    stats: { drawCalls: meshes.length, triangles, placements: map.placements.length, materials: mats.size, buildMs: performance.now() - t0 },
    setShadows(on: boolean) { for (const m of meshes) { m.castShadow = on; } },
    debugColliders(def: MapDef) { return buildDebugColliders(def); },
  };
}

/** reverse triangle winding in place (needed after baking a mirrored transform) */
function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index;
  if (!idx) return;
  const a = idx.array as Uint32Array | Uint16Array;
  for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]!; a[i + 1] = a[i + 2]!; a[i + 2] = t; }
  idx.needsUpdate = true;
}

export function buildDebugColliders(map: MapDef): THREE.Group {
  const g = new THREE.Group(); g.name = 'debug-colliders';
  const colorFor = (tag?: string) => !tag ? 0xff00ff : tag.startsWith('arch') || tag.startsWith('hall') ? 0x00e5ff : tag === 'block' || tag === 'block-core' ? 0xff5a36 : tag === 'terrace' ? 0xffd23f : tag === 'parapet' ? 0xb6ff3f : tag === 'tunnel-ceiling' ? 0x8e7cff : 0x39ff88;
  const byColor = new Map<number, number[]>();
  for (const b of map.world.boxes) {
    const c = colorFor(b.tag);
    const arr = byColor.get(c) ?? []; byColor.set(c, arr);
    const x0 = b.minX, x1 = b.maxX, y0 = b.minY, y1 = b.maxY, z0 = b.minZ, z1 = b.maxZ;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, c2] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const) arr.push(...v[a]!, ...v[c2]!);
  }
  for (const [c, arr] of byColor) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.85 })));
  }
  for (const r of map.world.ramps) {
    const hi = (x: number, z: number) => {
      const t = r.dir === 0 ? (x - r.x0) / (r.x1 - r.x0) : r.dir === 1 ? (r.x1 - x) / (r.x1 - r.x0) : r.dir === 2 ? (z - r.z0) / (r.z1 - r.z0) : (r.z1 - z) / (r.z1 - r.z0);
      return r.y0 + (r.y1 - r.y0) * t;
    };
    const pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x0, r.z0]];
    const arr: number[] = [];
    for (let i = 0; i < 4; i++) arr.push(pts[i]![0]!, hi(pts[i]![0]!, pts[i]![1]!), pts[i]![1]!, pts[i + 1]![0]!, hi(pts[i + 1]![0]!, pts[i + 1]![1]!), pts[i + 1]![1]!);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })));
  }
  return g;
}
