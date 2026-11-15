# Voidforge Racing

A 3D arcade racing game that runs in the browser from **one HTML file** (`index.html`, ~650 KB, three.js bundled in).
Open it directly, or host it anywhere static (GitHub Pages, Netlify, ...). No server, no assets to download.

- 6-car races (you + 5 AI), 1 / 3 / 5 laps, Easy / Normal / Hard opponents
- 3 tracks with their own look: **Greenfield GP** (day, pines), **Dune Rally** (desert), **Midnight Ridge** (night, street lamps, headlights)
- Grip-based arcade handling: handbrake drifts charge **nitro**, walls and car-to-car contact, grass slows you down
- Chase / far / hood cameras, skid marks, smoke and dust, speed FOV, procedural engine/tyre/impact audio (no audio files)
- Minimap, lap times, per-track records (saved in `localStorage`), results screen
- Keyboard, gamepad and touch controls

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate / brake & reverse | `W` `S` / `↑` `↓` | RT / LT (A / B) | GAS / BRAKE |
| Steer | `A` `D` / `←` `→` | Left stick | ◀ ▶ |
| Handbrake drift | `Space` | X | DRIFT |
| Nitro | `Shift` | RB | NITRO |
| Camera / reset to track | `C` / `R` | Y / LB | ⟳ |
| Pause / mute | `P` or `Esc` / `M` | Start | ❚❚ |

Drifting fills the nitro bar. Hold `Shift` on a straight to use it.

## Develop

```bash
npm install
npm run dev      # rebuilds index.html on every change in src/
npm run build    # one-off build
```

`src/` is plain ES modules; `build.mjs` bundles it with esbuild into `index.html`.

| File | Purpose |
| --- | --- |
| `src/tracks.js` | Track layouts (closed loops of control points) and visual themes |
| `src/trackmath.js` | Spline sampling, curvature, nearest-point query (pure maths, runs in Node) |
| `src/track.js` | Road, kerb, barrier, start-gantry meshes |
| `src/world.js` | Sky, ground, hills, scenery, grandstand, lamps, lighting |
| `src/car.js` | Car physics (`PHYS` holds the tuning numbers) and the low-poly car model |
| `src/ai.js` | AI driver: racing line, pure-pursuit steering, braking from curvature, avoidance |
| `src/main.js` | Race flow, camera, effects, menu wiring, main loop |

### Add a track

Append an entry to `TRACKS` in `src/tracks.js` (`points`, `width`, `theme`, and `startAt` to put the line mid-straight), then:

```bash
npm run validate   # checks corner radius >= 38 m and clearance between track sections, writes nothing
node scripts/validate-tracks.mjs out/   # also writes an SVG preview of each layout to out/
```

### Tests

```bash
npm test           # track validation + headless physics/AI simulation (no browser needed)
npm run smoke      # end-to-end in headless Chromium; needs Playwright installed
```

The simulation tests check acceleration/braking/cornering numbers, wall and car collisions, and that every AI car can lap every track without touching walls or grass.

## Ideas for later

Elevation and banked corners, a garage with upgrades, ghost laps, online multiplayer (this repo used to hold a game server), more tracks/weather, a replay camera.
