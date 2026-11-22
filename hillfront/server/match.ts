/**
 * MatchRunner: one authoritative GameSim hosted on the server.
 *  - exactly ONE queued client command is consumed per human per tick (clients cannot speed-hack),
 *  - clients never send state; position / health / ammo / score / money exist only here,
 *  - 20 Hz snapshots, private fields only to their owner,
 *  - hit tests are lag-compensated by rewinding victims by the shooter's latency (capped),
 *  - a disconnected player is taken over by a bot and can resume.
 */
import { GameSim, RULES, emptyCmd, type Player, type SimEvent } from '../src/gameplay/sim.ts';
import { fillWithBots, makeBot } from '../src/gameplay/bots.ts';
import { LIMITS, type Snapshot, type SnapPlayer, type WireCmd } from '../src/network/protocol.ts';
import { WEAPONS, type WeaponId } from '../src/gameplay/weapons.ts';
import type { Session } from './session.ts';
import type { Hub } from './hub.ts';
import type { Mode } from '../src/gameplay/sim.ts';

export interface MatchSpec { mode: Mode; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard'; humans: { s: Session; squad: 0 | 1 }[]; }

interface Human { s: Session; pid: number; squad: 0 | 1; queue: { seq: number; cmd: WireCmd }[]; ack: number; last: WireCmd; left: boolean; }

const TICK = 1 / RULES.tickRate;
const SNAP_EVERY = 3;
const HIST_TICKS = 36;

export class MatchRunner {
  readonly sim: GameSim;
  readonly humans = new Map<number, Human>();   // by session id
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0; private last = performance.now(); private tickN = 0;
  private hist: { t: number; pos: Map<number, { x: number; y: number; z: number }> }[] = [];
  private emptySince = 0;
  private ending = false;
  ended = false;
  readonly seed: number;

  constructor(private hub: Hub, readonly id: number, readonly spec: MatchSpec) {
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.sim = new GameSim({ mode: spec.mode, seed: this.seed, skipWarmup: true });
    // humans on their chosen squads
    for (const h of spec.humans) {
      const p = this.sim.addPlayer(h.s.name, h.squad, false);
      this.humans.set(h.s.id, { s: h.s, pid: p.id, squad: h.squad, queue: [], ack: 0, last: toWire(emptyCmd()), left: false });
      h.s.matchId = id; h.s.status = 'match'; h.s.lobbyId = null;
    }
    if (spec.fillBots) fillWithBots(this.sim, spec.perTeam, spec.difficulty);
    this.sim.lagComp = (shooter, victim) => this.rewind(shooter, victim);
    this.sim.round = 0; (this.sim as unknown as { beginRound(): void }).beginRound();
    for (const h of this.humans.values()) this.sendStart(h);
    this.timer = setInterval(() => this.pump(), 8);
  }

  private sendStart(h: Human, resumed = false) {
    h.s.send({ t: 'match.start', matchId: this.id, you: h.pid, squad: h.squad, mode: this.spec.mode, seed: this.seed, tickRate: RULES.tickRate });
    void resumed;
  }

  // ------------------------------------------------------------------ inbound
  cmd(s: Session, seq: number, cmd: WireCmd) {
    const h = this.humans.get(s.id); if (!h || h.left) return;
    if (!Number.isFinite(seq)) return;
    if (h.queue.length >= LIMITS.cmdQueueMax) h.queue.shift();
    h.queue.push({ seq, cmd });
  }
  buy(s: Session, item: string) {
    const h = this.humans.get(s.id); if (!h || h.left) return;
    const r = this.sim.buy(h.pid, item);
    if (!r.ok) s.send({ t: 'notice', text: r.reason ?? 'Cannot buy' });
  }

  // ------------------------------------------------------------------ connection changes
  disconnected(s: Session) {
    const h = this.humans.get(s.id); if (!h) return;
    const p = this.sim.players.get(h.pid); if (!p) return;
    p.connected = false; p.bot = true; this.sim.brains.set(p.id, makeBot(this.spec.difficulty, p.id * 31 + 7));
  }
  reconnected(s: Session) {
    const h = this.humans.get(s.id); if (!h || h.left) return;
    const p = this.sim.players.get(h.pid); if (!p) return;
    p.connected = true; p.bot = false; this.sim.brains.delete(p.id); p.cmd = emptyCmd(); p.cmd.yaw = p.yaw; h.queue = [];
    this.sendStart(h, true);
  }
  /** voluntary leave: a bot keeps the slot so the teams stay balanced */
  leave(s: Session) {
    const h = this.humans.get(s.id); if (!h) return;
    h.left = true;
    const p = this.sim.players.get(h.pid);
    if (p) { p.connected = false; p.bot = true; p.name = `[BOT] ${p.name}`; this.sim.brains.set(p.id, makeBot(this.spec.difficulty, p.id * 31 + 7)); }
    s.matchId = null; s.status = s.partyId ? 'party' : 'online';
    this.hub.afterMatchLeave(s, this);
  }

  // ------------------------------------------------------------------ loop
  private pump() {
    const now = performance.now(); this.acc += Math.min(0.25, (now - this.last) / 1000); this.last = now;
    let steps = 0;
    while (this.acc >= TICK && steps < 6) { this.acc -= TICK; steps++; this.tick(); }
    if (steps === 6) this.acc = 0;
  }

  private tick() {
    this.tickN++;
    // exactly one command per human per tick
    for (const h of this.humans.values()) {
      if (h.left || !h.s.connected) continue;
      const p = this.sim.players.get(h.pid); if (!p) continue;
      const q = h.queue.shift();
      if (q) { h.last = q.cmd; h.ack = q.seq; p.cmd = { ...q.cmd, aim: q.cmd.aim === true }; }
      else { p.cmd = { ...h.last, reload: false, slot: -1, aim: h.last.aim === true }; }
    }
    this.sim.step(TICK);
    // position history for lag compensation
    const pos = new Map<number, { x: number; y: number; z: number }>();
    for (const p of this.sim.players.values()) pos.set(p.id, { x: p.m.x, y: p.m.y, z: p.m.z });
    this.hist.push({ t: this.sim.time, pos }); if (this.hist.length > HIST_TICKS) this.hist.shift();
    const ev = this.sim.drainEvents(); if (ev.length) this.pendingEvents.push(...ev);
    if (this.tickN % SNAP_EVERY === 0) this.broadcast();

    // lifecycle
    const anyHuman = [...this.humans.values()].some((h) => !h.left && h.s.connected);
    if (!anyHuman) { if (!this.emptySince) this.emptySince = Date.now(); else if (Date.now() - this.emptySince > 30_000) this.finish('abandoned'); } else this.emptySince = 0;
    if (this.sim.phase === 'matchEnd' && this.sim.phaseT <= 0 && !this.ending) this.finish('complete');
  }
  private pendingEvents: SimEvent[] = [];

  private rewind(shooter: Player, victim: Player): { x: number; y: number; z: number } | null {
    const h = [...this.humans.values()].find((x) => x.pid === shooter.id);
    if (!h) return null;
    const back = Math.min(0.22, h.s.rtt / 2000 + 0.07);          // half RTT + interpolation delay, capped
    const t = this.sim.time - back;
    for (let i = this.hist.length - 1; i >= 0; i--) { if (this.hist[i]!.t <= t) return this.hist[i]!.pos.get(victim.id) ?? null; }
    return null;
  }

  // ------------------------------------------------------------------ outbound
  private broadcast() {
    const events = this.pendingEvents; this.pendingEvents = [];
    for (const h of this.humans.values()) {
      if (h.left || !h.s.connected) continue;
      if (events.length) h.s.send({ t: 'ev', e: events });
      h.s.send({ t: 'snap', s: this.snapshotFor(h) });
    }
  }

  snapshotFor(h: Human): Snapshot {
    const sim = this.sim; const me = sim.players.get(h.pid);
    const myTeam = me?.team ?? 0;
    const players: SnapPlayer[] = [];
    for (const p of sim.players.values()) {
      const w = p.slots[p.cur] ?? 'knife';
      const f = (p.alive ? 1 : 0) | (p.m.crouching ? 2 : 0) | (p.m.onGround ? 4 : 0) | (p.reloadT > 0 ? 8 : 0) | (p.hasDevice ? 16 : 0) | (p.using === 'plant' ? 32 : 0) | (p.using === 'defuse' ? 64 : 0) | (p.helmet ? 128 : 0) | (p.kit ? 256 : 0) | (p.connected ? 512 : 0);
      const o: SnapPlayer = {
        i: p.id, n: p.name, sq: p.squad, tm: p.team, bot: p.bot ? 1 : 0,
        x: r2(p.m.x), y: r2(p.m.y), z: r2(p.m.z), r: r3(p.yaw), q: r3(p.pitch), v: r2(p.speed), f, hp: Math.ceil(p.hp), ar: Math.ceil(p.armor), w, cur: p.cur,
        k: p.kills, d: p.deaths, a: p.assists, sc: p.score, fa: r2(p.firedAt), ra: r2(p.reloadAt), ha: r2(p.hurtAt), da: r2(p.diedAt), ru: r2(p.useT), pc: r2(p.punchP), pp: r2(p.punchY),
      };
      if (p.team === myTeam) o.m = p.money;
      players.push(o);
    }
    let meSnap: Snapshot['me'] = null;
    if (me) {
      const w = me.slots[me.cur] ?? 'knife'; const a = me.ammo[w] ?? { mag: 0, reserve: 0 };
      const ammo: Record<string, [number, number]> = {}; for (const [k, v] of Object.entries(me.ammo)) ammo[k] = [v!.mag, v!.reserve];
      meSnap = { mag: a.mag, res: a.reserve, slots: me.slots as (string | null)[], money: me.money, reloadT: r2(me.reloadT), equipT: r2(me.equipT), useT: r2(me.useT), vx: r3(me.m.vx), vy: r3(me.m.vy), vz: r3(me.m.vz), jc: r3(me.m.jumpCooldown), ground: me.m.onGround ? 1 : 0, punchP: r3(me.punchP), punchY: r3(me.punchY), spray: r2(me.spray), ammo };
    }
    const b = sim.bomb;
    return {
      tick: this.tickN, time: r3(sim.time), ack: h.ack, phase: sim.phase, phaseT: r2(sim.phaseT), phaseE: r2(sim.phaseElapsed), round: sim.round, mode: sim.mode, score: sim.score, swapped: sim.swapped,
      bomb: { s: b.state, x: r2(b.x), y: r2(b.y), z: r2(b.z), site: b.site, tl: r2(b.timeLeft), c: b.carrier },
      p: players, me: meSnap, win: sim.lastWinner ? { w: sim.lastWinner.winner, r: sim.lastWinner.reason } : null, mw: sim.matchWinnerSquad, ls: sim.lossStreak,
    };
  }

  // ------------------------------------------------------------------ end
  private finish(reason: string) {
    if (this.ending) return; this.ending = true;
    for (const h of this.humans.values()) h.s.send({ t: 'match.end', matchId: this.id, winnerSquad: this.sim.matchWinnerSquad, reason });
    if (this.timer) clearInterval(this.timer); this.timer = null; this.ended = true;
    this.hub.matchFinished(this);
  }
  destroy() { if (this.timer) clearInterval(this.timer); this.timer = null; this.ended = true; }

  stats() { return { id: this.id, humans: this.humans.size, round: this.sim.round, phase: this.sim.phase, score: this.sim.score }; }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
function toWire(c: ReturnType<typeof emptyCmd>): WireCmd { return { fwd: c.fwd, strafe: c.strafe, jump: c.jump, crouch: c.crouch, walk: c.walk, yaw: c.yaw, pitch: c.pitch, fire: c.fire, reload: c.reload, use: c.use, slot: c.slot, aim: c.aim }; }
void WEAPONS; void ({} as WeaponId);
