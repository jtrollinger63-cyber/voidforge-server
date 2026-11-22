# Assets: sources, licences, sizes (generated)

Generated 2026-11-22T17:15:11.320Z by `tools/gen-docs.ts` from `public/assets/manifest.json` and the shipped GLBs. Nothing here is hand-typed except the "not obtained" section.

## What ships in the game

| File | Source | Licence | Original | Shipped | Triangles (before → after) |
|---|---|---|---:|---:|---:|
| `soldier.glb` | https://toolbenchdev.com/gamedev/cc0-game-assets/low-poly-squad-kit/ | CC0-1.0 | 1804 KB | 676 KB | 3368 → 4308 |
| `kit.glb` | https://3dassets.dev/packs/tactical-shooter-hill-town | CC0-1.0 | 2224 KB | 385 KB | 45100 → 19252 |
| `weapons3p.glb` | https://3dassets.dev/packs/tactical-shooter-hill-town | CC0-1.0 | 625 KB | 159 KB | 26844 → 9766 |

Total shipped model bytes: **1220 KB** (before base64 embedding). Textures for the ground and soldiers are painted on a canvas at runtime and all audio is synthesised at runtime, so neither adds bytes.

## Provenance and disclosure

- **Soldier** — Toolbench *Low-poly Squad Kit 1.0* (`figure.glb`), CC0 1.0. The kit README states it was generated from scripts. 22 bones, 4 sockets, 53 actions, no textures.
- **Map kit and world weapons** — 3DAssets.dev *Tactical Shooter Hill Town* pack, CC0 1.0. The pack's own metadata marks all 85 assets as **AI-generated** (`aiGenerated: true`, 85/85). The licence is CC0 regardless; this is disclosed here because it is true.
- **Everything else** (map layout, collision, game rules, gear geometry for the soldier makeover, procedural textures, UI, audio, server) is original code written for this project.
- No Valve / Counter-Strike assets, names, logos, maps or audio are used.

## Soldier (`soldier.glb`)

Stock rig preserved exactly: 22 joints, sockets `Socket_Head` / `Socket_Hand_L` / `Socket_Hand_R` / `Socket_Back`, and all **53 actions** (verified by `tests/assets.test.ts` against the shipped file).

Makeover (`tools/make-soldier.ts`): the five stock primitives become ONE skinned primitive (one draw call per soldier) with atlas UVs and vertex-colour ambient occlusion, plus 65 added gear parts (+940 triangles): helmet cover band, brim, NVG mount, neck guard, side rails, headset and mic, goggle strap, chin straps, neck gaiter, plate carrier front/back, cummerbund, shoulder straps, 3 magazine pouches with flaps, admin pouch, radio and antenna, assault pack with bedroll, belt, buckle and pouches, holster, team and flag patches, elbow pads, sleeve cuffs, gloves, knuckle guards, cargo pockets, knee pads, blouse bands, soles, toe caps and boot cuffs. Rigid parts bind 100 % to one bone; fabric parts (gaiter, plates, cummerbund, straps) copy skin weights from the nearest body vertex.

Before/after evidence: `docs/evidence/soldier-before-after.jpg` (built by `tools/make-comparison.py` from real captures).

### The 53 actions (read from the shipped file)

| Base action | Base clip (duration) | blade | bow | heavy | polearm | rifle | sidearm |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `aim` | ✓ 1.60 s | · | ✓ | ✓ | ✓ | ✓ | · |
| `crouch` | ✓ 2.00 s | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `die` | ✓ 2.33 s | · | · | · | · | · | · |
| `fire` | ✓ 0.47 s | · | ✓ | ✓ | · | ✓ | · |
| `hit` | ✓ 0.67 s | · | · | · | · | · | · |
| `idle` | ✓ 2.40 s | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `jump` | ✓ 1.47 s | · | · | · | · | ✓ | · |
| `melee` | ✓ 1.13 s | · | · | · | ✓ | · | · |
| `reload` | ✓ 2.20 s | · | · | · | · | ✓ | · |
| `run` | ✓ 0.73 s | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `throw` | ✓ 1.40 s | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `walk` | ✓ 1.07 s | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `work` | ✓ 2.80 s | · | · | · | · | · | · |

`✓` exists, `·` does not exist in the kit. The game falls back to the base clip when a grip-set variant is missing (e.g. there is no `fire_sidearm` / `reload_sidearm`, so pistols use `fire` / `reload`).

<details><summary>All 53 clip names with duration</summary>

- `aim` 1.600 s, 66 channels
- `aim_bow` 1.600 s, 66 channels
- `aim_heavy` 1.600 s, 66 channels
- `aim_polearm` 1.600 s, 66 channels
- `aim_rifle` 1.600 s, 66 channels
- `crouch` 2.000 s, 66 channels
- `crouch_blade` 2.000 s, 66 channels
- `crouch_bow` 2.000 s, 66 channels
- `crouch_heavy` 2.000 s, 66 channels
- `crouch_polearm` 2.000 s, 66 channels
- `crouch_rifle` 2.000 s, 66 channels
- `crouch_sidearm` 2.000 s, 66 channels
- `die` 2.333 s, 66 channels
- `fire` 0.467 s, 66 channels
- `fire_bow` 0.467 s, 66 channels
- `fire_heavy` 0.467 s, 66 channels
- `fire_rifle` 0.467 s, 66 channels
- `hit` 0.667 s, 66 channels
- `idle` 2.400 s, 66 channels
- `idle_blade` 2.400 s, 66 channels
- `idle_bow` 2.400 s, 66 channels
- `idle_heavy` 2.400 s, 66 channels
- `idle_polearm` 2.400 s, 66 channels
- `idle_rifle` 2.400 s, 66 channels
- `idle_sidearm` 2.400 s, 66 channels
- `jump` 1.467 s, 66 channels
- `jump_rifle` 1.467 s, 66 channels
- `melee` 1.133 s, 66 channels
- `melee_polearm` 1.133 s, 66 channels
- `reload` 2.200 s, 66 channels
- `reload_rifle` 2.200 s, 66 channels
- `run` 0.733 s, 66 channels
- `run_blade` 0.733 s, 66 channels
- `run_bow` 0.733 s, 66 channels
- `run_heavy` 0.733 s, 66 channels
- `run_polearm` 0.733 s, 66 channels
- `run_rifle` 0.733 s, 66 channels
- `run_sidearm` 0.733 s, 66 channels
- `throw` 1.400 s, 66 channels
- `throw_blade` 1.400 s, 66 channels
- `throw_bow` 1.400 s, 66 channels
- `throw_heavy` 1.400 s, 66 channels
- `throw_polearm` 1.400 s, 66 channels
- `throw_rifle` 1.400 s, 66 channels
- `throw_sidearm` 1.400 s, 66 channels
- `walk` 1.067 s, 66 channels
- `walk_blade` 1.067 s, 66 channels
- `walk_bow` 1.067 s, 66 channels
- `walk_heavy` 1.067 s, 66 channels
- `walk_polearm` 1.067 s, 66 channels
- `walk_rifle` 1.067 s, 66 channels
- `walk_sidearm` 1.067 s, 66 channels
- `work` 2.800 s, 66 channels

</details>

## Map kit (`kit.glb`)

Simplified with meshoptimizer per `tools/asset-config.ts`; door/shutter animations removed (static pieces). The cobbled-ground piece was dropped: it is hundreds of disconnected islands that no simplifier can merge, so streets use a procedural cobble albedo + normal map on flat quads instead.

| Piece | Pack asset id | Tris before → after | Size (m, x/y/z) |
|---|---:|---:|---|
| wall-plaster-bay | 27512 | 36 → 36 | 4.00 × 3.50 × 0.36 |
| wall-ochre-bay | 27514 | 36 → 36 | 4.00 × 3.50 × 0.36 |
| wall-shuttered-window | 27511 | 2032 → 664 | 4.00 × 3.50 × 0.45 |
| wall-timber-door | 27513 | 1356 → 726 | 4.00 × 3.50 × 0.73 |
| wall-arched-passage | 27516 | 644 → 644 | 4.00 × 3.50 × 0.36 |
| balcony-bay | 27517 | 1824 → 982 | 4.00 × 3.50 × 1.47 |
| corner-post | 27515 | 876 → 140 | 0.47 × 3.49 × 0.47 |
| floor-tile | 27525 | 444 → 444 | 4.00 × 0.10 × 4.00 |
| roof-tile-slope | 27518 | 384 → 384 | 4.00 × 2.13 × 4.09 |
| roof-ridge-cap | 27521 | 332 → 200 | 4.00 × 0.25 × 0.37 |
| roof-gable-half | 27519 | 140 → 140 | 4.08 × 2.08 × 0.46 |
| roof-parapet | 27520 | 660 → 158 | 4.00 × 0.74 × 0.34 |
| external-stair-run | 27522 | 3008 → 1798 | 1.35 × 4.50 × 4.36 |
| stone-step-block | 27523 | 648 → 400 | 2.06 × 0.61 × 1.20 |
| freestanding-archway | 27524 | 1036 → 700 | 4.33 × 4.21 × 0.92 |
| low-garden-wall | 27527 | 768 → 380 | 4.00 × 0.88 × 0.42 |
| octagonal-fountain | 27528 | 2276 → 1334 | 3.44 × 2.26 × 3.44 |
| market-awning-stall | 27529 | 2412 → 1296 | 2.56 × 2.73 × 1.78 |
| crate-stack | 27530 | 4860 → 900 | 1.45 × 1.30 × 0.99 |
| wine-barrel | 27531 | 1208 → 336 | 0.71 × 0.90 × 0.71 |
| sandbag-wall | 27532 | 6000 → 1000 | 2.15 × 1.09 × 0.64 |
| jersey-barrier | 27533 | 420 → 420 | 2.02 × 0.95 × 0.62 |
| oil-drum | 27534 | 912 → 318 | 0.59 × 0.89 × 0.60 |
| stone-bench | 27535 | 972 → 478 | 1.80 × 0.57 × 0.48 |
| potted-olive-tree | 27536 | 1748 → 796 | 1.71 × 2.12 × 1.61 |
| wall-lamp-bracket | 27537 | 656 → 368 | 0.27 × 0.62 × 0.61 |
| timber-double-gate | 27538 | 2556 → 1262 | 4.00 × 3.50 × 0.40 |
| site-marker-board | 27539 | 972 → 498 | 1.24 × 1.54 × 0.44 |
| barrier-tape-stand | 27540 | 548 → 548 | 2.88 × 1.08 × 0.48 |
| objective-device | 27560 | 3376 → 894 | 0.44 × 0.31 × 0.36 |
| defuse-kit | 27561 | 1960 → 972 | 0.30 × 0.16 × 0.22 |

## Third-person weapons (`weapons3p.glb`)

Each is merged at runtime into ONE vertex-coloured mesh (1 draw call per soldier weapon). The pack's built-in `open`/`close` clips are not reload animations and are not used.

| Piece | Pack asset id | Tris before → after |
|---|---:|---:|
| attacker-rifle | 27550 | 4008 → 1394 |
| defender-carbine | 27549 | 3972 → 1397 |
| service-pistol | 27542 | 2452 → 880 |
| full-smg | 27545 | 4188 → 1294 |
| pump-shotgun | 27547 | 4284 → 1395 |
| marksman-rifle | 27551 | 4144 → 1398 |
| combat-knife | 27554 | 1048 → 560 |
| frag-grenade | 27555 | 1356 → 536 |
| flash-grenade | 27556 | 576 → 382 |
| smoke-grenade | 27557 | 816 → 530 |

## NOT obtained: first-person weapons from CuiGames (a human must download these)

These are served through itch.io's browser "Download Now" flow. An attempt to script that flow from the build sandbox was **blocked by the sandbox permission system, so nothing from CuiGames was downloaded or used**. The game runs on a clearly-labelled **provisional procedural viewmodel** instead (`src/weapons/viewmodel.ts`).

| Item | Page | Expected ZIP | Status |
|---|---|---|---|
| A5 Carbine (12 clips, ~102k tris) | https://cuigames.itch.io/a5-carbine | `A5_Base.zip` (~5.2 MB) | **not downloaded** |
| A5 White Orange (free skin, same clips) | https://cuigames.itch.io/a5-white-orange | `A5_WhiteOrange_Free.zip` | **not downloaded** |
| P50 Heavy Pistol (11 FPS clips) | https://cuigames.itch.io/p50-heavy-pistol | `P50_Heavy_Pistol_Free.zip` | **not downloaded** |
| T12 Auto Shotgun | https://cuigames.itch.io/t12-auto-shotgun | (as downloaded) | **not downloaded** |

Licence as stated on the A5 page: *"Use and modify in personal and commercial games, videos and demos. No reselling or redistributing the files."* — so the raw ZIPs and any standalone optimised GLB are git-ignored; read each ZIP's own `LICENSE.txt` before shipping. Place the ZIPs in `assets/inbox/` and run `npm run assets:import` (inspects, reports the real clip names, writes an optimised copy to the git-ignored `public/assets/private/`). The importer's code path was exercised on a synthetic ZIP only; **hooking a CuiGames GLB into the viewmodel is not done and is unverified** because it needs the real files.
