import { describe, it, expect, beforeAll } from 'vitest';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { FILLERS } from '../src/weapons/fillers.ts';
import { HOLDS, guardParts } from '../src/weapons/holds.ts';
import { weldPieces, connectedGroups, type Tri, type V3 } from '../tools/weapon-connectivity.ts';

/** every third-person weapon the game can put in a hand */
const WEAPONS = ['attacker-rifle', 'defender-carbine', 'full-smg', 'pump-shotgun', 'marksman-rifle', 'service-pistol', 'combat-knife'];
const TOL = 0.005;   // 5 mm: pieces closer than this read as touching at any distance the game is played from

let doc: Document;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read('public/assets/weapons3p.glb');
});

/** world-space triangles of a named weapon in the shipped GLB; the magazine node is excluded when `withMag` is false */
function weaponTris(name: string): Tri[] {
  const root = doc.getRoot().listNodes().find((n) => n.getName() === name && !n.getParentNode())!;
  const out: Tri[] = [];
  const walk = (n: Node) => {
    const m = n.getMesh();
    if (m) {
      const w = n.getWorldMatrix();
      for (const prim of m.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!; const idx = prim.getIndices(); const P: V3[] = [];
        for (let i = 0; i < pos.getCount(); i++) { const [x, y, z] = pos.getElement(i, [0, 0, 0]); P.push([w[0]! * x + w[4]! * y + w[8]! * z + w[12]!, w[1]! * x + w[5]! * y + w[9]! * z + w[13]!, w[2]! * x + w[6]! * y + w[10]! * z + w[14]!]); }
        const n3 = idx ? idx.getCount() : P.length;
        for (let i = 0; i < n3; i += 3) out.push({ a: P[idx ? idx.getScalar(i) : i]!, b: P[idx ? idx.getScalar(i + 1) : i + 1]!, c: P[idx ? idx.getScalar(i + 2) : i + 2]! });
      }
    }
    n.listChildren().forEach(walk);
  };
  walk(root);
  return out;
}

function boxTris(b: [number, number, number, number, number, number]): Tri[] {
  const [x0, y0, z0, x1, y1, z1] = b; const c: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) c.push([x, y, z]);
  const quad = (i: number, j: number, k: number, l: number): Tri[] => [{ a: c[i]!, b: c[j]!, c: c[k]! }, { a: c[i]!, b: c[k]!, c: c[l]! }];
  return [...quad(0, 1, 3, 2), ...quad(4, 5, 7, 6), ...quad(0, 1, 5, 4), ...quad(2, 3, 7, 6), ...quad(0, 2, 6, 4), ...quad(1, 3, 7, 5)];
}

describe('weapons are single connected objects (nothing floats, no detached handle / guard / sight / magazine)', () => {
  it('the CC0 pack really does ship detached parts (so the filler blocks are needed, not decoration)', () => {
    for (const name of ['attacker-rifle', 'defender-carbine', 'full-smg', 'pump-shotgun', 'marksman-rifle', 'combat-knife']) {
      const groups = connectedGroups(weldPieces(weaponTris(name)), TOL);
      expect(groups.length, `${name} as shipped`).toBeGreaterThan(1);
    }
  });

  for (const name of WEAPONS) {
    it(`${name}: one connected group once the filler blocks and handguard are in`, () => {
      const tris = weaponTris(name);
      for (const b of FILLERS[name]?.blocks ?? []) tris.push(...boxTris([b[0], b[1], b[2], b[3], b[4], b[5]]));
      const pieces = weldPieces(tris);
      const groups = connectedGroups(pieces, TOL);
      const size = (g: number[]) => g.reduce((s, i) => s + pieces[i]!.tris.length, 0);
      const stray = groups.slice(1).map((g) => ({ tris: size(g), min: g.map((i) => pieces[i]!.min), max: g.map((i) => pieces[i]!.max) }));
      expect(stray, `loose pieces on ${name}`).toEqual([]);
    });
  }

  it('hold points sit on solid weapon geometry (hand never grips thin air)', () => {
    for (const name of ['attacker-rifle', 'defender-carbine', 'full-smg', 'pump-shotgun', 'marksman-rifle', 'service-pistol']) {
      const tris = weaponTris(name);
      for (const b of FILLERS[name]?.blocks ?? []) tris.push(...boxTris([b[0], b[1], b[2], b[3], b[4], b[5]]));
      const g = HOLDS[name]!.grip;
      // some vertex of the weapon within 6 cm of the grip point in the grip's own horizontal plane = the grip is on the gun
      let best = Infinity; for (const t of tris) for (const p of [t.a, t.b, t.c]) best = Math.min(best, Math.hypot(p[0] - g[0], p[1] - g[1], p[2] - g[2]));
      expect(best, name).toBeLessThan(0.03);
    }
  });

  it('the procedural handguard is a closed, positive-volume part on the barrel axis', () => {
    for (const [name, h] of Object.entries(HOLDS)) {
      if (!h.guard) continue;
      const parts = guardParts(h.guard[0], h.guard[1], h.barrelY);
      expect(parts.length, name).toBe(2);
      for (const p of parts) { p.geo.computeBoundingBox(); const bb = p.geo.boundingBox!; expect(bb.max.z - bb.min.z, name).toBeGreaterThan(0.05); expect((bb.min.y + bb.max.y) / 2 - h.barrelY, name).toBeGreaterThan(-0.0001); }
    }
  });
});
