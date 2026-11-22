/**
 * Lobbies (browser + private codes), the matchmaking queue, and launching parties into a match.
 * A match is always created through `hub.startMatch(spec)` so every human gets `match.start` in the same call.
 */
import { LIMITS, makeCode, isMode, isDiff, type LobbyListing, type LobbyState } from '../src/network/protocol.ts';
import type { Mode } from '../src/gameplay/sim.ts';
import type { Hub } from './hub.ts';
import type { Session } from './session.ts';
import type { Party } from './party.ts';
import type { MatchSpec } from './match.ts';

interface LobbyPlayer { s: Session; squad: 0 | 1; ready: boolean; }
interface Lobby {
  id: number; code: string; name: string; host: number; mode: Mode; private: boolean; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard';
  state: 'waiting' | 'countdown' | 'live'; countdown: number; players: Map<number, LobbyPlayer>; timer: ReturnType<typeof setInterval> | null;
}
interface QueueEntry { id: number; sessions: Session[]; party: Party | null; mode: Mode; since: number; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard'; }

export class LobbyManager {
  lobbies = new Map<number, Lobby>();
  private queue: QueueEntry[] = [];
  private nextLobby = 1; private nextQueue = 1;
  private mm: ReturnType<typeof setInterval>;

  constructor(private hub: Hub) { this.mm = setInterval(() => this.matchmake(), 1000); }
  dispose() { clearInterval(this.mm); for (const l of this.lobbies.values()) if (l.timer) clearInterval(l.timer); }

  private err(s: Session, code: string, text: string) { s.send({ t: 'error', code, text }); }

  /** a lone player with an implicit one-person party may still use lobbies */
  private soloReady(s: Session): boolean {
    const p = this.hub.parties.partyOf(s);
    if (!p) return true;
    if (p.members.length === 1) { this.hub.parties.leave(s, 'solo'); return true; }
    this.err(s, 'in_party', 'You are in a party: the leader starts matches for everyone (Start for party).');
    return false;
  }

  // ------------------------------------------------------------------ lobby CRUD
  view(l: Lobby): LobbyState {
    return { id: l.id, code: l.code, name: l.name, host: l.host, mode: l.mode, private: l.private, perTeam: l.perTeam, fillBots: l.fillBots, difficulty: l.difficulty, state: l.state, countdown: l.countdown,
      players: [...l.players.values()].map((p) => ({ id: p.s.id, name: p.s.name, squad: p.squad, ready: p.ready || p.s.id === l.host, party: null })) };
  }
  private push(l: Lobby) { const v = this.view(l); for (const p of l.players.values()) p.s.send({ t: 'lobby.state', lobby: v }); this.hub.markPresenceDirty(); }

  list(s: Session) {
    const out: LobbyListing[] = [];
    for (const l of this.lobbies.values()) {
      if (l.private || l.state === 'live') continue;
      const host = this.hub.sessions.get(l.host);
      if (host && (host.blocked.has(s.uid) || s.blocked.has(host.uid))) continue;
      out.push({ id: l.id, name: l.name, mode: l.mode, players: l.players.size, max: l.perTeam * 2, host: host?.name ?? '?', perTeam: l.perTeam });
    }
    s.send({ t: 'lobby.list', lobbies: out.slice(0, 50) });
  }

  create(s: Session, o: { name: string; mode: Mode; private: boolean; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard' }) {
    if (s.matchId) return this.err(s, 'busy', 'Leave your current match first.');
    if (!this.soloReady(s)) return;
    this.leaveAll(s);
    if (!isMode(o.mode) || !isDiff(o.difficulty)) return this.err(s, 'invalid', 'Invalid lobby options.');
    let code = makeCode(); while ([...this.lobbies.values()].some((l) => l.code === code)) code = makeCode();
    const l: Lobby = { id: this.nextLobby++, code, name: String(o.name || `${s.name}'s game`).slice(0, 24), host: s.id, mode: o.mode, private: !!o.private, perTeam: o.perTeam === 3 ? 3 : 5, fillBots: !!o.fillBots, difficulty: o.difficulty, state: 'waiting', countdown: 0, players: new Map(), timer: null };
    this.lobbies.set(l.id, l);
    this.add(l, s);
  }

  join(s: Session, ref: { id?: number; code?: string }) {
    if (s.matchId) return this.err(s, 'busy', 'Leave your current match first.');
    const l = ref.id !== undefined ? this.lobbies.get(ref.id) : [...this.lobbies.values()].find((x) => x.code === String(ref.code ?? '').toUpperCase().trim());
    if (!l) return this.err(s, 'not_found', 'No lobby with that code.');
    if (l.state === 'live') return this.err(s, 'busy', 'That match already started.');
    if (l.players.size >= l.perTeam * 2) return this.err(s, 'full', 'That lobby is full.');
    const host = this.hub.sessions.get(l.host);
    if (host && (host.blocked.has(s.uid) || s.blocked.has(host.uid))) return this.err(s, 'unavailable', 'You cannot join that lobby.');
    if (!this.soloReady(s)) return;
    this.leaveAll(s);
    this.add(l, s);
  }

  private add(l: Lobby, s: Session) {
    const c0 = [...l.players.values()].filter((p) => p.squad === 0).length, c1 = l.players.size - c0;
    l.players.set(s.id, { s, squad: c0 <= c1 ? 0 : 1, ready: false }); s.lobbyId = l.id; s.status = 'lobby';
    if (l.state === 'countdown') this.stopCountdown(l);
    this.push(l);
  }

  leave(s: Session) {
    const l = s.lobbyId ? this.lobbies.get(s.lobbyId) : null; if (!l) return;
    l.players.delete(s.id); s.lobbyId = null; if (s.status === 'lobby') s.status = s.partyId ? 'party' : 'online';
    s.send({ t: 'lobby.state', lobby: null });
    if (l.players.size === 0) { if (l.timer) clearInterval(l.timer); this.lobbies.delete(l.id); this.hub.markPresenceDirty(); return; }
    if (l.host === s.id) l.host = [...l.players.keys()][0]!;
    if (l.state === 'countdown') this.stopCountdown(l);
    this.push(l);
  }

  team(s: Session, squad: 0 | 1) {
    const l = s.lobbyId ? this.lobbies.get(s.lobbyId) : null; if (!l || l.state === 'live') return;
    const me = l.players.get(s.id); if (!me || me.squad === squad) return;
    const count = [...l.players.values()].filter((p) => p.squad === squad).length;
    if (count >= l.perTeam) return this.err(s, 'full', 'That team is full.');
    me.squad = squad; me.ready = false; if (l.state === 'countdown') this.stopCountdown(l); this.push(l);
  }
  ready(s: Session, ready: boolean) { const l = s.lobbyId ? this.lobbies.get(s.lobbyId) : null; const me = l?.players.get(s.id); if (!l || !me) return; me.ready = ready; this.push(l); }

  start(s: Session) {
    const l = s.lobbyId ? this.lobbies.get(s.lobbyId) : null; if (!l) return;
    if (l.host !== s.id) return this.err(s, 'not_host', 'Only the host can start the match.');
    if (l.state !== 'waiting') return;
    const wait = [...l.players.values()].filter((p) => p.s.id !== l.host && !p.ready).map((p) => p.s.name);
    if (wait.length) return this.err(s, 'not_ready', `Waiting for: ${wait.join(', ')}.`);
    l.state = 'countdown'; l.countdown = LIMITS.lobbyCountdownS; this.push(l);
    l.timer = setInterval(() => {
      l.countdown--; if (l.countdown > 0) { this.push(l); return; }
      if (l.timer) clearInterval(l.timer); l.timer = null; this.launchLobby(l);
    }, 1000);
  }
  private stopCountdown(l: Lobby) { if (l.timer) clearInterval(l.timer); l.timer = null; l.state = 'waiting'; l.countdown = 0; }

  private launchLobby(l: Lobby) {
    const humans = [...l.players.values()].filter((p) => p.s.connected).map((p) => ({ s: p.s, squad: p.squad }));
    this.lobbies.delete(l.id);
    for (const p of l.players.values()) { p.s.lobbyId = null; p.s.send({ t: 'lobby.state', lobby: null }); }
    if (!humans.length) return;
    this.hub.startMatch({ mode: l.mode, perTeam: l.perTeam, fillBots: l.fillBots, difficulty: l.difficulty, humans });
  }

  leaveAll(s: Session) { this.leave(s); this.leaveQueue(s); }

  // ------------------------------------------------------------------ matchmaking
  joinQueue(s: Session, mode: Mode) {
    if (!isMode(mode)) return this.err(s, 'invalid', 'Unknown mode.');
    if (s.matchId) return this.err(s, 'busy', 'Leave your current match first.');
    if (!this.soloReady(s)) return;
    this.leaveAll(s);
    this.queue.push({ id: this.nextQueue++, sessions: [s], party: null, mode, since: Date.now(), perTeam: 5, fillBots: true, difficulty: 'normal' });
    s.queued = true; s.status = 'queue'; this.pushQueue(); this.hub.markPresenceDirty();
  }
  leaveQueue(s: Session) {
    const i = this.queue.findIndex((q) => q.sessions.includes(s)); if (i < 0) return;
    const q = this.queue[i]!; this.queue.splice(i, 1);
    for (const m of q.sessions) { m.queued = false; if (m.status === 'queue') m.status = m.partyId ? 'party' : 'online'; m.send({ t: 'queue.state', queued: false, since: 0, waiting: 0 }); }
    if (q.party) this.hub.parties.setState(q.party, 'lobby');
    this.hub.markPresenceDirty();
  }
  cancelPartyQueue(p: Party, reason: string) {
    const i = this.queue.findIndex((q) => q.party === p); if (i < 0) { this.hub.parties.setState(p, 'lobby'); return; }
    const q = this.queue[i]!; this.queue.splice(i, 1);
    for (const m of q.sessions) { m.queued = false; if (m.status === 'queue') m.status = 'party'; m.send({ t: 'queue.state', queued: false, since: 0, waiting: 0 }); m.send({ t: 'notice', text: reason }); }
    this.hub.parties.setState(p, 'lobby');
  }
  private pushQueue() {
    const waiting = this.queue.reduce((n, q) => n + q.sessions.length, 0);
    for (const q of this.queue) for (const m of q.sessions) m.send({ t: 'queue.state', queued: true, since: q.since, waiting });
  }

  private matchmake() {
    if (!this.queue.length) return;
    this.queue = this.queue.filter((q) => { q.sessions = q.sessions.filter((s) => s.connected); return q.sessions.length > 0; });
    for (const mode of ['objective', 'elimination'] as Mode[]) {
      const pool = this.queue.filter((q) => q.mode === mode).sort((a, b) => a.since - b.since);
      if (!pool.length) continue;
      const humans = pool.reduce((n, q) => n + q.sessions.length, 0);
      const wait = (Date.now() - pool[0]!.since) / 1000;
      if (!(humans >= LIMITS.maxMatchHumans || wait >= LIMITS.matchmakerBotFillAfterS)) continue;
      // pack entries into two squads without splitting a party
      const cap = pool[0]!.perTeam; const squads: QueueEntry[][] = [[], []]; const size = [0, 0]; const placed: QueueEntry[] = [];
      for (const q of [...pool].sort((a, b) => b.sessions.length - a.sessions.length)) {
        const k = size[0]! <= size[1]! ? 0 : 1; const alt = k ^ 1;
        if (size[k]! + q.sessions.length <= cap) { squads[k]!.push(q); size[k]! += q.sessions.length; placed.push(q); }
        else if (size[alt]! + q.sessions.length <= cap) { squads[alt]!.push(q); size[alt]! += q.sessions.length; placed.push(q); }
      }
      if (!placed.length) continue;
      this.queue = this.queue.filter((q) => !placed.includes(q));
      const spec: MatchSpec = { mode, perTeam: cap, fillBots: true, difficulty: pool[0]!.difficulty, humans: [] };
      for (const sq of [0, 1] as const) for (const q of squads[sq]!) for (const s of q.sessions) { spec.humans.push({ s, squad: sq }); s.queued = false; s.send({ t: 'queue.state', queued: false, since: 0, waiting: 0 }); }
      if (placed.length && humans < 2) for (const q of placed) for (const s of q.sessions) s.send({ t: 'notice', text: 'No other players were found, so bots will fill the teams.' });
      this.hub.startMatch(spec);
    }
    this.pushQueue();
  }

  // ------------------------------------------------------------------ party launch
  launchParty(p: Party, members: Session[]): boolean {
    if (!members.length) return false;
    for (const m of members) this.leaveAll(m);
    const st = p.settings;
    if (st.visibility === 'private') {
      const perTeam = (members.length > st.perTeam ? 5 : st.perTeam) as 3 | 5;
      this.hub.parties.setState(p, 'inMatch');
      this.hub.startMatch({ mode: st.mode, perTeam, fillBots: st.fillBots, difficulty: st.difficulty, humans: members.map((s) => ({ s, squad: 0 as const })) });
      return true;
    }
    // public: join the matchmaking queue together
    this.queue.push({ id: this.nextQueue++, sessions: members, party: p, mode: st.mode, since: Date.now(), perTeam: st.perTeam, fillBots: st.fillBots, difficulty: st.difficulty });
    for (const m of members) { m.queued = true; m.status = 'queue'; }
    this.hub.parties.setState(p, 'queue'); this.pushQueue(); this.hub.markPresenceDirty();
    return true;
  }

  /** a party whose members were assigned to a match by the matchmaker */
  partyInMatch(p: Party) { this.hub.parties.setState(p, 'inMatch'); }
}
