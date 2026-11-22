/**
 * ViewState: what renderers / HUD / audio read. Filled from the local GameSim (offline) or from server snapshots (online).
 * Keeping renderers on this plain structure means one rendering path for both modes.
 */
import type { GameSim, Phase, Mode, Team, Bomb, SimEvent } from './sim.ts';
import type { WeaponId } from './weapons.ts';

export interface ViewPlayer {
  id: number; name: string; squad: 0 | 1; team: Team; bot: boolean;
  alive: boolean;
  x: number; y: number; z: number; yaw: number; pitch: number;
  crouching: boolean; onGround: boolean; speed: number;
  hp: number; armor: number; helmet: boolean; kit: boolean; money: number;
  weapon: WeaponId; slots: (WeaponId | null)[]; cur: number;
  mag: number; reserve: number; reloading: boolean; reloadT: number; equipT: number;
  kills: number; deaths: number; assists: number; score: number;
  hasDevice: boolean; using: 'none' | 'plant' | 'defuse'; useT: number;
  firedAt: number; reloadAt: number; hurtAt: number; diedAt: number;
  punchP: number; punchY: number; spray: number;
  ping: number;
  lastHurt: { x: number; z: number; t: number } | null;
}

export interface ViewState {
  time: number;
  phase: Phase; phaseT: number; phaseElapsed: number; round: number; mode: Mode;
  score: [number, number]; swapped: boolean;
  bomb: Bomb;
  players: Map<number, ViewPlayer>;
  localId: number;
  lastWinner: { winner: Team | null; reason: string } | null;
  matchWinnerSquad: 0 | 1 | null;
  lossStreak: [number, number];
}

export function emptyView(): ViewState {
  return {
    time: 0, phase: 'warmup', phaseT: 0, phaseElapsed: 0, round: 0, mode: 'objective', score: [0, 0], swapped: false,
    bomb: { state: 'none', x: 0, y: 0, z: 0, site: null, timeLeft: 0, carrier: -1 }, players: new Map(), localId: -1,
    lastWinner: null, matchWinnerSquad: null, lossStreak: [0, 0],
  };
}

/** copy the live sim into a ViewState (re-using ViewPlayer objects: no per-frame allocation after the first frame) */
export function syncFromSim(sim: GameSim, v: ViewState, localId: number): void {
  v.time = sim.time; v.phase = sim.phase; v.phaseT = sim.phaseT; v.phaseElapsed = sim.phaseElapsed; v.round = sim.round; v.mode = sim.mode;
  v.score = sim.score; v.swapped = sim.swapped; v.bomb = sim.bomb; v.localId = localId; v.lastWinner = sim.lastWinner; v.matchWinnerSquad = sim.matchWinnerSquad; v.lossStreak = sim.lossStreak;
  const alpha = sim.renderAlpha;
  for (const id of [...v.players.keys()]) if (!sim.players.has(id)) v.players.delete(id);
  for (const p of sim.players.values()) {
    let vp = v.players.get(p.id);
    if (!vp) {
      vp = {} as ViewPlayer; v.players.set(p.id, vp);
    }
    const w = p.slots[p.cur] ?? 'knife'; const a = p.ammo[w] ?? { mag: 0, reserve: 0 };
    vp.id = p.id; vp.name = p.name; vp.squad = p.squad; vp.team = p.team; vp.bot = p.bot; vp.alive = p.alive;
    // the sim ticks at a fixed 60 Hz but the screen does not: show the pose BETWEEN the last two ticks (otherwise motion steps unevenly and reads as judder / shake)
    const dx = p.m.x - p.prev.x, dy = p.m.y - p.prev.y, dz = p.m.z - p.prev.z;
    const k = p.alive && dx * dx + dz * dz < 4 && Math.abs(dy) < 1.5 ? alpha : 1;      // teleports (spawn) snap
    let dyaw = p.yaw - p.prev.yaw; dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    vp.x = p.prev.x + dx * k; vp.y = p.prev.y + dy * k; vp.z = p.prev.z + dz * k; vp.yaw = p.prev.yaw + dyaw * k; vp.pitch = p.prev.pitch + (p.pitch - p.prev.pitch) * k; vp.crouching = p.m.crouching; vp.onGround = p.m.onGround; vp.speed = p.speed;
    vp.hp = p.hp; vp.armor = p.armor; vp.helmet = p.helmet; vp.kit = p.kit; vp.money = p.money;
    vp.weapon = w; vp.slots = p.slots; vp.cur = p.cur; vp.mag = a.mag; vp.reserve = a.reserve; vp.reloading = p.reloadT > 0; vp.reloadT = p.reloadT; vp.equipT = p.equipT;
    vp.kills = p.kills; vp.deaths = p.deaths; vp.assists = p.assists; vp.score = p.score;
    vp.hasDevice = p.hasDevice; vp.using = p.using; vp.useT = p.useT;
    vp.firedAt = p.firedAt; vp.reloadAt = p.reloadAt; vp.hurtAt = p.hurtAt; vp.diedAt = p.diedAt;
    vp.punchP = p.punchP; vp.punchY = p.punchY; vp.spray = p.spray; vp.ping = p.ping; vp.lastHurt = p.lastHurt;
  }
}

export type { SimEvent };
