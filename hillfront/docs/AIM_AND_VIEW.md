# Aiming, mouse-look and view stability

User report on the first release: "you can't aim at all", "the screen shakes a lot for no reason", and the guns looked detached. These are the causes I found by measuring, and what changed. Everything below is covered by an automated check (see the last section); what a person feels with a real mouse on real hardware I could not test (see *Not verified*).

## What was wrong

| Symptom | Cause (measured) | Fix |
|---|---|---|
| Bullets did not go where the crosshair was | The **camera applied the view-punch yaw with the opposite sign** to the one the bullets used (`-punchY` vs `+punchY`), so during a spray the crosshair and the shots drifted apart by 2× the yaw kick. | One shared `viewAngles()` in `gameplay/sim.ts` is now used by BOTH the camera and the bullet code. `tests/aim.test.ts` fires bursts and checks every bullet against the crosshair; `tools/looktest.cjs` checks the live camera follows an imposed punch with the right sign. |
| Mouse far too fast | `BASE_SENS = 0.0022 rad/px` (0.126 deg/px: a 600 px trackpad swipe turned 75 deg) on top of a 115 deg horizontal FOV. | `0.0013 rad/px` (0.075 deg/px) by default, the slider still scales it (0.2–3x). Mouse look also asks the browser for **raw, unaccelerated** movement (`unadjustedMovement`) and drops the one bogus giant delta some browsers emit when the lock engages. |
| Everything tiny / fisheye | Default vertical FOV 78 = **115 deg horizontal** at 16:9. | Default 66 vertical (~99 deg horizontal), slider 50–95. Anyone still on the old default is moved to the new one. The viewmodel has its own fixed FOV so the gun does not change size. |
| No way to aim | There was no aim-down-sights at all, and RMB was only a look-drag fallback. | **Hold right mouse (or Z) to aim down sights**: per-weapon zoom (rifle ×1.35, SMG ×1.25, pistol / shotgun ×1.2, marksman rifle ×3.2 through a scope reticle), spread ×0.42, recoil ×0.8, movement ×0.78, mouse turn rate scaled by 1/zoom, gun lifts to the centre with rear and front sight aligned on the camera axis. Unavailable while reloading / equipping / planting and with the knife. It is part of the simulation (sent to the server, applied to client prediction), not a cosmetic zoom. |
| Mouse capture blocked (embedded windows) = no aiming | A refused pointer lock paused the game and left only arrow keys / RMB-drag. | The game no longer pauses on a *refused* lock. A hint explains what is happening, and the **cursor steers** the view (centre = still; it only arms after the cursor has visited the middle, so a cursor parked on a menu button never spins the view). Arrow keys always turn. |
| Screen shakes "for no reason" | (1) The sim ticks at a fixed 60 Hz and the renderer showed the latest tick with **no interpolation**: on any display that is not exactly 60 Hz (75, 90, 144 Hz, or a laptop at 40–55 fps) the camera advanced 0, 1 or 2 ticks per frame, i.e. visible judder. (2) Every shot and hit added **random per-frame camera noise** (`Math.random()` each frame). (3) Head bob jumped with speed and ran on wall-clock time. (4) The view punch arrived as 60 Hz steps. (5) Online, the predicted player stepped at 60 Hz and snapshot corrections snapped. | (1) Every player pose is interpolated between the last two sim ticks by the fractional tick (`sim.renderAlpha`); the online predicted player the same, and reconciliation errors < 1.2 m are absorbed over ~0.12 s instead of snapping. (2) Own shots no longer shake the screen (recoil is the kick); hits and explosions use a small **smooth** low-frequency shake that decays fast; none while standing still. (3) Bob phase follows distance travelled, amplitude eases, 5.5 mm. (4) The camera eases toward the sim's punch over ~35 ms (the bullets still use the exact value). |

## Numbers
- Mouse: 0.0013 rad/px × sensitivity (default 1.0).
- Camera: standing still moves by exactly 0 (measured over 2.5 s); running bob ≈ 10 mm peak-to-peak; no roll.
- Interpolation: per-frame displacement spread (max − min over mean) at 40 / 50 / 75 / 144 Hz displays < 0.15 (it was > 0.6 at 75 Hz before).

## Tests
`tests/aim.test.ts` (8): bullets vs crosshair with a built-up punch, ADS spread and speed, wire format, zoom table, and smoothness at 40/50/75/144 Hz plus teleport snapping. `tools/looktest.cjs` (13, real browser): still camera, run evenness against the sim clock, bob, burst smoothness, ADS zoom / crosshair / release, punch sign. `tools/vmtest.cjs` also checks the sights line up on screen centre in ADS.

## Not verified
A real mouse and a real trackpad on a real Chromebook (I only have a software-rendered headless browser here), so the *feel* of 0.0013 rad/px and the 66° FOV is a reasoned default, not a measured preference — both are sliders in Settings. The cursor-steering fallback is tested only for "does not spin on its own". Online aim-down-sights is covered by unit tests and the existing 16-check network run (which does not press the aim button).
