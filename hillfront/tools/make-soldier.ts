/**
 * Soldier makeover (build time).
 *
 * Takes the stock Toolbench figure (5 flat-colour primitives, 22 bones) and rebuilds its mesh as ONE skinned primitive:
 *   - original body geometry + skin weights are preserved byte-for-byte in position/weights,
 *   - UVs are remapped into a shared 512x512 atlas (generated at runtime, so it costs zero download bytes),
 *   - ~50 small gear pieces are added and bound to the existing skeleton:
 *       rigid  -> 100 % to one bone (helmet kit, pouches, pads, boots, gloves)
 *       fabric -> weights copied from the nearest body vertex (neck gaiter, vest plates, cummerbund) so they deform with the torso
 *   - vertex colour carries baked ambient occlusion (down-facing / enclosed = darker).
 * Skeleton, sockets and all 53 animation clips are untouched.
 */
import type { Document, Primitive } from '@gltf-transform/core';

import { CELLS, type Kind } from '../src/character/atlas-layout.ts';
export type { Kind };

interface Vtx { p: [number, number, number]; n: [number, number, number]; kind: Kind; j: [number, number, number, number]; w: [number, number, number, number]; }

const V = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

function rot(v: [number, number, number], r: [number, number, number]): [number, number, number] {
  let [x, y, z] = v;
  const [rx, ry, rz] = r;
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  return [x, y, z];
}

interface Part { verts: { p: [number, number, number]; n: [number, number, number] }[]; idx: number[]; kind: Kind; bind: { bone: string } | { skin: true }; }

/** flat-shaded box */
function box(c: [number, number, number], s: [number, number, number], kind: Kind, bind: Part['bind'], r: [number, number, number] = [0, 0, 0], taperTop = 1): Part {
  const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
  const faces: { n: [number, number, number]; q: [number, number, number][] }[] = [
    { n: [0, 0, 1], q: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], q: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], q: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], q: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], q: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], q: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const verts: Part['verts'] = []; const idx: number[] = [];
  for (const f of faces) {
    const b = verts.length;
    for (const q of f.q) {
      const t = q[1] > 0 ? taperTop : 1;
      const lp = rot([q[0] * hx * t, q[1] * hy, q[2] * hz * t], r);
      verts.push({ p: V(c[0] + lp[0], c[1] + lp[1], c[2] + lp[2]), n: rot(f.n, r) });
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { verts, idx, kind, bind };
}

/** n-sided prism (axis = local Y before rotation); use rotation to lay it down */
function cyl(c: [number, number, number], radius: number, h: number, sides: number, kind: Kind, bind: Part['bind'], r: [number, number, number] = [0, 0, 0], sx = 1, sz = 1): Part {
  const verts: Part['verts'] = []; const idx: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    const n0: [number, number, number] = [Math.cos(am), 0, Math.sin(am)];
    const pts: [number, number, number][] = [
      [Math.cos(a0) * radius * sx, -h / 2, Math.sin(a0) * radius * sz], [Math.cos(a1) * radius * sx, -h / 2, Math.sin(a1) * radius * sz],
      [Math.cos(a1) * radius * sx, h / 2, Math.sin(a1) * radius * sz], [Math.cos(a0) * radius * sx, h / 2, Math.sin(a0) * radius * sz],
    ];
    const b = verts.length;
    for (const p of pts) { const lp = rot(p, r); verts.push({ p: V(c[0] + lp[0], c[1] + lp[1], c[2] + lp[2]), n: rot(n0, r) }); }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  // caps
  for (const top of [true, false]) {
    const b = verts.length; const y = top ? h / 2 : -h / 2; const n: [number, number, number] = [0, top ? 1 : -1, 0];
    const lc = rot([0, y, 0], r); verts.push({ p: V(c[0] + lc[0], c[1] + lc[1], c[2] + lc[2]), n: rot(n, r) });
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; const lp = rot([Math.cos(a) * radius * sx, y, Math.sin(a) * radius * sz], r); verts.push({ p: V(c[0] + lp[0], c[1] + lp[1], c[2] + lp[2]), n: rot(n, r) }); }
    for (let i = 0; i < sides; i++) { const a = b + 1 + i, bb = b + 1 + ((i + 1) % sides); idx.push(...(top ? [b, bb, a] : [b, a, bb])); }
  }
  return { verts, idx, kind, bind };
}

const mirrorX = (parts: Part[]): Part[] => parts.map((pt) => ({
  ...pt,
  verts: pt.verts.map((v) => ({ p: V(-v.p[0], v.p[1], v.p[2]), n: V(-v.n[0], v.n[1], v.n[2]) })),
  idx: pt.idx.length ? pt.idx.map((_, i, a) => (i % 3 === 0 ? a[i]! : i % 3 === 1 ? a[i + 1]! : a[i - 1]!)) : pt.idx, // flip winding
  bind: 'bone' in pt.bind ? { bone: pt.bind.bone.endsWith('_L') ? pt.bind.bone.replace('_L', '_R') : pt.bind.bone.endsWith('_R') ? pt.bind.bone.replace('_R', '_L') : pt.bind.bone } : pt.bind,
}));

/** every gear piece, in bind-pose model space (metres, +Y up, +Z forward, +X = character's left) */
export function gearParts(): Part[] {
  const P: Part[] = [];
  const rig = (bone: string) => ({ bone });
  const fab = { skin: true } as const;

  // ---------------- head kit ----------------
  P.push(cyl([0, 1.735, 0.01], 0.119, 0.026, 12, 'strapTan', rig('Head')));                 // helmet cover band
  P.push(cyl([0, 1.655, 0.008], 0.117, 0.03, 12, 'webbing', rig('Head'), [0, 0, 0]));       // goggle strap
  P.push(box([0, 1.757, 0.118], [0.205, 0.016, 0.06], 'helmet', rig('Head'), [-0.18, 0, 0])); // brim lip
  P.push(box([0, 1.762, 0.126], [0.05, 0.045, 0.04], 'metal', rig('Head')));                // NVG mount
  P.push(box([0, 1.648, -0.118], [0.20, 0.07, 0.04], 'helmet', rig('Head'), [0.15, 0, 0])); // rear neck guard
  P.push(...[1, -1].map((sx) => box([0.118 * sx, 1.675, 0.0], [0.03, 0.085, 0.11], 'helmet', rig('Head'))));  // side rails
  P.push(...[1, -1].map((sx) => cyl([0.128 * sx, 1.64, 0.0], 0.036, 0.03, 8, 'rubber', rig('Head'), [0, 0, Math.PI / 2]))); // headset cups
  P.push(box([0.095, 1.605, 0.088], [0.012, 0.012, 0.07], 'metal', rig('Head'), [0, 0.5, 0]));  // boom mic
  P.push(...[1, -1].map((sx) => box([0.07 * sx, 1.58, 0.045], [0.012, 0.075, 0.012], 'webbing', rig('Head')))); // chin straps
  P.push(box([0, 1.612, 0.117], [0.022, 0.03, 0.03], 'skin', rig('Head')));                 // nose
  P.push(...[1, -1].map((sx) => box([0.112 * sx, 1.64, -0.005], [0.014, 0.04, 0.03], 'skin', rig('Head')))); // ears
  P.push(cyl([0, 1.495, 0.0], 0.082, 0.075, 10, 'cloth2', fab));                             // neck gaiter / shemagh
  P.push(box([0, 1.465, 0.09], [0.17, 0.05, 0.04], 'cloth2', fab, [0.35, 0, 0]));             // gaiter drape

  // ---------------- plate carrier & torso gear ----------------
  P.push(box([0, 1.29, 0.158], [0.275, 0.285, 0.05], 'vest', fab));                           // front plate
  P.push(box([0, 1.285, -0.142], [0.275, 0.30, 0.05], 'vest', fab));                          // back plate
  P.push(box([0, 1.115, 0.0], [0.30, 0.125, 0.25], 'vest', fab));                             // cummerbund
  P.push(...[1, -1].map((sx) => box([0.068 * sx, 1.455, 0.005], [0.058, 0.032, 0.30], 'webbing', fab))); // shoulder straps
  P.push(...[-1, 0, 1].map((k) => box([0.088 * k, 1.17, 0.195], [0.07, 0.10, 0.045], 'webbing', fab)));    // mag pouches
  P.push(...[-1, 0, 1].map((k) => box([0.088 * k, 1.227, 0.198], [0.074, 0.022, 0.05], 'strapTan', fab)));  // pouch flaps
  P.push(box([0, 1.355, 0.188], [0.13, 0.055, 0.03], 'webbing', fab));                         // admin pouch
  P.push(box([0.085, 1.395, 0.19], [0.05, 0.04, 0.012], 'patchB', fab));                       // name tape
  P.push(box([0.115, 1.50, -0.01], [0.03, 0.075, 0.032], 'metal', rig('Chest')));              // radio on strap
  P.push(box([0.118, 1.60, -0.012], [0.006, 0.12, 0.006], 'metal', rig('Chest')));             // antenna
  P.push(box([0, 1.26, -0.215], [0.255, 0.28, 0.095], 'vest', rig('Chest')));                  // assault pack
  P.push(box([0, 1.26, -0.264], [0.20, 0.20, 0.012], 'webbing', rig('Chest')));                // pack lid strap field
  P.push(cyl([0, 1.425, -0.235], 0.05, 0.27, 8, 'cloth2', rig('Chest'), [0, 0, Math.PI / 2])); // bedroll
  P.push(box([0, 0.99, 0.0], [0.27, 0.05, 0.225], 'webbing', rig('Hips')));                    // belt
  P.push(box([0, 0.99, 0.116], [0.05, 0.04, 0.012], 'metal', rig('Hips')));                    // buckle
  P.push(...[1, -1].map((sx) => box([0.137 * sx, 0.985, -0.075], [0.05, 0.075, 0.075], 'webbing', rig('Hips')))); // belt pouches
  P.push(box([-0.178, 0.885, 0.0], [0.05, 0.16, 0.09], 'vest', rig('UpperLeg_R')));            // holster (right thigh)
  P.push(box([-0.178, 0.965, 0.0], [0.052, 0.02, 0.095], 'strapTan', rig('UpperLeg_R')));      // holster strap

  // ---------------- arms ----------------
  P.push(...[1, -1].map((sx) => box([0.241 * sx, 1.33, 0.0], [0.014, 0.075, 0.075], sx > 0 ? 'patchA' : 'patchB', rig(sx > 0 ? 'UpperArm_L' : 'UpperArm_R')))); // team patch / flag patch
  P.push(...[1, -1].map((sx) => box([0.2 * sx, 1.185, 0.0], [0.108, 0.075, 0.108], 'pad', rig(sx > 0 ? 'LowerArm_L' : 'LowerArm_R'))));      // elbow pads
  P.push(...[1, -1].map((sx) => box([0.196 * sx, 1.07, 0.0], [0.092, 0.03, 0.092], 'strapTan', rig(sx > 0 ? 'LowerArm_L' : 'LowerArm_R'))));   // sleeve cuffs
  P.push(...[1, -1].map((sx) => box([0.2 * sx, 0.89, 0.004], [0.07, 0.088, 0.074], 'glove', rig(sx > 0 ? 'Hand_L' : 'Hand_R'))));            // gloves
  P.push(...[1, -1].map((sx) => box([0.2 * sx, 0.915, 0.042], [0.062, 0.026, 0.01], 'pad', rig(sx > 0 ? 'Hand_L' : 'Hand_R'))));               // knuckle guards

  // ---------------- legs ----------------
  P.push(...[1, -1].map((sx) => box([0.185 * sx, 0.78, 0.0], [0.034, 0.13, 0.10], 'pants', rig(sx > 0 ? 'UpperLeg_L' : 'UpperLeg_R')))); // cargo pockets
  P.push(...[1, -1].map((sx) => box([0.19 * sx, 0.835, 0.0], [0.036, 0.024, 0.104], 'strapTan', rig(sx > 0 ? 'UpperLeg_L' : 'UpperLeg_R')))); // flaps
  P.push(...[1, -1].map((sx) => box([0.1 * sx, 0.455, 0.08], [0.108, 0.115, 0.04], 'pad', rig(sx > 0 ? 'LowerLeg_L' : 'LowerLeg_R'))));      // knee pads
  P.push(...[1, -1].map((sx) => box([0.1 * sx, 0.20, 0.0], [0.115, 0.03, 0.115], 'webbing', rig(sx > 0 ? 'LowerLeg_L' : 'LowerLeg_R'))));  // blouse bands
  P.push(...[1, -1].map((sx) => box([0.1 * sx, 0.016, 0.06], [0.108, 0.032, 0.27], 'rubber', rig(sx > 0 ? 'Foot_L' : 'Foot_R'))));        // soles
  P.push(...[1, -1].map((sx) => box([0.1 * sx, 0.066, 0.165], [0.098, 0.05, 0.07], 'boot', rig(sx > 0 ? 'Foot_L' : 'Foot_R'))));         // toe caps
  P.push(...[1, -1].map((sx) => box([0.1 * sx, 0.1, -0.005], [0.114, 0.10, 0.115], 'boot', rig(sx > 0 ? 'Foot_L' : 'Foot_R'))));          // ankle cuffs
  void mirrorX;
  return P;
}

/** dominant-bone classification of the stock vertices -> atlas kind */
export function classifyStock(prim: number, bone: string, y: number): Kind {
  if (prim === 1) return 'skin';
  if (prim === 2) return 'lens';
  // prim 4 (stock grey) is the lower trouser legs and sleeve ends, not webbing: treat it as the same camo cloth
  if (prim === 4) return /Leg|Foot/.test(bone) ? (y < 0.2 ? 'boot' : 'pants') : /Arm|Hand|Shoulder|Chest|Spine/.test(bone) ? 'jacket' : 'strapTan';
  if (prim === 3) {
    if (bone === 'Foot_L' || bone === 'Foot_R') return 'boot';
    if (/LowerLeg/.test(bone)) return y < 0.2 ? 'boot' : 'pants';
    return 'jacket';
  }
  // prim 0: TeamColour
  if (bone === 'Head') return 'helmet';
  if (/UpperLeg|Hips/.test(bone)) return 'pants';
  return 'jacket';
}

export interface BuildReport { tris: number; verts: number; gearParts: number; gearTris: number; }

/** rebuilds `doc`'s single mesh as one primitive; returns stats */
export function rebuildSoldierMesh(doc: Document): BuildReport {
  const root = doc.getRoot();
  const skin = root.listSkins()[0]!;
  const jointNames = skin.listJoints().map((j) => j.getName());
  const jointIndex = new Map(jointNames.map((n, i) => [n, i]));
  const mesh = root.listMeshes()[0]!;
  const verts: Vtx[] = []; const indices: number[] = [];

  // 1. stock geometry
  mesh.listPrimitives().forEach((pr, pi) => {
    const pos = pr.getAttribute('POSITION')!, nrm = pr.getAttribute('NORMAL')!, jt = pr.getAttribute('JOINTS_0')!, wt = pr.getAttribute('WEIGHTS_0')!;
    const base = verts.length;
    for (let v = 0; v < pos.getCount(); v++) {
      const p = pos.getElement(v, [0, 0, 0]) as [number, number, number];
      const n = nrm.getElement(v, [0, 0, 0]) as [number, number, number];
      const j = jt.getElement(v, [0, 0, 0, 0]) as [number, number, number, number];
      const w = wt.getElement(v, [0, 0, 0, 0]) as [number, number, number, number];
      let bi = 0; for (let k = 1; k < 4; k++) if (w[k]! > w[bi]!) bi = k;
      verts.push({ p, n, kind: classifyStock(pi, jointNames[j[bi]!]!, p[1]), j, w });
    }
    const idx = pr.getIndices()!;
    for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
  });
  const stockCount = verts.length;

  // 2. gear
  const parts = gearParts();
  let gearTris = 0;
  for (const part of parts) {
    const base = verts.length;
    for (const gv of part.verts) {
      let j: [number, number, number, number] = [0, 0, 0, 0], w: [number, number, number, number] = [1, 0, 0, 0];
      if ('bone' in part.bind) {
        const bi = jointIndex.get(part.bind.bone);
        if (bi === undefined) throw new Error('unknown bone ' + part.bind.bone);
        j = [bi, 0, 0, 0];
      } else {
        // nearest stock vertex -> copy influences (smooth deformation with the body)
        let best = 0, bd = Infinity;
        for (let s = 0; s < stockCount; s++) {
          const sv = verts[s]!; const d = (sv.p[0] - gv.p[0]) ** 2 + (sv.p[1] - gv.p[1]) ** 2 + (sv.p[2] - gv.p[2]) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
        j = [...verts[best]!.j] as typeof j; w = [...verts[best]!.w] as typeof w;
      }
      verts.push({ p: gv.p, n: gv.n, kind: part.kind, j, w });
    }
    for (const i of part.idx) indices.push(base + i);
    gearTris += part.idx.length / 3;
  }

  // 3. attributes: positions, normals, atlas UVs, baked AO colour, skinning
  const N = verts.length;
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const jts = new Uint8Array(N * 4), wts = new Float32Array(N * 4);
  const ATLAS = 8, INSET = 0.04;
  for (let i = 0; i < N; i++) {
    const v = verts[i]!;
    pos.set(v.p, i * 3);
    const l = Math.hypot(...v.n) || 1; nor.set([v.n[0] / l, v.n[1] / l, v.n[2] / l], i * 3);
    const [cx, cy, cw, ch] = CELLS[v.kind];
    // planar projection over the whole body so camo / weave reads as continuous cloth
    const u = Math.min(1, Math.max(0, (v.p[0] + 0.3) / 0.6 + v.p[2] * 0.5));
    const vv = Math.min(1, Math.max(0, v.p[1] / 1.85 + v.p[2] * 0.35));
    uv[i * 2] = ((cx + INSET * cw + u * cw * (1 - 2 * INSET)) / ATLAS);
    uv[i * 2 + 1] = (cy + INSET * ch + (1 - vv) * ch * (1 - 2 * INSET)) / ATLAS; // glTF convention: v grows downward
    // baked AO-ish shading: undersides and inner limbs darker, upper/outer faces lighter
    const ny = v.n[1] / l;
    let ao = 0.76 + 0.24 * (0.5 + 0.5 * ny);
    if (i >= stockCount) ao *= 0.96;                      // gear sits slightly shadowed against the body
    if (v.kind === 'skin' || v.kind === 'lens') ao = Math.min(1, ao + 0.08);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    jts.set(v.j, i * 4); wts.set(v.w, i * 4);
  }

  // 4. replace the mesh's primitives with a single merged one
  const buffer = root.listBuffers()[0]!;
  const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', arr: any) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  for (const p of mesh.listPrimitives()) { mesh.removePrimitive(p); p.dispose(); }
  for (const m of root.listMaterials()) m.dispose();
  const mat = doc.createMaterial('SoldierAtlas').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.86).setMetallicFactor(0.04);
  const prim: Primitive = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor)).setAttribute('TEXCOORD_0', acc('VEC2', uv))
    .setAttribute('COLOR_0', acc('VEC3', col)).setAttribute('JOINTS_0', acc('VEC4', jts)).setAttribute('WEIGHTS_0', acc('VEC4', wts))
    .setIndices(acc('SCALAR', N < 65535 ? new Uint16Array(indices) : new Uint32Array(indices)))
    .setMaterial(mat);
  mesh.addPrimitive(prim);
  return { tris: indices.length / 3, verts: N, gearParts: parts.length, gearTris };
}
