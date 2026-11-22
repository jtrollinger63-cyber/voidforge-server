# Performance

## What was and was not measured
This build environment has **no GPU** (software WebGL on 4 CPU cores). Therefore:
- **Measured (reliable):** work submitted per frame — draw calls, triangles; texture and shadow-map memory; JS heap; bundle size. These are what a GPU/driver has to chew through.
- **Not measured:** real frame rate or frame time on a Chromebook or any GPU. The goals (30 fps on weak devices, 60 fps on capable ones) are **targets, not results**. The "software fps" column below exists only to show that the presets differ and **must not be read as device performance**.

Reproduce: `npm run dev` in one terminal, then `node tools/perf.cjs` (writes `release/perf.json`).

## Measured per-frame work (full 5v5 match, 1366×768)

| Preset | Shadows | Render scale | Draw calls (3 views) | Triangles k (3 views) | Texture MB | Shadow map MB | JS heap MB |
|---|---|---:|---:|---:|---:|---:|---:|
| Low | off + blob shadows | 0.70 | 111 – 154 | 145 – 215 | 8 | 0 | 32 – 36 |
| Medium | **static map shadow (rendered once)** + blob shadows | 0.85 | 114 – 157 | 145 – 215 | 8 | 16 | 31 – 32 |
| High | dynamic, follows player, AA | 1.00 | 243 – 287 | 364 – 437 | 8 | 16 | 39 – 44 |

Views: spawn courtyard, mid plaza, site A. The earlier all-dynamic-shadow configuration cost ~290 calls / 380–430k triangles on *every* preset, so Low and Medium now submit roughly **half** the work.

## What was done about it, in order of effect
1. **Static shadows** (Medium): the map never moves, so its shadow map is rendered once; characters get a soft blob shadow. Removes the entire per-frame shadow pass. (Low: no shadow pass at all.)
2. **Chunked static merge** (`src/map/mapview.ts`): 864 placed pieces → ~133 meshes (16 m chunks × 11 materials), frustum-culled per chunk. Without this the raw starter scene cost 778 draw calls.
3. **Triangle diet** (`tools/asset-config.ts`): map kit 45k → 19k triangles per set; whole map 601k → **182k** triangles. Biggest single win: the cobbled-ground piece (236k triangles of disconnected cobble islands that no simplifier can merge) was replaced by flat quads with a **procedural albedo + normal map** generated at load (0 bytes shipped).
4. **One draw call per soldier** (one skinned primitive + shared team atlas) and **one draw call per world weapon** (baked vertex colours).
5. **Zero-allocation effects:** pooled tracers (28), one shader-driven particle system (≤160), ring-buffer bullet decals (56); HUD only writes changed DOM values; minimap at 10 Hz.
6. **Dynamic resolution** (on by default): below ~24 ms frames the render scale drops in 7 % steps to 55 %, and recovers when frames are fast; plus manual Low/Medium/High and a resolution-scale slider. Pixel ratio is capped at 1 (1.5 on High).
7. **Animation LOD:** off-screen soldiers beyond 8 m skip mixer updates.
8. Quantised + meshopt-compressed models; animation tracks resampled (soldier 1.8 MB → 0.68 MB with the gear added).

## Memory
Decoded textures ≈ 8 MB (two 512² soldier atlases, cobble albedo + normal 512², two 512² map textures) + 16 MB for the static shadow map (2048², Medium/High). Models total 1.2 MB shipped (1.6 MB as base64 inside the HTML). Release HTML: **2.40 MB** (`docs/SIZE_REPORT.md`).

## Ideas not done (would help weak GPUs further)
Switch Low to `MeshLambertMaterial` (cheaper fragments, no environment light); a lightmap bake instead of runtime shading; instancing for repeated props; sorting bots out of the frame budget with a worker; WebGL context loss handling; texture compression (KTX2).
