# Testing: what each check proves, and what it does not

Run everything: `npm test` (unit/integration, ~25 s) then, with `npm run dev` running, `npm run e2e:play`, `e2e:flows`, `e2e:net`, and `node tools/releasetest.cjs` after `npm run release`.

| Suite | Count | Proves | Does **not** prove |
|---|---:|---|---|
| `tests/map.test.ts` | 13 | map builds, uses only pieces that exist in the kit; spawns are free; both sites reachable from every spawn; routes balanced; simulated players walk the planned paths without sticking; stair reaches the roof deck; walls/perimeter hold; floor has no stranded pockets; jump/crouch; ray queries | that the map is *fun* or balanced in real play |
| `tests/sim.test.ts` | 20 | round state machine, freeze rules, economy (win/loss/streak), buy rules, armor/helmet, headshots, no friendly fire, walls block shots, reload / cancelled reload / death mid-reload, plant/defuse/detonate, device drop & pick-up, half-time swap, match end, determinism | weapon balance |
| `tests/bots.test.ts` | 6 | bots leave spawn and make contact; all three difficulties finish rounds with kills; full match ends; elimination resolves | that bots are good or human-like |
| `tests/assets.test.ts` | 9 | the **shipped** soldier has all 53 named clips with full channels, 22 joints, 4 sockets with the right parents, one skinned primitive, valid UVs, normalised weights; kit/weapons parse | how it looks (see the before/after sheet) |
| `tests/server.test.ts` | 16 | **real WebSocket clients vs the real server**: identity, presence privacy (invisible/blocked), malformed/oversized/flooded input, invite/decline/duplicate/replay, request→leader only, suggest, kick/promote/leave/hand-over, privacy policies, leader disconnect grace, atomic 3-client party launch incl. readiness feedback, offline member skipped, match end → party returns → leader launches again, public party queue stays on one team, lobby by code, server authority vs a cheating client, token reconnect, matchmaking with flagged bots, health endpoint | scale, long soak, hostile network conditions |
| `tools/playtest.cjs` | 14 steps | real keyboard/mouse in a real browser: buy menu, movement, jump, fire (ammo drops), **reload completes**, weapon switching, scoreboard, inspect, **pause freezes simulation time**, resume | mouse-look direction (see below) |
| `tools/flowtest.cjs` | 10 | menu → practice dialog options reach the sim; death → spectate + cycle; match end → results; return to menu; settings saved, applied live and persisted across reload | |
| `tools/nettest.cjs` | 16 | **three separate browser guests** through the real UI: presence, invite→accept, request→leader→accept, ready, start-for-party, all in one server match on one team with 7 labelled bots, host movement visible in another browser, client prediction matches server, leave match keeps the party, the online panel never covers the match, no page errors | |
| `tools/releasetest.cjs` | 1 | the final single HTML, opened from `file://` with all network blocked, builds the map and plays | |
| `tools/check-size.ts` | gate | fails the release when the real file exceeds the budget (proven by running it with a tighter budget) | |

## Known gaps in testing
- Everything graphical ran on **software WebGL**; no GPU was available. Screenshot review was done by a human-readable eye on captures, not pixel-diff.
- **Mouse look** can't be driven headlessly (Chromium reports bogus `movementX/Y` under pointer lock), so look direction/sensitivity with a real mouse is unverified. Arrow-key turning is exercised.
- Audio cannot be heard in a headless run; it executes without error.
- Playtests wait in *simulation* time because the CPU-rendered page runs far below real time.
- Load/soak testing of the server was not done.
