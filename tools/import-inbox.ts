/**
 * Imports the licensed CuiGames viewmodel ZIPs that a human must download (see assets/inbox/README.md).
 *
 *   npm run assets:import [-- --target-tris 14000]
 *
 * For every *.zip in assets/inbox/ it:
 *   1. extracts into its OWN directory under assets/cache/cuigames/<zip>/ (zip-slip safe; contents are treated as untrusted data),
 *   2. reads LICENSE.txt / README.txt and prints them (you must read the licence before shipping),
 *   3. inspects every GLB: real triangle count, textures, and the REAL animation clip names (nothing is assumed),
 *   4. writes an optimised copy to public/assets/private/<name>.glb  (git-ignored: the licence forbids redistributing the files)
 *      and a clip report to assets/cache/cuigames/<zip>.report.json.
 *
 * STATUS: this tool inspects and optimises. Wiring a GLB into the first-person viewmodel (grip alignment, scale, clip mapping) is NOT
 * done, because it can only be verified against the real files. The provisional viewmodel (src/weapons/viewmodel.ts) stays in use.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const targetTris = Number(process.argv[process.argv.indexOf('--target-tris') + 1] || 14000);
const inbox = 'assets/inbox';
const zips = existsSync(inbox) ? readdirSync(inbox).filter((f) => f.toLowerCase().endsWith('.zip')) : [];
if (!zips.length) {
  console.log('No ZIPs found in assets/inbox/. Nothing to import.\nSee assets/inbox/README.md for the exact downloads (A5_Base.zip, P50_Heavy_Pistol_Free.zip).');
  process.exit(0);
}
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function walk(dir: string, out: string[] = []): string[] { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; }

for (const z of zips) {
  const name = basename(z, '.zip'); const dest = `assets/cache/cuigames/${name}`;
  mkdirSync(dest, { recursive: true });
  // python -I (isolated) with explicit zip-slip protection
  execFileSync('python3', ['-I', '-c', `
import sys, zipfile, os
zf = zipfile.ZipFile(sys.argv[1]); dest = os.path.realpath(sys.argv[2])
for m in zf.infolist():
    t = os.path.realpath(os.path.join(dest, m.filename))
    if not (t == dest or t.startswith(dest + os.sep)): raise SystemExit('refusing path outside destination: ' + m.filename)
zf.extractall(dest)
`, join(inbox, z), dest], { stdio: 'inherit' });
  const files = walk(dest);
  console.log(`\n=== ${z}: ${files.length} files extracted to ${dest}`);
  for (const f of files.filter((x) => /(licen[cs]e|readme)[^/]*\.txt$/i.test(x))) { console.log(`--- ${f}\n${readFileSync(f, 'utf8').slice(0, 1800)}\n---`); }

  const report: any = { zip: z, glbs: [] };
  for (const f of files.filter((x) => x.toLowerCase().endsWith('.glb'))) {
    const doc = await io.read(f);
    const root = doc.getRoot();
    let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
    const clips = root.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length }));
    const textures = root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), bytes: t.getImage()?.byteLength ?? 0, size: t.getSize() }));
    const skins = root.listSkins().length;
    console.log(`\n${basename(f)}: ${statSync(f).size} bytes, ${Math.round(tris)} tris, ${skins} skin(s), ${textures.length} texture(s), ${clips.length} clips:\n  ${clips.map((c) => c.name).join(', ')}`);
    for (const t of textures) console.log(`  texture ${t.name} ${t.mime} ${t.size?.join('x')} ${(t.bytes / 1024).toFixed(0)} KB`);

    // optimise a copy (geometry simplification keeps every animation track; skinned meshes are left alone)
    const opt = await io.read(f);
    if (opt.getRoot().listSkins().length === 0 && tris > targetTris) {
      await opt.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.03, targetTris / tris), error: 0.01, lockBorder: true }));
    }
    await opt.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    mkdirSync('public/assets/private', { recursive: true });
    const out = `public/assets/private/${basename(f)}`;
    await io.write(out, opt);
    let tris2 = 0; for (const m of opt.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris2 += (p.getIndices()?.getCount() ?? 0) / 3;
    console.log(`  -> ${out}: ${statSync(out).size} bytes, ${Math.round(tris2)} tris, ${opt.getRoot().listAnimations().length}/${clips.length} clips kept`);
    if (skins) console.log('  note: skinned mesh: geometry was NOT simplified (would damage weights); textures were NOT resized (no image library installed).');
    report.glbs.push({ file: f, bytes: statSync(f).size, tris: Math.round(tris), skins, clips, textures, optimised: { out, bytes: statSync(out).size, tris: Math.round(tris2) } });
  }
  writeFileSync(`assets/cache/cuigames/${name}.report.json`, JSON.stringify(report, null, 1));
}
console.log('\nDone. Next: read each LICENSE.txt above (no redistribution of the standalone files), then wire the clips into a viewmodel profile.');
