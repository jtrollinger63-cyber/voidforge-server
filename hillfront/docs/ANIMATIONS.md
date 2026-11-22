# Animation pipeline

The full list of the 53 clips (with durations and which grip-set variants exist) is in [ASSETS.md](ASSETS.md); it is generated from the shipped GLB.

## Third-person (`src/character/soldier.ts`)
- **Clips come from the file, not assumptions.** Names are looked up at runtime; a missing grip-set variant falls back to the base clip. Gaps that matter: there is **no `fire_sidearm`, `reload_sidearm`, `jump_sidearm`, `aim_sidearm`, or any `*_blade` for fire/reload/jump**, so pistols and the knife use the base `fire` / `reload` / `jump`, and melee uses `melee`.
- **Upper/lower split.** Every full-body clip is split once (by bone name) into an upper-body half (`Spine, Chest, Neck, Head, Shoulder/UpperArm/LowerArm/Hand L+R`) and a lower-body half. Locomotion (`idle / walk / run / crouch / jump / work`) plays on both; **fire, reload, hit and melee play on the upper half only** with a fast blend, so the legs keep running while the arms shoot or reload. Weights are managed manually and cross-faded (≈70 ms).
- **Sync with game state.** Actions are triggered from the simulation's timestamps (`firedAt`, `reloadAt`, `hurtAt`, `diedAt`), never from the animation, so the clip cannot contradict the game: a reload clip only plays if the sim started a reload (`reloadT > 0`), death plays `die` once and holds, a respawn resets the mixer. Reload playback is time-scaled to the weapon's reload duration (capped at 2.6 s).
- **Aim pitch** is applied procedurally to `Spine` (40 %) and `Chest` (60 %) after the mixer runs.
- **Play-speed matching:** run/walk time-scale follows the real horizontal speed to limit foot sliding (reference speeds 4.4 and 1.9 m/s were tuned by eye).
- **Culling:** off-screen soldiers beyond 8 m keep their pose (no mixer update); death poses are kept.

## Weapons on the soldier
- Weapons attach to the real `Socket_Hand_R` node. The Hill Town world models are centred on Z with the muzzle on +Z; a per-model grip transform (`GRIP` in `soldier.ts`) rotates +Z → the socket's +X and shifts the grip point to the origin. **These offsets were set by eye from renders** (idle front/side, run, crouch, fire, reload): hands read as holding the weapon in those frames, but there was no measured IK solve.
- **Left hand:** no IK. The off-hand relies on the kit's `*_rifle` grip-set poses, which were authored for the kit's own weapon, so for the longest guns (R7, T12) the left hand can sit slightly behind the hand-guard.
- The pack's built-in `open`/`close` clips are **not** reload animations and are not used. Each world weapon is baked into a single vertex-coloured mesh at runtime (1 draw call).
- Muzzle flash is a pooled additive sprite at the barrel tip; tracers start from it.

## First-person viewmodel — PROVISIONAL (`src/weapons/viewmodel.ts`)
The CuiGames A5 / P50 / T12 animated viewmodels were **not obtained** (see ASSETS.md). Until they are, the first-person weapon is the CC0 world model rendered close-up in its own pass (cleared depth buffer, so it never clips into walls) with procedural sleeved arms and gloved hands, and these procedural animations driven by the sim's state: idle breathing, walk bob and look sway (off with *Reduce motion*), recoil kick scaled per weapon, equip raise, **staged reload** (weapon dips and rolls, off-hand goes to the magazine, the magazine node drops away, a fresh one slides in, slap/charge), inspect, knife swipe, ejected brass, muzzle flash.
When real GLB viewmodels are imported, the intended mapping per weapon profile is: `Equip`→equip, `Idle`→idle, `Fire_Auto_Start/Loop/End` (or `Recoil_Stylized`)→fire, `Reload_Showcase`→reload (time-scaled to `WeaponDef.reloadTime`), `Inspect`→inspect. This mapping is **not implemented or tested**, because it needs the real files.
