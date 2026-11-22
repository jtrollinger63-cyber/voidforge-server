# Networking, parties and deployment

## Model
- **Authoritative server.** `server/match.ts` runs the same `GameSim` as offline play at **60 Hz**. Clients send *inputs only* (`match.cmd`: move axes, buttons, yaw/pitch, slot). Position, health, ammo, money, score and round state exist only on the server.
- **One command per tick.** Each human has a queue; the server consumes exactly one command per tick (queue capped at 8, oldest dropped), so a client cannot move faster than the sim by flooding. Commands are validated and clamped (`validCmd`): NaN/Infinity, huge axes and unknown fields are neutralised. Tested with 600 spoofed commands + claimed position/hp/money.
- **Snapshots at 20 Hz**, JSON. Private data (own ammo, slots, money, velocity, spray) goes only to its owner; enemy money is never sent.
- **Client prediction** (`src/game/session.ts`): the local player is simulated with the same `stepMovement` and `World`; on each snapshot the client resets to the server state and replays commands the server has not yet acknowledged. Remote players are interpolated 100 ms behind. Measured in the 3-browser test: predicted position equals what other clients see.
- **Hit registration:** shooters are lag-compensated by rewinding victims `min(0.22 s, RTT/2 + 70 ms)` from a 36-tick position history. Basic by design.
- **Bots** are always labelled `[BOT]` and flagged in snapshots. A disconnected or departed player's character is taken over by a bot; reconnecting within the grace period (25 s) hands it back.

## Identity, presence and privacy
- Guests only: the server issues a random token (stored per server URL in `localStorage`) and derives a stable `uid`. No passwords, no accounts, no persistence (state is in memory). Names are sanitised and de-duplicated.
- **Presence** (`presence.sub`): the list contains only connected players who are **visible**, not blocked either way. Invisible players never appear and cannot be invited or asked.
- **Invite policy:** anyone / favourites only / nobody. **Block** hides both ways and prevents invites, requests and lobby joins. Favourites and blocks are kept in the client's storage and re-sent on every hello.
- **Abuse limits:** frames > 4 KB are rejected (hard cap 8 KB closes the socket); token buckets per category (`cmd`, `misc`, `invite`, `request`, `buy`, `ping`); repeated violations disconnect; `ALLOWED_ORIGINS` restricts browsers; `MAX_SESSIONS` caps load.

## Party rules (`server/party.ts`, deliberately independent of the shooter)
- Anyone can **invite** (leader by default; the leader may let members invite) or **request to join** any visible player. A request always goes to the **party leader**; asking a lone player makes them the leader of an implicit one-person party.
- Members who cannot invite may **suggest** an invite; the leader accepts or declines.
- Invites expire after 30 s, requests/suggestions after 60 s; duplicates, full parties (5), busy parties (queued/in match), blocked and invisible targets are rejected with a human-readable error.
- Leader: kick, promote, settings (mode, private/public, 3v3/5v5, bots, difficulty), **Start for party**. Settings changes clear everyone's ready flag. Start requires every *online* member to be ready and names who is not; offline members are skipped with a notice to the rest.
- **Launch is atomic.** Private: one match containing exactly the party (all on one team) plus bots. Public: the whole party enters matchmaking together and is never split. Every member receives `match.start` in the same call, or an error explaining why not.
- Disconnects keep the slot for 20 s, then the member is removed and leadership passes on. After a match everyone returns to the **party lobby**, ready flags cleared, and the leader can start again.

## Lobbies and matchmaking
Public lobby browser, private lobbies by 5-character code, team choice, ready flags, host start with a 5 s countdown, team auto-balance on join. Matchmaking queues by mode; after 8 s (or 10 humans) it starts a match and **bots fill the remaining slots** (announced to the players). Players in a multi-member party use *Start for party* instead of lobbies.

## Deploying the server
The server is a single Node process (state in memory — one instance only). It must be reachable over **wss://** from an https page; terminate TLS in front of it.

```bash
npm ci
ALLOWED_ORIGINS=https://your-site.example PORT=8787 npm run server   # health: GET /health
```
`render.yaml` is a ready-to-adapt Render blueprint (Render terminates TLS; use the `wss://<service>.onrender.com/ws` URL). Then build the client for it:
```bash
npm run build:single -- --server wss://<service>.onrender.com/ws
```
`ALLOWED_ORIGINS` must list the exact page origin(s) that will load the game. **Google Sites** serves embeds from a `googleusercontent.com` origin you must discover by opening your published page and reading `location.origin` inside the frame; leave `ALLOWED_ORIGINS` empty while testing. **Public deployment has not been done** (no hosting credentials were available).

## Reusing the party service for another game
`server/party.ts` needs only `Session` objects (id, uid, name, status, privacy sets, `send`) and a `launch(party, members)` callback (`LobbyManager.launchParty`). Swap the launch target and the presence/party layer is game-agnostic.

## Known limitations
Single process, no persistence, no horizontal scaling; JSON snapshots (not delta/binary); simple lag compensation; guests only; no chat; no anti-cheat beyond server authority and input validation (aim assist or wallhacks are not detectable).
