/**
 * A GameSession is whatever produces the ViewState the game renders:
 *  - LocalSession: the in-browser GameSim (offline practice vs bots, no server needed)
 *  - NetSession:   a remote authoritative match (server snapshots + client-side prediction of the local player only)
 */
import { GameSim, emptyCmd, RULES, AIM, type Cmd, type SimEvent } from '../gameplay/sim.ts';
import { syncFromSim, emptyView, type ViewState, type ViewPlayer } from '../gameplay/view.ts';
import { stepMovement, newMoveState, type MoveState, type MoveInput } from '../gameplay/movement.ts';
import { WEAPONS, type WeaponId } from '../gameplay/weapons.ts';
import type { World } from '../map/world.ts';
import type { NetClient } from '../network/client.ts';
import type { Snapshot, SnapPlayer, WireCmd } from '../network/protocol.ts';

export interface GameSession {
  readonly kind: 'local' | 'net';
  readonly localId: number;
  readonly view: ViewState;
  readonly world: World;
  advance(dt: number, paused: boolean): void;
  sync(): void;
  drainEvents(): SimEvent[];
  setCmd(cmd: Cmd): void;
  buy(item: string): { ok: boolean; reason?: string };
  canBuy(): boolean;
  /** latency shown in the HUD (ms) */
  readonly latency: number;
  dispose(): void;
  /** voluntarily leave an online match (no-op offline) */
  leave?(): void;
}

// ============================================================================================= local
export class LocalSession implements GameSession {
  readonly kind = 'local' as const;
  readonly view: ViewState = emptyView();
  latency = 0;
  constructor(readonly sim: GameSim, readonly localId: number) { this.sync(); }
  get world() { return this.sim.world; }
  advance(dt: number, paused: boolean) { if (!paused) this.sim.advance(dt); }
  sync() { syncFromSim(this.sim, this.view, this.localId); }
  drainEvents() { return this.sim.drainEvents(); }
  setCmd(cmd: Cmd) { const p = this.sim.players.get(this.localId); if (p) p.cmd = cmd; }
  buy(item: string) { return this.sim.buy(this.localId, item); }
  canBuy() { const p = this.sim.players.get(this.localId); return !!p && this.sim.canBuy(p); }
  dispose() { /* nothing to release */ }
}

// ============================================================================================= net
const STEP = 1 / RULES.tickRate;
const INTERP = 0.1;

const toWire = (c: Cmd): WireCmd => ({ fwd: c.fwd, strafe: c.strafe, jump: c.jump, crouch: c.crouch, walk: c.walk, yaw: c.yaw, pitch: c.pitch, fire: c.fire, reload: c.reload, use: c.use, slot: c.slot, aim: c.aim });

interface TimedSnap { s: Snapshot; recv: number; }

export class NetSession implements GameSession {
  readonly kind = 'net' as const;
  readonly view: ViewState = emptyView();
  private snaps: TimedSnap[] = [];
  private events: SimEvent[] = [];
  private seq = 0;
  private pending: { seq: number; cmd: WireCmd }[] = [];
  private pred: MoveState = newMoveState(0, 0.1, 0);
  private prevPred = { x: 0, y: 0.1, z: 0 };
  /** reconciliation error still to be absorbed (metres); decays so snapshot corrections glide instead of snapping */
  private corr = { x: 0, y: 0, z: 0 };
  private predValid = false;
  private acc = 0;
  private latest: Cmd = emptyCmd();
  private offset = 0; private haveOffset = false;
  private unsub: (() => void)[] = [];
  private localWeapon: WeaponId = 'p50';
  private alive = false; private frozen = false; private busy = false;
  private myNames = new Map<number, string>();
  /** correction applied on the last snapshot (metres), for diagnostics */
  lastCorrection = 0;

  constructor(private net: NetClient, readonly localId: number, readonly world: World, mode: ViewState['mode'], private squad: 0 | 1) {
    this.view.mode = mode; this.view.localId = localId;
    this.unsub.push(net.on('snap', (m) => this.onSnap(m.s)));
    this.unsub.push(net.on('ev', (m) => { for (const e of m.e as SimEvent[]) this.events.push(e); if (this.events.length > 400) this.events.splice(0, 200); }));
  }
  get latency() { return this.net.rtt; }
  leave() { this.net.send({ t: 'match.leave' }); }
  dispose() { for (const u of this.unsub) u(); this.unsub = []; }

  setCmd(cmd: Cmd) { this.latest = cmd; }
  buy(item: string) { this.net.send({ t: 'match.buy', item }); return { ok: true }; }
  canBuy() { return this.view.phase === 'freeze' || (this.view.phase === 'live' && this.view.phaseElapsed < RULES.buyWindowLive); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------------------------------------------------------------- fixed 60 Hz command stream + prediction
  advance(dt: number, _paused: boolean) {
    const kc = Math.exp(-dt / 0.12); this.corr.x *= kc; this.corr.y *= kc; this.corr.z *= kc;
    this.acc += Math.min(dt, 0.2);
    let n = 0;
    while (this.acc >= STEP && n < 6) { this.acc -= STEP; n++; this.fixedStep(); }
    if (n === 6) this.acc = 0;
  }

  private fixedStep() {
    const cmd = this.alive ? this.latest : { ...this.latest, fire: false, jump: false, fwd: 0, strafe: 0 };
    const wire = toWire(cmd);
    const seq = ++this.seq;
    this.net.send({ t: 'match.cmd', seq, cmd: wire, view: 0 });
    // the cmd's one-shot fields (reload / slot) were consumed by this packet
    this.latest.reload = false; this.latest.slot = -1;
    if (!this.alive || !this.predValid) return;
    this.pending.push({ seq, cmd: wire }); if (this.pending.length > 120) this.pending.shift();
    this.prevPred.x = this.pred.x; this.prevPred.y = this.pred.y; this.prevPred.z = this.pred.z;
    this.predictStep(wire);
  }

  private predictStep(c: WireCmd) {
    const blocked = this.frozen || this.busy;
    const inp: MoveInput = { fwd: blocked ? 0 : c.fwd, strafe: blocked ? 0 : c.strafe, jump: !blocked && c.jump, crouch: c.crouch, walk: c.walk, yaw: c.yaw };
    stepMovement(this.world, this.pred, inp, STEP, WEAPONS[this.localWeapon].moveMul * (c.aim && WEAPONS[this.localWeapon].slot !== 'melee' ? AIM.moveMul : 1));
  }

  // ---------------------------------------------------------------- snapshots
  private onSnap(s: Snapshot) {
    const now = performance.now() / 1000;
    const off = s.time - now;
    if (!this.haveOffset) { this.offset = off; this.haveOffset = true; } else this.offset += (off - this.offset) * 0.1;
    this.snaps.push({ s, recv: now }); if (this.snaps.length > 12) this.snaps.shift();

    const me = s.p.find((p) => p.i === this.localId);
    if (!me) return;
    this.alive = (me.f & 1) !== 0; this.frozen = s.phase === 'freeze'; this.busy = (me.f & 96) !== 0;
    this.localWeapon = (me.w as WeaponId) in WEAPONS ? (me.w as WeaponId) : 'p50';
    if (!this.alive || !s.me) { this.pred = newMoveState(me.x, me.y, me.z); this.prevPred = { x: me.x, y: me.y, z: me.z }; this.corr = { x: 0, y: 0, z: 0 }; this.predValid = this.alive; this.pending = []; return; }
    // reconcile: authoritative state, then replay every command the server has not applied yet
    const before = this.predValid ? { x: this.pred.x, y: this.pred.y, z: this.pred.z } : null;
    const m = newMoveState(me.x, me.y, me.z);
    m.vx = s.me.vx; m.vy = s.me.vy; m.vz = s.me.vz; m.onGround = s.me.ground === 1; m.crouching = (me.f & 2) !== 0; m.jumpCooldown = s.me.jc;
    this.pred = m; this.predValid = true;
    this.pending = this.pending.filter((p) => p.seq > s.ack);
    for (const p of this.pending) this.predictStep(p.cmd);
    if (before) {
      const ex = before.x - this.pred.x, ey = before.y - this.pred.y, ez = before.z - this.pred.z;
      this.lastCorrection = Math.hypot(-ex, -ez);
      // small errors are absorbed visually over ~0.12 s; a big one (teleport / respawn) snaps
      if (Math.hypot(ex, ey, ez) < 1.2) { this.corr.x += ex; this.corr.y += ey; this.corr.z += ez; } else this.corr = { x: 0, y: 0, z: 0 };
    } else this.corr = { x: 0, y: 0, z: 0 };
    this.prevPred = { x: this.pred.x, y: this.pred.y, z: this.pred.z };
  }

  // ---------------------------------------------------------------- view construction
  sync() {
    const v = this.view; const last = this.snaps[this.snaps.length - 1]; if (!last) return;
    const s = last.s;
    const renderT = performance.now() / 1000 + this.offset - INTERP;
    // bracket renderT
    let a = this.snaps[0]!, b = last;
    for (let i = this.snaps.length - 1; i > 0; i--) { if (this.snaps[i - 1]!.s.time <= renderT) { a = this.snaps[i - 1]!; b = this.snaps[i]!; break; } }
    const span = b.s.time - a.s.time; const k = span > 1e-4 ? Math.min(1.2, Math.max(0, (renderT - a.s.time) / span)) : 1;

    v.time = Math.min(s.time, Math.max(a.s.time, renderT)); v.phase = s.phase as ViewState['phase']; v.phaseT = s.phaseT; v.phaseElapsed = s.phaseE; v.round = s.round; v.mode = s.mode;
    v.score = s.score; v.swapped = s.swapped; v.localId = this.localId; v.lossStreak = s.ls; v.matchWinnerSquad = (s.mw as 0 | 1 | null);
    v.bomb = { state: s.bomb.s as ViewState['bomb']['state'], x: s.bomb.x, y: s.bomb.y, z: s.bomb.z, site: s.bomb.site as 'A' | 'B' | null, timeLeft: s.bomb.tl, carrier: s.bomb.c };
    v.lastWinner = s.win ? { winner: s.win.w as 0 | 1 | null, reason: s.win.r } : null;

    const seen = new Set<number>();
    for (const pb of b.s.p) {
      seen.add(pb.i);
      const pa = a.s.p.find((x) => x.i === pb.i) ?? pb;
      let vp = v.players.get(pb.i); if (!vp) { vp = {} as ViewPlayer; v.players.set(pb.i, vp); }
      const lerp = (x: number, y: number) => x + (y - x) * k;
      const yaw = lerpAngle(pa.r, pb.r, k);
      fill(vp, pb, lerp(pa.x, pb.x), lerp(pa.y, pb.y), lerp(pa.z, pb.z), yaw, lerp(pa.q, pb.q));
      this.myNames.set(pb.i, pb.n);
      if (pb.i === this.localId) {
        // the local player is predicted, not interpolated
        if (this.predValid && (pb.f & 1)) { const al = Math.min(1, this.acc / STEP); vp.x = this.prevPred.x + (this.pred.x - this.prevPred.x) * al + this.corr.x; vp.y = this.prevPred.y + (this.pred.y - this.prevPred.y) * al + this.corr.y; vp.z = this.prevPred.z + (this.pred.z - this.prevPred.z) * al + this.corr.z; vp.speed = Math.hypot(this.pred.vx, this.pred.vz); vp.onGround = this.pred.onGround; vp.crouching = this.pred.crouching; }
        const me = s.me;
        if (me) {
          vp.money = me.money; vp.mag = me.mag; vp.reserve = me.res; vp.slots = me.slots as (WeaponId | null)[]; vp.reloadT = me.reloadT; vp.equipT = me.equipT; vp.useT = me.useT; vp.spray = me.spray; vp.punchP = me.punchP; vp.punchY = me.punchY;
          vp.reloading = me.reloadT > 0;
        }
      }
    }
    for (const id of [...v.players.keys()]) if (!seen.has(id)) v.players.delete(id);
  }
}

function lerpAngle(a: number, b: number, k: number) { let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * k; }

function fill(vp: ViewPlayer, p: SnapPlayer, x: number, y: number, z: number, yaw: number, pitch: number) {
  vp.id = p.i; vp.name = p.n; vp.squad = p.sq; vp.team = p.tm; vp.bot = !!p.bot; vp.alive = (p.f & 1) !== 0;
  vp.x = x; vp.y = y; vp.z = z; vp.yaw = yaw; vp.pitch = pitch; vp.crouching = (p.f & 2) !== 0; vp.onGround = (p.f & 4) !== 0; vp.speed = p.v;
  vp.hp = p.hp; vp.armor = p.ar; vp.helmet = (p.f & 128) !== 0; vp.kit = (p.f & 256) !== 0; vp.money = p.m ?? 0;
  vp.weapon = ((p.w in WEAPONS) ? p.w : 'knife') as WeaponId; vp.cur = p.cur; if (!vp.slots) vp.slots = [null, null, null];
  vp.mag = vp.mag ?? 0; vp.reserve = vp.reserve ?? 0; vp.reloading = (p.f & 8) !== 0; vp.reloadT = 0; vp.equipT = 0;
  vp.kills = p.k; vp.deaths = p.d; vp.assists = p.a; vp.score = p.sc;
  vp.hasDevice = (p.f & 16) !== 0; vp.using = (p.f & 32) ? 'plant' : (p.f & 64) ? 'defuse' : 'none'; vp.useT = p.ru;
  vp.firedAt = p.fa; vp.reloadAt = p.ra; vp.hurtAt = p.ha; vp.diedAt = p.da; vp.punchP = p.pc; vp.punchY = p.pp; vp.spray = 0; vp.ping = 0; vp.lastHurt = null;
}
