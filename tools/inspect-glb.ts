/**
 * Dump the real structure of a GLB: nodes, skins/joints, animations, materials, textures, triangles.
 * Usage: npx tsx tools/inspect-glb.ts <file.glb> [--json out.json] [--nodes]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { writeFileSync, statSync } from 'node:fs';

export async function inspect(path: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  const root = doc.getRoot();

  let tris = 0, verts = 0;
  const meshes = root.listMeshes().map((m) => {
    let mt = 0, mv = 0;
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      mv += pos ? pos.getCount() : 0;
      mt += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
    return { name: m.getName(), prims: m.listPrimitives().length, tris: mt, verts: mv };
  });
  for (const m of meshes) { tris += m.tris; verts += m.verts; }

  const skins = root.listSkins().map((s) => ({
    name: s.getName(),
    joints: s.listJoints().map((j) => j.getName()),
  }));

  const anims = root.listAnimations().map((a) => {
    let dur = 0;
    for (const s of a.listSamplers()) {
      const inp = s.getInput();
      if (inp) { const arr = inp.getArray(); if (arr && arr.length) dur = Math.max(dur, arr[arr.length - 1]); }
    }
    return { name: a.getName(), channels: a.listChannels().length, duration: +dur.toFixed(3) };
  });

  const materials = root.listMaterials().map((m) => ({
    name: m.getName(),
    baseColor: m.getBaseColorFactor().map((v) => +v.toFixed(3)),
    metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(),
    baseTex: m.getBaseColorTexture()?.getName() ?? null,
  }));

  const textures = root.listTextures().map((t) => ({
    name: t.getName(), mime: t.getMimeType(), bytes: t.getImage()?.byteLength ?? 0, size: t.getSize(),
  }));

  const nodes = root.listNodes().map((n) => ({
    name: n.getName(),
    parent: n.getParentNode()?.getName() ?? null,
    t: n.getTranslation().map((v) => +v.toFixed(4)),
    r: n.getRotation().map((v) => +v.toFixed(4)),
    s: n.getScale().map((v) => +v.toFixed(4)),
    mesh: n.getMesh()?.getName() ?? null,
    skin: !!n.getSkin(),
  }));

  return {
    file: path,
    bytes: statSync(path).size,
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName),
    scenes: root.listScenes().length,
    nodeCount: nodes.length,
    meshes, tris, verts, skins, anims, materials, textures, nodes,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jIdx0 = args.indexOf('--json');
  const file = args.find((a, i) => !a.startsWith('--') && !(jIdx0 >= 0 && i === jIdx0 + 1));
  if (!file) { console.error('usage: inspect-glb <file.glb> [--json out] [--nodes]'); process.exit(1); }
  const info = await inspect(file);
  const jIdx = args.indexOf('--json');
  if (jIdx >= 0) writeFileSync(args[jIdx + 1], JSON.stringify(info, null, 2));
  console.log(`file: ${info.file}  (${info.bytes} bytes)  ext: ${info.extensionsUsed.join(',') || 'none'}`);
  console.log(`nodes=${info.nodeCount} meshes=${info.meshes.length} tris=${info.tris} verts=${info.verts} skins=${info.skins.length} anims=${info.anims.length}`);
  for (const s of info.skins) console.log(`skin "${s.name}": ${s.joints.length} joints: ${s.joints.join(', ')}`);
  console.log('materials:'); for (const m of info.materials) console.log(' ', JSON.stringify(m));
  console.log('textures:'); for (const t of info.textures) console.log(' ', JSON.stringify(t));
  console.log('meshes:'); for (const m of info.meshes) console.log(' ', JSON.stringify(m));
  console.log(`animations (${info.anims.length}):`); for (const a of info.anims) console.log(`  ${a.name}  ch=${a.channels} dur=${a.duration}s`);
  if (args.includes('--nodes')) { console.log('nodes:'); for (const n of info.nodes) console.log(' ', JSON.stringify(n)); }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
