# assets/inbox — files only YOU can fetch (itch.io "Download Now" flow)

The CuiGames first-person weapons are served through itch.io's browser download flow, which
the build agent could not complete from its sandbox. Please download these in your own browser
(each page has a "Download Now" button, then "No thanks, just take me to the downloads"),
and drop the ZIPs here **without unzipping**:

| Weapon | Page | Expected ZIP filename | Priority |
|---|---|---|---|
| A5 Carbine (primary rifle viewmodel, 12 clips) | https://cuigames.itch.io/a5-carbine | `A5_Base.zip` (~5.2 MB) | 1 |
| A5 White Orange (free skin, same 12 clips; fallback if you prefer it) | https://cuigames.itch.io/a5-white-orange | `A5_WhiteOrange_Free.zip` | optional |
| P50 Heavy Pistol (sidearm viewmodel, 11 FPS clips) | https://cuigames.itch.io/p50-heavy-pistol | `P50_Heavy_Pistol_Free.zip` | 2 |
| T12 Auto Shotgun (optional) | https://cuigames.itch.io/t12-auto-shotgun | (as downloaded) | 3 |

Place them at:

    hillfront/assets/inbox/A5_Base.zip
    hillfront/assets/inbox/P50_Heavy_Pistol_Free.zip

Then run:

    npm run assets:import

(The importer lands in a later phase; until then the game runs with a clearly labelled
**PROVISIONAL procedural viewmodel**, and the weapon code is already structured so the CuiGames
GLB slots in via its weapon profile.)

## Licence handling (important)
CuiGames licence: *"Use and modify in personal and commercial games, videos and demos. No reselling
or redistributing the files."* Therefore:
- the raw ZIPs and any standalone optimized GLB derived from them are **git-ignored** and must never be
  committed to a public repository;
- they are embedded only in the final game build, as a game asset (the use the licence grants);
- read each ZIP's own `LICENSE.txt` before shipping a public build.
