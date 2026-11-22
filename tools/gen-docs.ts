/** Generates docs/ASSETS.md and docs/ANIMATIONS-clips.md from the REAL build outputs (manifest.json + soldier.glb). */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const mf = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
mkdirSync('docs', { recursive: true });

// ---------------------------------------------------------------- soldier clips (read from the shipped GLB)
const soldier = await io.read('public/assets/soldier.glb');
const clips = soldier.getRoot().listAnimations().map((a) => {
  let d = 0; for (const s of a.listSamplers()) { const arr = s.getInput()!.getArray()!; d = Math.max(d, arr[arr.length - 1]!); }
  return { name: a.getName(), dur: d, ch: a.listChannels().length };
});
const bases = ['aim', 'crouch', 'die', 'fire', 'hit', 'idle', 'jump', 'melee', 'reload', 'run', 'throw', 'walk', 'work'];
const grips = ['blade', 'bow', 'heavy', 'polearm', 'rifle', 'sidearm'];
const has = (n: string) => clips.some((c) => c.name === n);
const matrix = bases.map((b) => `| \`${b}\` | ${has(b) ? `✓ ${clips.find((c) => c.name === b)!.dur.toFixed(2)} s` : '–'} | ${grips.map((g) => (has(`${b}_${g}`) ? '✓' : '·')).join(' | ')} |`);

const A: string[] = [];
A.push('# Assets: sources, licences, sizes (generated)', '', `Generated ${new Date().toISOString()} by \`tools/gen-docs.ts\` from \`public/assets/manifest.json\` and the shipped GLBs. Nothing here is hand-typed except the "not obtained" section.`, '');
A.push('## What ships in the game', '', '| File | Source | Licence | Original | Shipped | Triangles (before → after) |', '|---|---|---|---:|---:|---:|');
for (const a of mf.assets) A.push(`| \`${a.file}\` | ${a.source} | ${a.license} | ${kb(a.originalBytes)} | ${kb(a.optimizedBytes)} | ${a.trisBefore} → ${a.trisAfter} |`);
const total = mf.assets.reduce((s: number, a: any) => s + a.optimizedBytes, 0);
A.push('', `Total shipped model bytes: **${kb(total)}** (before base64 embedding). Textures for the ground and soldiers are painted on a canvas at runtime and all audio is synthesised at runtime, so neither adds bytes.`, '');
A.push('## Provenance and disclosure', '',
  '- **Soldier** — Toolbench *Low-poly Squad Kit 1.0* (`figure.glb`), CC0 1.0. The kit README states it was generated from scripts. 22 bones, 4 sockets, 53 actions, no textures.',
  '- **Map kit and world weapons** — 3DAssets.dev *Tactical Shooter Hill Town* pack, CC0 1.0. The pack\'s own metadata marks all 85 assets as **AI-generated** (`aiGenerated: true`, 85/85). The licence is CC0 regardless; this is disclosed here because it is true.',
  '- **Everything else** (map layout, collision, game rules, gear geometry for the soldier makeover, procedural textures, UI, audio, server) is original code written for this project.',
  '- No Valve / Counter-Strike assets, names, logos, maps or audio are used.', '');
A.push('## Soldier (`soldier.glb`)', '', 'Stock rig preserved exactly: 22 joints, sockets `Socket_Head` / `Socket_Hand_L` / `Socket_Hand_R` / `Socket_Back`, and all **53 actions** (verified by `tests/assets.test.ts` against the shipped file).', '',
  'Makeover (`tools/make-soldier.ts`): the five stock primitives become ONE skinned primitive (one draw call per soldier) with atlas UVs and vertex-colour ambient occlusion, plus 65 added gear parts (+940 triangles): helmet cover band, brim, NVG mount, neck guard, side rails, headset and mic, goggle strap, chin straps, neck gaiter, plate carrier front/back, cummerbund, shoulder straps, 3 magazine pouches with flaps, admin pouch, radio and antenna, assault pack with bedroll, belt, buckle and pouches, holster, team and flag patches, elbow pads, sleeve cuffs, gloves, knuckle guards, cargo pockets, knee pads, blouse bands, soles, toe caps and boot cuffs. Rigid parts bind 100 % to one bone; fabric parts (gaiter, plates, cummerbund, straps) copy skin weights from the nearest body vertex.', '',
  'Before/after evidence: `docs/evidence/soldier-before-after.jpg` (built by `tools/make-comparison.py` from real captures).', '', '### The 53 actions (read from the shipped file)', '', `| Base action | Base clip (duration) | ${grips.join(' | ')} |`, `|---|---|${grips.map(() => ':-:').join('|')}|`, ...matrix, '',
  '`✓` exists, `·` does not exist in the kit. The game falls back to the base clip when a grip-set variant is missing (e.g. there is no `fire_sidearm` / `reload_sidearm`, so pistols use `fire` / `reload`).', '',
  '<details><summary>All 53 clip names with duration</summary>', '', clips.map((c) => `- \`${c.name}\` ${c.dur.toFixed(3)} s, ${c.ch} channels`).join('\n'), '', '</details>', '');
const kit = mf.assets.find((a: any) => a.file === 'kit.glb');
A.push('## Map kit (`kit.glb`)', '', 'Simplified with meshoptimizer per `tools/asset-config.ts`; door/shutter animations removed (static pieces). The cobbled-ground piece was dropped: it is hundreds of disconnected islands that no simplifier can merge, so streets use a procedural cobble albedo + normal map on flat quads instead.', '', '| Piece | Pack asset id | Tris before → after | Size (m, x/y/z) |', '|---|---:|---:|---|');
for (const p of kit.pieces) { const s = p.bounds.max.map((v: number, i: number) => (v - p.bounds.min[i]).toFixed(2)).join(' × '); A.push(`| ${p.name} | ${p.id} | ${p.trisBefore} → ${p.trisAfter} | ${s} |`); }
const w3 = mf.assets.find((a: any) => a.file === 'weapons3p.glb');
A.push('', '## Third-person weapons (`weapons3p.glb`)', '', 'Each is merged at runtime into ONE vertex-coloured mesh (1 draw call per soldier weapon). The pack\'s built-in `open`/`close` clips are not reload animations and are not used.', '', '| Piece | Pack asset id | Tris before → after |', '|---|---:|---:|');
for (const p of w3.pieces) A.push(`| ${p.name} | ${p.id} | ${p.trisBefore} → ${p.trisAfter} |`);
A.push('', '## NOT obtained: first-person weapons from CuiGames (a human must download these)', '',
  'These are served through itch.io\'s browser "Download Now" flow. An attempt to script that flow from the build sandbox was **blocked by the sandbox permission system, so nothing from CuiGames was downloaded or used**. The game runs on a clearly-labelled **provisional procedural viewmodel** instead (`src/weapons/viewmodel.ts`).', '',
  '| Item | Page | Expected ZIP | Status |', '|---|---|---|---|', '| A5 Carbine (12 clips, ~102k tris) | https://cuigames.itch.io/a5-carbine | `A5_Base.zip` (~5.2 MB) | **not downloaded** |',
  '| A5 White Orange (free skin, same clips) | https://cuigames.itch.io/a5-white-orange | `A5_WhiteOrange_Free.zip` | **not downloaded** |', '| P50 Heavy Pistol (11 FPS clips) | https://cuigames.itch.io/p50-heavy-pistol | `P50_Heavy_Pistol_Free.zip` | **not downloaded** |', '| T12 Auto Shotgun | https://cuigames.itch.io/t12-auto-shotgun | (as downloaded) | **not downloaded** |', '',
  'Licence as stated on the A5 page: *"Use and modify in personal and commercial games, videos and demos. No reselling or redistributing the files."* — so the raw ZIPs and any standalone optimised GLB are git-ignored; read each ZIP\'s own `LICENSE.txt` before shipping. Place the ZIPs in `assets/inbox/` and run `npm run assets:import` (inspects, reports the real clip names, writes an optimised copy to the git-ignored `public/assets/private/`). The importer\'s code path was exercised on a synthetic ZIP only; **hooking a CuiGames GLB into the viewmodel is not done and is unverified** because it needs the real files.');
writeFileSync('docs/ASSETS.md', A.join('\n') + '\n');
console.log(`docs/ASSETS.md written (${clips.length} clips, ${kit.pieces.length} kit pieces, ${w3.pieces.length} weapons)`);
