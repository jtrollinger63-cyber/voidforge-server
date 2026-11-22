/**
 * Builds the production asset set from the cached CC0 sources:
 *   public/assets/soldier.glb      Toolbench soldier, 53 clips preserved (resampled + meshopt)
 *   public/assets/kit.glb          Hill Town modular pieces, simplified + merged into one file
 *   public/assets/weapons3p.glb    lightweight third-person weapons
 *   public/assets/manifest.json    sizes / tri counts / licences (also rendered into docs/ASSETS.md)
 *
 * Verifies after writing that the soldier still has every original clip, joint and socket.
 * Usage: npx tsx tools/build-assets.ts
 */
import { Document, NodeIO, getBounds, type Transform, type Scene } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld, simplify, meshopt, quantize, unpartition, mergeDocuments } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { KIT_PIECES, WEAPON3P_PIECES, type PieceSpec } from './asset-config.ts';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

const OUT = 'public/assets';
mkdirSync(OUT, { recursive: true });

function triCount(doc: Document): number {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
    t += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
  }
  return Math.round(t);
}

const manifest: any = { generated: new Date().toISOString(), assets: [] as any[] };

/** Merge several piece GLBs into a single document with one named node per piece. */
async function mergePieces(pieces: PieceSpec[], label: string) {
  const out = new Document();
  out.createBuffer();
  const scene = out.createScene(label);
  const entries: any[] = [];
  for (const p of pieces) {
    const file = `assets/cache/pieces/${p.id}.glb`;
    if (!existsSync(file)) throw new Error(`missing ${file}; run: npx tsx tools/fetch-assets.ts`);
    const d = await io.read(file);
    d.getRoot().listAnimations().forEach((a) => a.dispose()); // static pieces only (doors/shutters are not animated in-game)
    const trisBefore = triCount(d);
    const fx: Transform[] = [weld()];
    if (p.tris && trisBefore > p.tris) {
      fx.push(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, p.tris / trisBefore), error: p.err ?? 0.02 }));
    }
    await d.transform(...fx);
    const trisAfter = triCount(d);
    const srcScene = d.getRoot().listScenes()[0]!;
    const b = getBounds(srcScene);
    const map = mergeDocuments(out, d);
    const newScene = map.get(srcScene) as Scene;
    const holder = out.createNode(p.name);
    for (const c of newScene.listChildren()) holder.addChild(c);
    newScene.dispose();
    scene.addChild(holder);
    entries.push({
      name: p.name, id: p.id, url: `https://cdn.3dassets.dev/assets/${p.id}/v1/model.glb`,
      originalBytes: statSync(file).size, trisBefore, trisAfter,
      bounds: { min: b.min.map((n) => +n.toFixed(3)), max: b.max.map((n) => +n.toFixed(3)) },
    });
  }
  await out.transform(unpartition(), dedup(), prune({ keepLeaves: true }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return { out, entries };
}

async function buildGroup(pieces: PieceSpec[], label: string, file: string, notes: string) {
  const { out, entries } = await mergePieces(pieces, label);
  await io.write(`${OUT}/${file}`, out);
  const bytes = statSync(`${OUT}/${file}`).size;
  const origBytes = entries.reduce((s, e) => s + e.originalBytes, 0);
  const trisBefore = entries.reduce((s, e) => s + e.trisBefore, 0);
  const trisAfter = entries.reduce((s, e) => s + e.trisAfter, 0);
  console.log(`${file}: ${entries.length} pieces, ${trisBefore} -> ${trisAfter} tris, ${(origBytes / 1024).toFixed(0)} KB -> ${(bytes / 1024).toFixed(0)} KB`);
  manifest.assets.push({
    file, license: 'CC0-1.0', source: 'https://3dassets.dev/packs/tactical-shooter-hill-town',
    originalBytes: origBytes, optimizedBytes: bytes, trisBefore, trisAfter, notes, pieces: entries,
  });
}

// ---- Soldier --------------------------------------------------------------------------------
async function buildSoldier() {
  const src = 'assets/cache/toolbench/figure.glb';
  const before = await io.read(src);
  const clipNames = before.getRoot().listAnimations().map((a) => a.getName());
  const jointNames = before.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName());
  await before.transform(
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune({ keepLeaves: true }),          // keepLeaves: the Socket_* empties MUST survive
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(`${OUT}/soldier.glb`, before);
  const bytes = statSync(`${OUT}/soldier.glb`).size;

  // Verification: re-read from disk and compare with the original rig
  const after = await io.read(`${OUT}/soldier.glb`);
  const aClips = after.getRoot().listAnimations().map((a) => a.getName());
  const aJoints = after.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName());
  const sockets = after.getRoot().listNodes().map((n) => n.getName()).filter((n) => n.startsWith('Socket_'));
  const ok = aClips.length === 53 && clipNames.every((c) => aClips.includes(c)) && aJoints.length === 22 && jointNames.every((j) => aJoints.includes(j)) && sockets.length === 4;
  console.log(`soldier.glb: ${(statSync(src).size / 1024).toFixed(0)} KB -> ${(bytes / 1024).toFixed(0)} KB; clips ${aClips.length}/53, joints ${aJoints.length}/22, sockets ${sockets.join(',')}  => ${ok ? 'RIG VERIFIED' : 'RIG MISMATCH'}`);
  if (!ok) { console.error('FATAL: soldier rig changed during optimization'); process.exit(2); }
  manifest.assets.push({
    file: 'soldier.glb', license: 'CC0-1.0', source: 'https://toolbenchdev.com/gamedev/cc0-game-assets/low-poly-squad-kit/',
    originalBytes: statSync(src).size, optimizedBytes: bytes, trisBefore: 3368, trisAfter: triCount(after),
    notes: 'Toolbench Low-poly Squad Kit figure. 22 bones, 4 sockets, 53 clips preserved; animation tracks resampled (tol 1e-4) and meshopt-compressed.',
    clips: aClips, joints: aJoints, sockets,
  });
}

await buildSoldier();
await buildGroup(KIT_PIECES, 'hilltown-kit', 'kit.glb', 'Modular Hill Town pieces, simplified per tools/asset-config.ts, animations removed, merged into one file.');
await buildGroup(WEAPON3P_PIECES, 'weapons3p', 'weapons3p.glb', 'Third-person world weapons (Hill Town pack). Built-in open/close clips removed; they are not reload animations.');
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
// bounds table used by the (pure, DOM-free) map generator to size prop colliders from the real pieces
const bounds: Record<string, { min: number[]; max: number[] }> = {};
for (const a of manifest.assets) for (const p of a.pieces ?? []) bounds[p.name] = p.bounds;
mkdirSync('src/map', { recursive: true });
writeFileSync('src/map/piece-bounds.json', JSON.stringify(bounds, null, 1));
const total = manifest.assets.reduce((s: number, a: any) => s + a.optimizedBytes, 0);
console.log(`total optimized model bytes: ${(total / 1024).toFixed(0)} KB`);
