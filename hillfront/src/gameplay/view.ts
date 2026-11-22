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
  for (const id of [...v.players.keys()]) if (!sim.players.has(id)) v.players.delete(id);
  for (const p of sim.players.values()) {
    let vp = v.players.get(p.id);
    if (!vp) {
      vp = {} as ViewPlayer; v.players.set(p.id, vp);
    }
    const w = p.slots[p.cur] ?? 'knife'; const a = p.ammo[w] ?? { mag: 0, reserve: 0 };
    vp.id = p.id; vp.name = p.name; vp.squad = p.squad; vp.team = p.team; vp.bot = p.bot; vp.alive = p.alive;
    vp.x = p.m.x; vp.y = p.m.y; vp.z = p.m.z; vp.yaw = p.yaw; vp.pitch = p.pitch; vp.crouching = p.m.crouching; vp.onGround = p.m.onGround; vp.speed = p.speed;
    vp.hp = p.hp; vp.armor = p.armor; vp.helmet = p.helmet; vp.kit = p.kit; vp.money = p.money;
    vp.weapon = w; vp.slots = p.slots; vp.cur = p.cur; vp.mag = a.mag; vp.reserve = a.reserve; vp.reloading = p.reloadT > 0; vp.reloadT = p.reloadT; vp.equipT = p.equipT;
    vp.kills = p.kills; vp.deaths = p.deaths; vp.assists = p.assists; vp.score = p.score;
    vp.hasDevice = p.hasDevice; vp.using = p.using; vp.useT = p.useT;
    vp.firedAt = p.firedAt; vp.reloadAt = p.reloadAt; vp.hurtAt = p.hurtAt; vp.diedAt = p.diedAt;
    vp.punchP = p.punchP; vp.punchY = p.punchY; vp.spray = p.spray; vp.ping = p.ping; vp.lastHurt = p.lastHurt;
  }
}

export type { SimEvent };
