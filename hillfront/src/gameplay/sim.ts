/**
 * GameSim: the single authoritative simulation of a Hillfront match.
 * Pure TypeScript (no DOM / three.js). Used by:
 *   - the browser for offline bot practice,
 *   - the Node server for online matches (clients send inputs, receive snapshots).
 */
import { World } from '../map/world.ts';
import { buildHillfront, type MapDef } from '../map/hillfront.ts';
import { stepMovement, newMoveState, PLAYER, eyeHeight, playerHeight, type MoveState } from './movement.ts';
import { WEAPONS, BUY_ITEMS, falloffMul, type WeaponId, type WeaponDef } from './weapons.ts';

export type Team = 0 | 1;           // 0 = Vanguard (attackers), 1 = Garrison (defenders)
export const VANGUARD: Team = 0, GARRISON: Team = 1;
export const TEAM_NAMES = ['Vanguard', 'Garrison'] as const;
export type Phase = 'warmup' | 'freeze' | 'live' | 'roundEnd' | 'matchEnd';
export type Mode = 'objective' | 'elimination';

export const RULES = {
  tickRate: 60,
  freezeTime: 10,
  roundTime: 105,
  roundEndTime: 6,
  matchEndTime: 12,
  warmupTime: 6,
  roundsToWin: 8,
  halftimeAfter: 7,
  startMoney: 800,
  maxMoney: 16000,
  winMoney: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMaxStreak: 4,
  plantBonusLoss: 800,
  plantTime: 3.2,
  defuseTime: 6,
  defuseTimeKit: 3.5,
  deviceTimer: 40,
  buyWindowLive: 12,
  armorPrice: 650,
  friendlyFire: false,
  deathCamTime: 2.2,
} as const;

const DEG = Math.PI / 180;

export interface Cmd {
  fwd: number; strafe: number; jump: boolean; crouch: boolean; walk: boolean;
  yaw: number; pitch: number;
  fire: boolean; reload: boolean; use: boolean;
  /** -1 none, 0 primary, 1 secondary, 2 melee */
  slot: number;
  /** holding aim-down-sights (the client clears it while reloading / equipping / planting) */
  aim: boolean;
}
export const emptyCmd = (): Cmd => ({ fwd: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0, fire: false, reload: false, use: false, slot: -1, aim: false });

/** ADS: tighter spread, a little less recoil, slower movement. One definition shared by the sim, the client prediction and the HUD. */
export const AIM = { spreadMul: 0.42, kickMul: 0.8, moveMul: 0.78 } as const;

/** where the crosshair — and every bullet — points: the aim plus the current view punch. The camera and the sim both call this, so they cannot disagree. */
export function viewAngles(yaw: number, pitch: number, punchY: number, punchP: number): { yaw: number; pitch: number } {
  return { yaw: yaw + punchY * DEG, pitch: pitch + punchP * DEG };
}

export interface AmmoState { mag: number; reserve: number; }

export interface Player {
  id: number; name: string; squad: 0 | 1; team: Team; bot: boolean; connected: boolean;
  m: MoveState; yaw: number; pitch: number;
  punchP: number; punchY: number; spray: number; lastShot: number;
  hp: number; armor: number; helmet: boolean; kit: boolean; money: number; alive: boolean;
  slots: (WeaponId | null)[]; cur: number; ammo: Partial<Record<WeaponId, AmmoState>>;
  fireCd: number; reloadT: number; equipT: number; firePrev: boolean; reloadPrev: boolean;
  kills: number; deaths: number; assists: number; score: number; roundKills: number;
  hasDevice: boolean; useT: number; using: 'none' | 'plant' | 'defuse';
  cmd: Cmd;
  lastHurt: { x: number; z: number; t: number } | null;
  ping: number;
  /** sim-time of last shot / reload start / hurt, for animations + UI */
  firedAt: number; reloadAt: number; hurtAt: number; diedAt: number;
  speed: number;
  noiseT: number;
  /** state at the START of the last fixed tick, so renderers can interpolate between ticks instead of stepping at 60 Hz */
  prev: { x: number; y: number; z: number; yaw: number; pitch: number };
  /** damage dealt this round per victim (assist tracking) */
  dmgTo: Record<number, number>;
}

export interface Bomb {
  state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'none';
  x: number; y: number; z: number;
  site: 'A' | 'B' | null;
  timeLeft: number;
  carrier: number;
}

export type SimEvent =
  | { t: 'shot'; id: number; w: WeaponId; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; hx: number; hy: number; hz: number; hit: 'none' | 'world' | 'player'; nx: number; ny: number; nz: number }
  | { t: 'hit'; a: number; v: number; dmg: number; head: boolean; killed: boolean }
  | { t: 'kill'; a: number; v: number; w: WeaponId; head: boolean }
  | { t: 'reload'; id: number }
  | { t: 'equip'; id: number; w: WeaponId }
  | { t: 'phase'; phase: Phase; round: number }
  | { t: 'roundEnd'; winner: Team | null; reason: string }
  | { t: 'plantStart' | 'plantCancel' | 'defuseStart' | 'defuseCancel'; id: number }
  | { t: 'planted'; id: number; site: 'A' | 'B' } | { t: 'defused'; id: number } | { t: 'exploded' }
  | { t: 'deviceDropped'; x: number; z: number } | { t: 'devicePicked'; id: number }
  | { t: 'buy'; id: number; item: string }
  | { t: 'matchEnd'; winnerSquad: 0 | 1 | null }
  | { t: 'sides' }
  | { t: 'dry'; id: number };

export interface SimOptions {
  mode: Mode;
  seed: number;
  /** skip warmup and start at round 1 freeze (offline practice) */
  skipWarmup: boolean;
  map?: MapDef;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class GameSim {
  map: MapDef;
  world: World;
  mode: Mode;
  rng: () => number;
  time = 0;
  tick = 0;
  phase: Phase = 'warmup';
  phaseT = 0;
  phaseElapsed = 0;
  round = 0;
  /** match score by squad (side-independent) */
  score: [number, number] = [0, 0];
  /** squad 0 starts as Vanguard; flips at half time */
  swapped = false;
  lossStreak: [number, number] = [0, 0];
  players = new Map<number, Player>();
  bomb: Bomb = { state: 'none', x: 0, y: 0, z: 0, site: null, timeLeft: 0, carrier: -1 };
  events: SimEvent[] = [];
  lastWinner: { winner: Team | null; reason: string } | null = null;
  matchWinnerSquad: 0 | 1 | null = null;
  /** recent noises that bots can hear */
  noises: { x: number; z: number; t: number; squad: number; loud: number }[] = [];
  /** server hook: where a victim was when the shooter fired (null = use the current position) */
  lagComp: ((shooter: Player, victim: Player) => { x: number; y: number; z: number } | null) | null = null;
  /** per-bot decision functions installed by the host (browser/server) */
  brains = new Map<number, (sim: GameSim, p: Player, dt: number) => Cmd>();
  private acc = 0;
  private nextId = 1;
  private roundOverPending = false;

  constructor(opts: Partial<SimOptions> = {}) {
    this.mode = opts.mode ?? 'objective';
    this.rng = mulberry32(opts.seed ?? 12345);
    this.map = opts.map ?? buildHillfront();
    this.world = this.map.world;
    if (opts.skipWarmup) { this.round = 0; this.beginRound(); }
    else { this.phase = 'warmup'; this.phaseT = RULES.warmupTime; }
  }

  // ------------------------------------------------------------------ players
  teamOfSquad(squad: 0 | 1): Team { return (squad ^ (this.swapped ? 1 : 0)) as Team; }
  squadOfTeam(team: Team): 0 | 1 { return (team ^ (this.swapped ? 1 : 0)) as 0 | 1; }

  addPlayer(name: string, squad: 0 | 1, bot = false, id?: number): Player {
    const pid = id ?? this.nextId++;
    if (pid >= this.nextId) this.nextId = pid + 1;
    const p: Player = {
      id: pid, name, squad, team: this.teamOfSquad(squad), bot, connected: true,
      m: newMoveState(0, this.world.floorY, 0), yaw: 0, pitch: 0, punchP: 0, punchY: 0, spray: 0, lastShot: -9,
      hp: 100, armor: 0, helmet: false, kit: false, money: RULES.startMoney, alive: false,
      slots: [null, 'p50', 'knife'], cur: 1, ammo: {},
      fireCd: 0, reloadT: 0, equipT: 0, firePrev: false, reloadPrev: false,
      kills: 0, deaths: 0, assists: 0, score: 0, roundKills: 0,
      hasDevice: false, useT: 0, using: 'none', cmd: emptyCmd(), lastHurt: null, ping: 0,
      firedAt: -9, reloadAt: -9, hurtAt: -9, diedAt: -9, speed: 0, noiseT: 0, prev: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, dmgTo: {},
    };
    this.giveDefaultLoadout(p);
    this.players.set(p.id, p);
    // joining mid-round: spawn dead until next round (warmup: instantly)
    if (this.phase === 'warmup') this.spawn(p);
    return p;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.hasDevice && p.alive) this.dropDevice(p);
    this.players.delete(id); this.brains.delete(id);
  }

  teamPlayers(team: Team): Player[] { return [...this.players.values()].filter((p) => p.team === team); }
  alive(team: Team): Player[] { return this.teamPlayers(team).filter((p) => p.alive); }

  private giveDefaultLoadout(p: Player) {
    p.slots = [null, 'p50', 'knife']; p.cur = 1; p.ammo = { p50: { mag: WEAPONS.p50.mag, reserve: WEAPONS.p50.reserve }, knife: { mag: 1, reserve: 0 } };
    p.armor = 0; p.helmet = false; p.kit = false; p.fireCd = 0; p.reloadT = 0; p.equipT = 0.0;
  }

  currentWeapon(p: Player): WeaponDef { return WEAPONS[p.slots[p.cur] ?? 'knife']; }

  // ------------------------------------------------------------------ round flow
  private setPhase(phase: Phase, t: number) {
    this.phase = phase; this.phaseT = t; this.phaseElapsed = 0;
    this.events.push({ t: 'phase', phase, round: this.round });
  }

  beginRound() {
    this.round++;
    this.roundOverPending = false;
    this.bomb = { state: 'none', x: 0, y: 0, z: 0, site: null, timeLeft: 0, carrier: -1 };
    // survivors keep gear, dead lose it
    for (const p of this.players.values()) {
      if (!p.alive || this.round === 1 || p.squad === undefined) this.giveDefaultLoadout(p);
      p.roundKills = 0; p.dmgTo = {};
    }
    // shuffle spawns
    const sp: Record<number, { x: number; z: number; yaw: number }[]> = { 0: [...this.map.spawns.vanguard], 1: [...this.map.spawns.garrison] };
    for (const arr of [sp[0]!, sp[1]!]) for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
    const idx = [0, 0];
    for (const p of this.players.values()) {
      p.team = this.teamOfSquad(p.squad);
      const list = sp[p.team]!;
      const s = list[idx[p.team]! % list.length]!; idx[p.team]!++;
      this.spawn(p, s.x + (idx[p.team]! > list.length ? (this.rng() - 0.5) * 1.5 : 0), s.z, s.yaw);
    }
    // device to a random attacker
    if (this.mode === 'objective') {
      const atk = this.teamPlayers(VANGUARD);
      if (atk.length) { const c = atk[Math.floor(this.rng() * atk.length)]!; c.hasDevice = true; this.bomb = { ...this.bomb, state: 'carried', carrier: c.id }; }
    }
    this.setPhase('freeze', RULES.freezeTime);
  }

  private spawn(p: Player, x?: number, z?: number, yawDeg?: number) {
    const list = p.team === VANGUARD ? this.map.spawns.vanguard : this.map.spawns.garrison;
    const s = list[Math.floor(this.rng() * list.length)]!;
    const px = x ?? s.x, pz = z ?? s.z, yd = yawDeg ?? s.yaw;
    p.m = newMoveState(px, this.world.floorY, pz);
    p.yaw = yd * DEG; p.pitch = 0; p.punchP = p.punchY = 0; p.spray = 0;
    p.hp = 100; p.alive = true; p.hasDevice = false; p.useT = 0; p.using = 'none';
    p.fireCd = 0; p.reloadT = 0; p.equipT = 0.3; p.cur = p.slots[0] ? 0 : 1; p.lastHurt = null;
    p.cmd = emptyCmd(); p.cmd.yaw = p.yaw;
    p.prev = { x: p.m.x, y: p.m.y, z: p.m.z, yaw: p.yaw, pitch: p.pitch };
  }

  private endRound(winner: Team | null, reason: string) {
    if (this.roundOverPending) return;
    this.roundOverPending = true;
    this.lastWinner = { winner, reason };
    if (winner !== null) {
      const winSquad = this.squadOfTeam(winner);
      this.score[winSquad]++;
      this.lossStreak[winSquad] = 0;
      const loseSquad = (winSquad ^ 1) as 0 | 1;
      this.lossStreak[loseSquad] = Math.min(RULES.lossMaxStreak, this.lossStreak[loseSquad] + 1);
      for (const p of this.players.values()) {
        const bonus = p.squad === winSquad ? RULES.winMoney : RULES.lossBase + RULES.lossStep * (this.lossStreak[p.squad]! - 1) + (this.bomb.state === 'planted' || this.bomb.state === 'exploded' ? (p.team === VANGUARD ? RULES.plantBonusLoss : 0) : 0);
        p.money = Math.min(RULES.maxMoney, p.money + bonus);
      }
    }
    this.events.push({ t: 'roundEnd', winner, reason });
    this.setPhase('roundEnd', RULES.roundEndTime);
  }

  private afterRoundEnd() {
    const needed = RULES.roundsToWin;
    if (this.score[0] >= needed || this.score[1] >= needed) {
      this.matchWinnerSquad = this.score[0] >= needed ? 0 : 1;
      this.events.push({ t: 'matchEnd', winnerSquad: this.matchWinnerSquad });
      this.setPhase('matchEnd', RULES.matchEndTime);
      return;
    }
    if (this.round === RULES.halftimeAfter) {
      this.swapped = !this.swapped;
      this.lossStreak = [0, 0];
      for (const p of this.players.values()) { p.team = this.teamOfSquad(p.squad); p.money = RULES.startMoney; p.alive = false; }
      this.events.push({ t: 'sides' });
    }
    this.beginRound();
  }

  // ------------------------------------------------------------------ main step
  /** Advance by wall-clock dt using a fixed internal tick. */
  advance(dt: number) {
    this.acc += Math.min(dt, 0.25);
    const step = 1 / RULES.tickRate;
    while (this.acc >= step) { this.step(step); this.acc -= step; }
  }
  /** 0..1: how far wall-clock time is into the next fixed tick (renderers interpolate prev -> current by this) */
  get renderAlpha(): number { return Math.min(1, Math.max(0, this.acc * RULES.tickRate)); }

  step(dt: number) {
    this.time += dt; this.tick++;
    this.phaseElapsed += dt;
    // bots think
    for (const [id, brain] of this.brains) {
      const p = this.players.get(id);
      if (p && p.alive && p.bot) p.cmd = brain(this, p, dt);
    }
    const frozen = this.phase === 'freeze';
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.prev.x = p.m.x; p.prev.y = p.m.y; p.prev.z = p.m.z; p.prev.yaw = p.yaw; p.prev.pitch = p.pitch;
      this.stepPlayer(p, dt, frozen);
    }
    this.stepDevice(dt);
    // noises decay
    if (this.noises.length) this.noises = this.noises.filter((n) => this.time - n.t < 1.5);

    // phase timers
    if (this.phase === 'warmup') {
      this.phaseT -= dt;
      if (this.phaseT <= 0 && this.players.size > 0) { this.round = 0; for (const p of this.players.values()) p.money = RULES.startMoney; this.beginRound(); }
    } else if (this.phase === 'freeze') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.setPhase('live', RULES.roundTime);
    } else if (this.phase === 'live') {
      this.phaseT -= dt;
      this.checkRoundEnd();
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.afterRoundEnd();
    } else if (this.phase === 'matchEnd') {
      this.phaseT -= dt;
    }
  }

  private checkRoundEnd() {
    if (this.roundOverPending) return;
    const vAlive = this.alive(VANGUARD).length, gAlive = this.alive(GARRISON).length;
    const vTot = this.teamPlayers(VANGUARD).length, gTot = this.teamPlayers(GARRISON).length;
    if (vTot === 0 || gTot === 0) return; // nobody to fight
    if (this.mode === 'objective') {
      if (this.bomb.state === 'exploded') return this.endRound(VANGUARD, 'The device detonated');
      if (this.bomb.state === 'defused') return this.endRound(GARRISON, 'The device was disarmed');
      if (gAlive === 0) return this.endRound(VANGUARD, 'Garrison eliminated');
      if (vAlive === 0 && this.bomb.state !== 'planted') return this.endRound(GARRISON, 'Vanguard eliminated');
      if (this.phaseT <= 0 && this.bomb.state !== 'planted') return this.endRound(GARRISON, 'Time expired');
    } else {
      if (gAlive === 0) return this.endRound(VANGUARD, 'Garrison eliminated');
      if (vAlive === 0) return this.endRound(GARRISON, 'Vanguard eliminated');
      if (this.phaseT <= 0) return this.endRound(vAlive > gAlive ? VANGUARD : GARRISON, 'Time expired');
    }
  }

  // ------------------------------------------------------------------ per player
  private stepPlayer(p: Player, dt: number, frozen: boolean) {
    const c = p.cmd;
    p.yaw = c.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, c.pitch));
    const def = this.currentWeapon(p);

    // movement
    const planting = p.using !== 'none';
    const mv = { fwd: frozen || planting ? 0 : c.fwd, strafe: frozen || planting ? 0 : c.strafe, jump: !frozen && !planting && c.jump, crouch: c.crouch, walk: c.walk, yaw: p.yaw };
    stepMovement(this.world, p.m, mv, dt, def.moveMul * (c.aim && def.slot !== 'melee' ? AIM.moveMul : 1));
    p.speed = Math.hypot(p.m.vx, p.m.vz);
    if (p.m.justLanded && p.m.landSpeed > 11) { // hard landings hurt a little
      this.damageRaw(p, Math.round((p.m.landSpeed - 11) * 8), -1);
    }
    // footsteps (noise for bots)
    p.noiseT -= dt;
    if (p.m.onGround && p.speed > 3.6 && !c.walk && !c.crouch && p.noiseT <= 0) { p.noiseT = 0.45; this.noises.push({ x: p.m.x, z: p.m.z, t: this.time, squad: p.squad, loud: 1 }); }

    // view punch recovery
    const rec = Math.exp(-def.recover * dt);
    p.punchP *= rec; p.punchY *= rec;
    if (this.time - p.lastShot > 0.28) p.spray = Math.max(0, p.spray - dt * 12);

    // timers
    if (p.fireCd > 0) p.fireCd -= dt;
    if (p.equipT > 0) p.equipT -= dt;

    // weapon switch
    if (c.slot >= 0 && c.slot !== p.cur && p.slots[c.slot] && !frozenSwitchBlock(this, p)) this.switchTo(p, c.slot);

    // reload
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) this.finishReload(p);
    } else if ((c.reload && !p.reloadPrev) || (p.ammo[def.id]!.mag === 0 && def.slot !== 'melee' && c.fire && !p.firePrev && p.ammo[def.id]!.reserve > 0)) {
      this.startReload(p);
    }
    p.reloadPrev = c.reload;

    // fire
    const canFire = !frozen && this.phase !== 'roundEnd' && this.phase !== 'matchEnd' && p.equipT <= 0 && p.reloadT <= 0 && !planting;
    if (c.fire && canFire && p.fireCd <= 0 && (def.auto || !p.firePrev)) this.fire(p, def);
    p.firePrev = c.fire;

    // use (plant / defuse)
    this.stepUse(p, dt);
  }

  private switchTo(p: Player, slot: number) {
    if (p.reloadT > 0) p.reloadT = 0;
    p.cur = slot; const w = this.currentWeapon(p); p.equipT = w.equipTime; p.spray = 0;
    this.events.push({ t: 'equip', id: p.id, w: w.id });
  }

  private startReload(p: Player) {
    const def = this.currentWeapon(p); const a = p.ammo[def.id]!;
    if (def.slot === 'melee' || p.reloadT > 0 || a.mag >= def.mag || a.reserve <= 0) return;
    p.reloadT = def.reloadTime; p.reloadAt = this.time;
    this.events.push({ t: 'reload', id: p.id });
  }

  private finishReload(p: Player) {
    const def = this.currentWeapon(p); const a = p.ammo[def.id]!;
    const need = def.mag - a.mag; const take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
  }

  private fire(p: Player, def: WeaponDef) {
    const a = p.ammo[def.id]!;
    if (def.slot !== 'melee' && a.mag <= 0) { p.fireCd = 0.25; this.events.push({ t: 'dry', id: p.id }); return; }
    p.fireCd = 60 / def.rpm;
    p.firedAt = this.time; p.lastShot = this.time;
    if (def.slot !== 'melee') a.mag--;
    const ox = p.m.x, oy = p.m.y + eyeHeight(p.m), oz = p.m.z;

    if (def.slot === 'melee') {
      const yaw = p.yaw, pit = p.pitch;
      const dx = -Math.sin(yaw) * Math.cos(pit), dy = Math.sin(pit), dz = -Math.cos(yaw) * Math.cos(pit);
      const st = this.world.raycast(ox, oy, oz, dx, dy, dz, def.range);
      const ph = this.rayPlayers(p, ox, oy, oz, dx, dy, dz, st ? Math.min(st.t, def.range) : def.range);
      if (ph) {
        const v = ph.player;
        const behind = Math.cos(v.yaw - p.yaw) > 0.4;
        this.hurt(p, v, def.damage * (behind ? 2.6 : 1), false, def, ph.t);
        this.events.push({ t: 'shot', id: p.id, w: def.id, ox, oy, oz, dx, dy, dz, hx: ox + dx * ph.t, hy: oy + dy * ph.t, hz: oz + dz * ph.t, hit: 'player', nx: -dx, ny: -dy, nz: -dz });
      } else if (st) {
        this.events.push({ t: 'shot', id: p.id, w: def.id, ox, oy, oz, dx, dy, dz, hx: ox + dx * st.t, hy: oy + dy * st.t, hz: oz + dz * st.t, hit: 'world', nx: st.nx, ny: st.ny, nz: st.nz });
      }
      return;
    }

    // spread
    const moveFrac = Math.min(1, p.speed / PLAYER.runSpeed);
    let spread = def.spreadBase + def.spreadMove * moveFrac * moveFrac;
    if (!p.m.onGround) spread += def.spreadJump;
    if (p.m.crouching) spread *= def.crouchMul;
    spread *= 1 + Math.min(p.spray, 12) * 0.035;
    const aiming = p.cmd.aim && p.reloadT <= 0 && p.equipT <= 0;
    if (aiming) spread *= AIM.spreadMul;

    const va = viewAngles(p.yaw, p.pitch, p.punchY, p.punchP);
    const baseYaw = va.yaw, basePitch = va.pitch;
    for (let k = 0; k < def.pellets; k++) {
      const ang = spread * DEG * Math.sqrt(this.rng()), phi = this.rng() * Math.PI * 2;
      const yaw = baseYaw + ang * Math.cos(phi), pit = basePitch + ang * Math.sin(phi);
      const dx = -Math.sin(yaw) * Math.cos(pit), dy = Math.sin(pit), dz = -Math.cos(yaw) * Math.cos(pit);
      const st = this.world.raycast(ox, oy, oz, dx, dy, dz, def.range);
      const maxT = st ? st.t : def.range;
      const ph = this.rayPlayers(p, ox, oy, oz, dx, dy, dz, maxT);
      if (ph) {
        const dmg = def.damage * falloffMul(def, ph.t);
        this.hurt(p, ph.player, dmg * (ph.head ? def.headMul : ph.legs ? 0.75 : 1), ph.head, def, ph.t);
        this.events.push({ t: 'shot', id: p.id, w: def.id, ox, oy, oz, dx, dy, dz, hx: ox + dx * ph.t, hy: oy + dy * ph.t, hz: oz + dz * ph.t, hit: 'player', nx: -dx, ny: -dy, nz: -dz });
      } else if (st) {
        this.events.push({ t: 'shot', id: p.id, w: def.id, ox, oy, oz, dx, dy, dz, hx: ox + dx * st.t, hy: oy + dy * st.t, hz: oz + dz * st.t, hit: 'world', nx: st.nx, ny: st.ny, nz: st.nz });
      } else {
        this.events.push({ t: 'shot', id: p.id, w: def.id, ox, oy, oz, dx, dy, dz, hx: ox + dx * def.range, hy: oy + dy * def.range, hz: oz + dz * def.range, hit: 'none', nx: 0, ny: 1, nz: 0 });
      }
    }
    // recoil: pattern climbs then drifts sideways
    p.spray++;
    const kick = def.kick * (1 + Math.min(p.spray, 10) * 0.05) * (aiming ? AIM.kickMul : 1);
    p.punchP = Math.min(12, p.punchP + kick);
    p.punchY += def.kickYaw * Math.sin(p.spray * 1.7 + (p.id % 3)) ;
    this.noises.push({ x: ox, z: oz, t: this.time, squad: p.squad, loud: 3 });
  }

  /** ray vs player AABBs. returns nearest within maxT */
  private rayPlayers(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): { player: Player; t: number; head: boolean; legs: boolean } | null {
    let best: { player: Player; t: number; head: boolean; legs: boolean } | null = null;
    for (const v of this.players.values()) {
      if (!v.alive || v.id === shooter.id) continue;
      if (!RULES.friendlyFire && v.team === shooter.team) continue;
      const h = playerHeight(v.m), r = PLAYER.radius;
      const rw = this.lagComp ? this.lagComp(shooter, v) : null;
      const vx = rw ? rw.x : v.m.x, vy = rw ? rw.y : v.m.y, vz = rw ? rw.z : v.m.z;
      const min = [vx - r, vy, vz - r], max = [vx + r, vy + h, vz + r];
      let t0 = 0, t1 = maxT, ok = true;
      const o = [ox, oy, oz], d = [dx, dy, dz];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]!) < 1e-9) { if (o[i]! < min[i]! || o[i]! > max[i]!) ok = false; }
        else {
          let a = (min[i]! - o[i]!) / d[i]!, b = (max[i]! - o[i]!) / d[i]!;
          if (a > b) { const tmp = a; a = b; b = tmp; }
          if (a > t0) t0 = a; if (b < t1) t1 = b;
          if (t0 > t1) ok = false;
        }
      }
      if (!ok) continue;
      if (!best || t0 < best.t) {
        const hy = oy + dy * t0 - vy;
        best = { player: v, t: t0, head: hy > h - 0.27, legs: hy < 0.55 };
      }
    }
    return best;
  }

  private hurt(a: Player, v: Player, dmgIn: number, head: boolean, def: WeaponDef, _dist: number) {
    if (!v.alive || (this.phase !== 'live' && this.phase !== 'freeze' && this.phase !== 'warmup')) return;
    if (this.phase === 'freeze') return;
    let hpDmg = dmgIn;
    if (v.armor > 0 && (!head || v.helmet)) {
      hpDmg = dmgIn * def.armorPen;
      v.armor = Math.max(0, v.armor - Math.round(dmgIn * (1 - def.armorPen) * 0.5));
    }
    hpDmg = Math.max(1, Math.round(hpDmg));
    v.hp -= hpDmg; v.hurtAt = this.time; v.lastHurt = { x: a.m.x, z: a.m.z, t: this.time };
    a.dmgTo[v.id] = (a.dmgTo[v.id] ?? 0) + hpDmg;
    const killed = v.hp <= 0;
    this.events.push({ t: 'hit', a: a.id, v: v.id, dmg: hpDmg, head, killed });
    if (killed) this.kill(a, v, def, head);
  }

  private damageRaw(v: Player, dmg: number, attackerId: number) {
    if (!v.alive || dmg <= 0 || this.phase !== 'live') return;
    v.hp -= dmg; v.hurtAt = this.time;
    this.events.push({ t: 'hit', a: attackerId, v: v.id, dmg, head: false, killed: v.hp <= 0 });
    if (v.hp <= 0) this.kill(null, v, WEAPONS.knife, false);
  }

  private kill(a: Player | null, v: Player, def: WeaponDef, head: boolean) {
    v.alive = false; v.hp = 0; v.deaths++; v.diedAt = this.time; v.using = 'none'; v.useT = 0;
    if (a && a.id !== v.id && a.team !== v.team) {
      a.kills++; a.roundKills++; a.score += 2; a.money = Math.min(RULES.maxMoney, a.money + def.killReward);
      for (const o of this.players.values()) if (o.id !== a.id && o.team === a.team && (o.dmgTo[v.id] ?? 0) >= 40) { o.assists++; o.score++; }
    } else if (a && a.team === v.team && a.id !== v.id) { a.score -= 1; }
    if (v.hasDevice) this.dropDevice(v);
    this.events.push({ t: 'kill', a: a?.id ?? -1, v: v.id, w: def.id, head });
  }

  // ------------------------------------------------------------------ objective
  private dropDevice(p: Player) {
    p.hasDevice = false;
    this.bomb = { ...this.bomb, state: 'dropped', x: p.m.x, y: p.m.y, z: p.m.z, carrier: -1 };
    this.events.push({ t: 'deviceDropped', x: p.m.x, z: p.m.z });
  }

  private siteAt(x: number, z: number): 'A' | 'B' | null {
    for (const s of this.map.sites) if (Math.hypot(x - s.x, z - s.z) <= s.radius) return s.id;
    return null;
  }

  private stepUse(p: Player, dt: number) {
    if (this.mode !== 'objective' || this.phase !== 'live') { if (p.using !== 'none') this.cancelUse(p); return; }
    const c = p.cmd;
    // pick up a dropped device by walking over it
    if (this.bomb.state === 'dropped' && p.team === VANGUARD && Math.hypot(p.m.x - this.bomb.x, p.m.z - this.bomb.z) < 1.2) {
      p.hasDevice = true; this.bomb = { ...this.bomb, state: 'carried', carrier: p.id };
      this.events.push({ t: 'devicePicked', id: p.id });
    }
    const stationary = p.speed < 0.6 && p.m.onGround;
    if (c.use) {
      if (p.team === VANGUARD && p.hasDevice && this.bomb.state === 'carried' && this.siteAt(p.m.x, p.m.z) && stationary) {
        if (p.using !== 'plant') { p.using = 'plant'; p.useT = 0; this.events.push({ t: 'plantStart', id: p.id }); }
        p.useT += dt;
        if (p.useT >= RULES.plantTime) {
          const site = this.siteAt(p.m.x, p.m.z)!;
          p.hasDevice = false; p.using = 'none'; p.useT = 0;
          this.bomb = { state: 'planted', x: p.m.x, y: p.m.y, z: p.m.z, site, timeLeft: RULES.deviceTimer, carrier: -1 };
          p.score += 3;
          this.events.push({ t: 'planted', id: p.id, site });
        }
        return;
      }
      if (p.team === GARRISON && this.bomb.state === 'planted' && Math.hypot(p.m.x - this.bomb.x, p.m.z - this.bomb.z) < 2.0 && stationary) {
        if (p.using !== 'defuse') { p.using = 'defuse'; p.useT = 0; this.events.push({ t: 'defuseStart', id: p.id }); }
        p.useT += dt;
        if (p.useT >= (p.kit ? RULES.defuseTimeKit : RULES.defuseTime)) {
          p.using = 'none'; p.useT = 0; this.bomb.state = 'defused'; p.score += 3;
          this.events.push({ t: 'defused', id: p.id });
        }
        return;
      }
    }
    if (p.using !== 'none') this.cancelUse(p);
  }

  private cancelUse(p: Player) {
    this.events.push({ t: p.using === 'plant' ? 'plantCancel' : 'defuseCancel', id: p.id });
    p.using = 'none'; p.useT = 0;
  }

  private stepDevice(dt: number) {
    if (this.bomb.state === 'planted' && this.phase === 'live') {
      this.bomb.timeLeft -= dt;
      // an active defuse pauses nothing (hard limit), the device simply explodes at 0
      if (this.bomb.timeLeft <= 0) { this.bomb.state = 'exploded'; this.events.push({ t: 'exploded' }); }
    }
  }

  // ------------------------------------------------------------------ economy
  canBuy(p: Player): boolean {
    if (!p.alive) return false;
    if (this.phase === 'freeze' || this.phase === 'warmup') return true;
    if (this.phase === 'live' && this.phaseElapsed < RULES.buyWindowLive) {
      const list = p.team === VANGUARD ? this.map.spawns.vanguard : this.map.spawns.garrison;
      return list.some((s) => Math.hypot(p.m.x - s.x, p.m.z - s.z) < 14);
    }
    return false;
  }

  buy(playerId: number, itemId: string): { ok: boolean; reason?: string } {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, reason: 'no such player' };
    const item = BUY_ITEMS.find((i) => i.id === itemId);
    if (!item) return { ok: false, reason: 'unknown item' };
    if (!this.canBuy(p)) return { ok: false, reason: 'buy time is over' };
    if (item.team && (item.team === 'vanguard' ? VANGUARD : GARRISON) !== p.team) return { ok: false, reason: 'not available to your team' };
    if (p.money < item.price) return { ok: false, reason: 'not enough money' };
    if (item.kind === 'armor') { if (p.armor >= 100 && p.helmet) return { ok: false, reason: 'already armored' }; p.armor = 100; p.helmet = true; }
    else if (item.kind === 'kit') { if (p.kit) return { ok: false, reason: 'already have one' }; p.kit = true; }
    else if (item.weapon) {
      const w = WEAPONS[item.weapon];
      const slot = w.slot === 'primary' ? 0 : w.slot === 'secondary' ? 1 : 2;
      if (p.slots[slot] === w.id) return { ok: false, reason: 'already carrying it' };
      p.slots[slot] = w.id; p.ammo[w.id] = { mag: w.mag, reserve: w.reserve };
      if (p.cur !== slot) { p.cur = slot; p.equipT = w.equipTime; }
    }
    p.money -= item.price;
    this.events.push({ t: 'buy', id: p.id, item: item.id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ helpers
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  /** For tests / tools: jump straight into the live phase. */
  forceLive() { if (this.phase === 'freeze') { this.phaseT = 0; } }
}

function frozenSwitchBlock(sim: GameSim, p: Player): boolean { return p.using !== 'none' && sim.phase === 'live'; }
