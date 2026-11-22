/**
 * Practice bots. A bot is just a function (sim, player, dt) -> Cmd, so it plays by exactly the same rules
 * as a human: same movement, same weapons, same line-of-sight. They are *not* simulated online players.
 */
import { GameSim, VANGUARD, GARRISON, emptyCmd, RULES, type Cmd, type Player } from './sim.ts';
import { buildNavGrid, findPath, nearestWalkable, cellCenterXZ, type NavGrid } from './nav.ts';
import { eyeHeight, PLAYER } from './movement.ts';
import { WEAPONS, falloffMul } from './weapons.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Skill { reaction: number; aimErr: number; turn: number; headBias: number; strafe: boolean; peek: boolean; sight: number; burst: boolean; }
const SKILL: Record<Difficulty, Skill> = {
  easy:   { reaction: 0.70, aimErr: 4.2, turn: 150, headBias: 0.05, strafe: false, peek: false, sight: 38, burst: false },
  normal: { reaction: 0.42, aimErr: 2.0, turn: 270, headBias: 0.2,  strafe: true,  peek: false, sight: 55, burst: true },
  hard:   { reaction: 0.22, aimErr: 0.8, turn: 460, headBias: 0.42, strafe: true,  peek: true,  sight: 75, burst: true },
};

const DEG = Math.PI / 180;
const navCache = new WeakMap<GameSim, NavGrid>();
const planCache = new WeakMap<GameSim, { round: number; site: 'A' | 'B'; defend: Record<string, number> }>();

function nav(sim: GameSim): NavGrid {
  let g = navCache.get(sim);
  if (!g) { g = buildNavGrid(sim.world); navCache.set(sim, g); }
  return g;
}

/** team plan for the round (shared by all bots of a sim) */
function plan(sim: GameSim) {
  let p = planCache.get(sim);
  if (!p || p.round !== sim.round) { p = { round: sim.round, site: sim.rng() < 0.5 ? 'A' : 'B', defend: {} }; planCache.set(sim, p); }
  return p;
}

const HOLD: Record<'A' | 'B', [number, number][]> = {
  A: [[-17.0, -1.5], [-23.0, 4.8], [-16.5, 8.0], [-24.0, -5.0], [-19.5, -7.0], [-21.0, 8.0]],
  B: [[16.5, -6.5], [24.0, -2.0], [23.0, -8.0], [17.0, 0.0], [21.5, -0.8], [18.0, -9.0]],
};
const MID_HOLD: [number, number][] = [[-4, -6.5], [4, -6.5], [0, -8.5], [-6, 5], [6, 5]];

export function makeBot(difficulty: Difficulty, botSeed = 1): (sim: GameSim, p: Player, dt: number) => Cmd {
  const sk = SKILL[difficulty];
  let rs = (botSeed * 2654435761) >>> 0;
  const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };

  let path: [number, number][] = [], pi = 0, goalKey = '', repathAt = 0;
  let aimYaw = 0, aimPitch = 0, aimInit = false;
  let target: Player | null = null, seenSince = -1, lostAt = -9, lastKnown: [number, number] | null = null;
  let suspect: [number, number] | null = null, suspectAt = -9;
  let strafeDir = 1, strafeUntil = 0, crouchUntil = 0;
  let boughtRound = -1, burstLeft = 0, burstPauseUntil = 0, semiToggle = false;
  let stuckT = 0, lastX = 0, lastZ = 0, unstickUntil = 0, unstickDir = 1;
  let holdIdx = -1, holdRound = -1;
  let visTick = 0;

  return (sim, p, dt) => {
    const cmd: Cmd = emptyCmd();
    const g = nav(sim);
    const now = sim.time;
    if (!aimInit) { aimYaw = p.yaw; aimPitch = 0; aimInit = true; lastX = p.m.x; lastZ = p.m.z; }
    const eye = eyeHeight(p.m);

    // ---- buying (freeze) ----
    if (sim.phase === 'freeze' && boughtRound !== sim.round) {
      boughtRound = sim.round;
      const pr = rnd();
      if (p.money >= 3350) { sim.buy(p.id, pr < 0.2 ? 'r7' : 'a5'); sim.buy(p.id, 'armor'); }
      else if (p.money >= 2700) { sim.buy(p.id, 'a5'); }
      else if (p.money >= 1900) { sim.buy(p.id, pr < 0.5 ? 'm9' : 't12'); sim.buy(p.id, 'armor'); }
      else if (p.money >= 1250) sim.buy(p.id, 'm9');
      else if (p.money >= 650 && pr < 0.6) sim.buy(p.id, 'armor');
      if (p.team === GARRISON && p.money >= 400 && rnd() < 0.7) sim.buy(p.id, 'kit');
    }
    if (sim.phase !== 'live') { cmd.yaw = aimYaw; cmd.pitch = aimPitch; cmd.slot = p.slots[0] ? 0 : 1; return cmd; }

    // ---- perception (throttled) ----
    visTick++;
    if (visTick % 3 === 0) {
      let best: Player | null = null, bestD = 1e9;
      for (const e of sim.players.values()) {
        if (!e.alive || e.team === p.team) continue;
        const dx = e.m.x - p.m.x, dz = e.m.z - p.m.z, d = Math.hypot(dx, dz);
        if (d > sk.sight) continue;
        // field of view: ~110 degrees, plus anything very close
        const fx = -Math.sin(aimYaw), fz = -Math.cos(aimYaw);
        if (d > 3 && (dx * fx + dz * fz) / d < Math.cos(55 * DEG)) continue;
        const ey = p.m.y + eye, ty = e.m.y + (e.m.crouching ? 0.95 : 1.25);
        if (!sim.world.clearLine(p.m.x, ey, p.m.z, e.m.x, ty, e.m.z)) continue;
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) {
        if (!target || target.id !== best.id) { target = best; seenSince = now; }
        lostAt = now; lastKnown = [best.m.x, best.m.z]; suspect = null;
      } else if (target && now - lostAt > 0.25) { target = null; seenSince = -1; }
      // hearing
      if (!best) for (const n of sim.noises) {
        if (n.squad === p.squad) continue;
        const d = Math.hypot(n.x - p.m.x, n.z - p.m.z);
        if (d < 14 * n.loud && now - n.t < 1.0 && (!suspect || now - suspectAt > 1.0)) { suspect = [n.x, n.z]; suspectAt = now; }
      }
    }
    if (target && !target.alive) { target = null; seenSince = -1; }

    // ---- decide movement goal ----
    let goal: [number, number] | null = null;
    let wantUse = false;
    const pl = plan(sim);
    const site = sim.map.sites.find((s) => s.id === pl.site)!;
    const bomb = sim.bomb;

    if (sim.mode === 'objective') {
      if (p.team === VANGUARD) {
        if (bomb.state === 'dropped' && !p.hasDevice) goal = [bomb.x, bomb.z];
        else if (bomb.state === 'planted') {
          // post-plant: hold angles around the device
          const hp = HOLD[bomb.site!]; if (holdRound !== sim.round || holdIdx < 0) { holdIdx = Math.floor(rnd() * hp.length); holdRound = sim.round; }
          goal = hp[holdIdx % hp.length]!;
        } else if (p.hasDevice) {
          const d = Math.hypot(p.m.x - site.x, p.m.z - site.z);
          // stand a little off the centre so we aren't inside the marker board
          const spot: [number, number] = [site.x, site.z + 2.6];
          if (d < site.radius - 0.8 && !target) { wantUse = true; goal = null; }
          else goal = spot;
        } else {
          const hp = HOLD[pl.site]; if (holdRound !== sim.round || holdIdx < 0) { holdIdx = Math.floor(rnd() * hp.length); holdRound = sim.round; }
          goal = hp[holdIdx % hp.length]!;
        }
      } else {
        if (bomb.state === 'planted') {
          const mates = sim.alive(GARRISON).sort((a, b) => Math.hypot(a.m.x - bomb.x, a.m.z - bomb.z) - Math.hypot(b.m.x - bomb.x, b.m.z - bomb.z));
          const defuser = mates[0]?.id === p.id;
          const dd = Math.hypot(p.m.x - bomb.x, p.m.z - bomb.z);
          if (defuser) { if (dd < 1.6 && !target) { wantUse = true; goal = null; } else goal = [bomb.x + 0.9, bomb.z]; }
          else {
            const hp = HOLD[bomb.site!]; if (holdRound !== sim.round || holdIdx < 0) { holdIdx = Math.floor(rnd() * hp.length); holdRound = sim.round; }
            goal = hp[holdIdx % hp.length]!;
          }
        } else {
          // defend a site or hold mid
          if (holdRound !== sim.round || holdIdx < 0) { holdIdx = Math.floor(rnd() * 100); holdRound = sim.round; }
          const roll = holdIdx % 5;
          if (roll === 0) goal = MID_HOLD[holdIdx % MID_HOLD.length]!;
          else { const s = roll <= 2 ? 'A' : 'B'; const hp = HOLD[s]; goal = hp[holdIdx % hp.length]!; }
        }
      }
    } else {
      // elimination: roam towards where the fight is
      if (suspect && now - suspectAt < 4) goal = suspect;
      else if (!goal) { if (holdRound !== sim.round || holdIdx < 0) { holdIdx = Math.floor(rnd() * 4); holdRound = sim.round; } const sp = [[0, 0], [-19, 2], [20, -4], [0, p.team === VANGUARD ? -9 : 9]][holdIdx % 4] as [number, number]; goal = sp; }
    }
    if (target && lastKnown && sk.peek === false && p.team === GARRISON && sim.mode === 'objective' && bomb.state !== 'planted') { /* defenders prefer holding while engaging */ }

    // chase / investigate noises when idle
    if (!target && suspect && now - suspectAt < 3 && !wantUse && sim.mode === 'objective' && p.team === GARRISON && bomb.state !== 'planted' && rnd() < 0.002) goal = suspect;

    // ---- path following ----
    let wx = 0, wz = 0;
    const moving = goal && !wantUse;
    if (moving && goal) {
      const key = `${Math.round(goal[0])},${Math.round(goal[1])}`;
      if (key !== goalKey || now > repathAt) {
        goalKey = key; repathAt = now + 1.4 + rnd() * 0.6;
        const np = findPath(sim.world, g, p.m.x, p.m.z, goal[0], goal[1]);
        if (np) { path = np; pi = 1; }
      }
      while (pi < path.length - 1 && Math.hypot(path[pi]![0] - p.m.x, path[pi]![1] - p.m.z) < 0.7) pi++;
      const wp = path[Math.min(pi, path.length - 1)];
      if (wp) {
        const dx = wp[0] - p.m.x, dz = wp[1] - p.m.z, d = Math.hypot(dx, dz);
        const arrived = Math.hypot(goal[0] - p.m.x, goal[1] - p.m.z) < 0.9;
        if (!arrived && d > 0.05) { wx = dx / d; wz = dz / d; }
      }
    }
    // unstick
    stuckT += dt;
    if (stuckT > 1.2) {
      const moved = Math.hypot(p.m.x - lastX, p.m.z - lastZ);
      if (moving && moved < 0.35 && (wx !== 0 || wz !== 0)) { unstickUntil = now + 0.6; unstickDir = rnd() < 0.5 ? -1 : 1; repathAt = 0; cmd.jump = true; }
      lastX = p.m.x; lastZ = p.m.z; stuckT = 0;
    }
    if (now < unstickUntil) { const t = wx; wx = -wz * unstickDir * 0.9 + wx * 0.3; wz = t * unstickDir * 0.9 + wz * 0.3; }

    // ---- aiming ----
    let desYaw = aimYaw, desPitch = aimPitch;
    let engaged = false;
    if (target) {
      const ready = now - seenSince >= sk.reaction;
      const head = rnd() < sk.headBias;
      const ty = target.m.y + (head ? 1.58 : target.m.crouching ? 0.85 : 1.15);
      const dx = target.m.x - p.m.x, dz = target.m.z - p.m.z, dy = ty - (p.m.y + eye);
      const hd = Math.hypot(dx, dz);
      // leading is intentionally absent: bots miss moving targets just like players do
      desYaw = Math.atan2(-dx, -dz) + (rnd() - 0.5) * sk.aimErr * DEG * (1 + hd / 40);
      desPitch = Math.atan2(dy, hd) + (rnd() - 0.5) * sk.aimErr * DEG * 0.7 * (1 + hd / 40);
      engaged = ready;
    } else if (suspect && now - suspectAt < 1.5) {
      desYaw = Math.atan2(-(suspect[0] - p.m.x), -(suspect[1] - p.m.z)); desPitch = 0;
    } else if (wx !== 0 || wz !== 0) {
      desYaw = Math.atan2(-wx, -wz); desPitch *= 0.9;
    }
    // smooth turning limited by skill
    const maxTurn = sk.turn * DEG * dt * (target ? 1 : 0.55);
    let dyaw = ((desYaw - aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    aimYaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
    aimPitch += Math.max(-maxTurn, Math.min(maxTurn, desPitch - aimPitch));
    cmd.yaw = aimYaw; cmd.pitch = Math.max(-1.2, Math.min(1.2, aimPitch));

    // ---- movement command relative to view ----
    const fwdDot = -Math.sin(aimYaw) * wx - Math.cos(aimYaw) * wz;
    const rightDot = Math.cos(aimYaw) * wx - Math.sin(aimYaw) * wz;
    cmd.fwd = fwdDot; cmd.strafe = rightDot;
    cmd.walk = !target && p.team === GARRISON && !suspect && (wx !== 0 || wz !== 0) && rnd() < 0.0;

    // ---- combat ----
    const def = sim.currentWeapon(p);
    if (target && engaged && def.slot !== 'melee') {
      const dist = Math.hypot(target.m.x - p.m.x, target.m.z - p.m.z);
      const errYaw = Math.abs(((desYaw - aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / DEG;
      const tol = (def.slot === 'secondary' ? 2.2 : 3.2) + sk.aimErr * 0.6 + Math.max(0, 4 - dist * 0.25);
      const inRange = dist < def.range * 0.9 && falloffMul(def, dist) > 0.35;
      if (errYaw < tol && inRange) {
        if (def.auto) {
          if (sk.burst && now < burstPauseUntil) cmd.fire = false;
          else {
            cmd.fire = true;
            if (sk.burst) { if (burstLeft <= 0) burstLeft = 3 + Math.floor(rnd() * 5); if (--burstLeft <= 0) burstPauseUntil = now + 0.12 + rnd() * 0.25; }
          }
        } else { semiToggle = !semiToggle; cmd.fire = semiToggle; }
      }
      // fight movement: strafe unless we are the defuser/planter; crouch-peek at range
      if (sk.strafe && !wantUse) {
        if (now > strafeUntil) { strafeDir = rnd() < 0.5 ? -1 : 1; strafeUntil = now + 0.35 + rnd() * 0.7; }
        cmd.strafe = Math.max(-1, Math.min(1, cmd.strafe + strafeDir * 0.8));
        cmd.fwd *= 0.4;
      } else { cmd.fwd = 0; cmd.strafe = 0; }
      if (sk.peek && dist > 18) { if (now > crouchUntil + 1.2) crouchUntil = now + 0.6 + rnd() * 0.5; }
      cmd.crouch = now < crouchUntil && dist > 14;
    } else if (target) { cmd.fwd = 0; cmd.strafe = 0; }

    // knife-only? run at the nearest known enemy; otherwise reload / weapon pick
    if (def.slot !== 'melee') {
      const a = p.ammo[def.id]!;
      if (a.mag === 0 && a.reserve > 0) cmd.reload = true;
      else if (!target && a.mag < def.mag * 0.5 && a.reserve > 0 && rnd() < 0.02) cmd.reload = true;
    }
    cmd.slot = p.slots[0] ? 0 : 1;
    if (p.cur !== (p.slots[0] ? 0 : 1) && !target) cmd.slot = p.slots[0] ? 0 : 1; else cmd.slot = -1;

    // plant / defuse
    if (wantUse) { cmd.use = true; cmd.fwd = 0; cmd.strafe = 0; }
    if (p.using !== 'none' && target) { cmd.use = false; }

    // keep eyes on the site while planting
    void RULES; void PLAYER; void nearestWalkable; void cellCenterXZ; void WEAPONS;
    return cmd;
  };
}

/** Fill both teams with bots up to `perTeam`, leaving the first `humans` slots on squad 0 for people. */
export function fillWithBots(sim: GameSim, perTeam: number, difficulty: Difficulty, humanSquad0 = 1): void {
  const names = ['Atlas', 'Brio', 'Cinder', 'Dune', 'Ember', 'Flint', 'Garnet', 'Hollis', 'Indigo', 'Juno', 'Kestrel', 'Lark', 'Moss', 'Nyx', 'Onyx', 'Pike'];
  let ni = 0;
  for (const squad of [0, 1] as const) {
    const have = [...sim.players.values()].filter((p) => p.squad === squad).length;
    const want = perTeam;
    for (let i = have; i < want; i++) {
      const b = sim.addPlayer(`[BOT] ${names[ni++ % names.length]}`, squad, true);
      sim.brains.set(b.id, makeBot(difficulty, b.id * 7919 + 13));
    }
  }
  void humanSquad0;
}
