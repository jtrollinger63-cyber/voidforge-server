import { createHash, randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { LIMITS, PROTOCOL_VERSION, sanitizeName, validCmd, isMode, isDiff, type ClientMsg, type PresenceEntry } from '../src/network/protocol.ts';
import { Session } from './session.ts';
import { PartyManager } from './party.ts';
import { LobbyManager } from './lobby.ts';
import { MatchRunner, type MatchSpec } from './match.ts';

export interface HubOptions { maxSessions: number; allowedOrigins: string[]; }

export class Hub {
  sessions = new Map<number, Session>();
  private byToken = new Map<string, Session>();
  matches = new Map<number, MatchRunner>();
  parties: PartyManager; lobbies: LobbyManager;
  private nextId = 1; private nextMatch = 1;
  private presenceDirty = true;
  private presenceTimer: ReturnType<typeof setInterval>;

  constructor(readonly opts: HubOptions = { maxSessions: 500, allowedOrigins: [] }) {
    this.parties = new PartyManager(this); this.lobbies = new LobbyManager(this);
    this.presenceTimer = setInterval(() => { if (this.presenceDirty) this.pushPresence(); }, 1000);
  }
  dispose() { clearInterval(this.presenceTimer); this.parties.dispose(); this.lobbies.dispose(); for (const m of this.matches.values()) m.destroy(); for (const s of this.sessions.values()) { if (s.graceTimer) clearTimeout(s.graceTimer); s.ws?.close(); } }

  markPresenceDirty() { this.presenceDirty = true; }

  stats() { return { sessions: this.sessions.size, online: [...this.sessions.values()].filter((s) => s.connected).length, parties: this.parties.parties.size, lobbies: this.lobbies.lobbies.size, matches: this.matches.size }; }

  // ------------------------------------------------------------------ connections
  onConnection(ws: WebSocket, ip: string) {
    let session: Session | null = null;
    const helloTimer = setTimeout(() => { if (!session) ws.close(4000, 'hello timeout'); }, 5000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
      if (raw.length > LIMITS.maxFrameBytes) { session?.send({ t: 'error', code: 'too_large', text: 'Message too large.' }); if (session && ++session.strikes > 5) ws.close(1009, 'too large'); return; }
      let msg: ClientMsg; try { msg = JSON.parse(raw) as ClientMsg; } catch { if (session && ++session.strikes > 10) ws.close(1003, 'bad json'); return; }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
      if (!session) {
        if (msg.t !== 'hello') return;
        session = this.hello(ws, msg, ip); if (session) clearTimeout(helloTimer); else ws.close(4001, 'rejected');
        return;
      }
      if (session.ws !== ws) return;                       // stale socket after a resume
      this.handle(session, msg);
    });
    ws.on('close', () => { clearTimeout(helloTimer); if (session && session.ws === ws) this.disconnected(session); });
    ws.on('error', () => { /* handled by close */ });
  }

  private hello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>, ip: string): Session | null {
    if (msg.v !== PROTOCOL_VERSION) { ws.send(JSON.stringify({ t: 'error', code: 'version', text: `Protocol mismatch (server ${PROTOCOL_VERSION}). Reload the page.` })); return null; }
    // resume?
    const prior = typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined;
    if (prior) {
      if (prior.ws && prior.ws !== ws && prior.ws.readyState === 1) { prior.ws.close(4002, 'replaced'); }
      if (prior.graceTimer) { clearTimeout(prior.graceTimer); prior.graceTimer = null; }
      prior.ws = ws; prior.connected = true; prior.ip = ip;
      prior.send({ t: 'welcome', id: prior.id, uid: prior.uid, token: prior.token, name: prior.name, v: PROTOCOL_VERSION, resumed: true, serverTime: Date.now() });
      this.afterResume(prior);
      return prior;
    }
    if (this.sessions.size >= this.opts.maxSessions) { ws.send(JSON.stringify({ t: 'error', code: 'full', text: 'The server is full.' })); return null; }
    const token = randomBytes(18).toString('base64url');
    const uid = createHash('sha256').update(token).digest('hex').slice(0, 12);
    let name = sanitizeName(msg.name); const taken = new Set([...this.sessions.values()].map((s) => s.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) { let n = 2; while (taken.has(`${name}${n}`.toLowerCase())) n++; name = `${name}${n}`.slice(0, LIMITS.maxName + 2); }
    const s = new Session(this.nextId++, uid, token, name); s.ws = ws; s.ip = ip;
    for (const f of (msg.favorites ?? []).slice(0, 200)) if (typeof f === 'string') s.favorites.add(f.slice(0, 16));
    for (const b of (msg.blocked ?? []).slice(0, 200)) if (typeof b === 'string') s.blocked.add(b.slice(0, 16));
    this.sessions.set(s.id, s); this.byToken.set(token, s);
    s.send({ t: 'welcome', id: s.id, uid, token, name, v: PROTOCOL_VERSION, resumed: false, serverTime: Date.now() });
    this.markPresenceDirty();
    return s;
  }

  private afterResume(s: Session) {
    this.parties.memberOnline(s);
    if (s.partyId === null) s.send({ t: 'party.state', party: null });
    const m = s.matchId ? this.matches.get(s.matchId) : null;
    if (m) m.reconnected(s);
    this.markPresenceDirty();
  }

  private disconnected(s: Session) {
    s.connected = false; s.disconnectedAt = Date.now(); s.ws = null; s.presenceSub = false;
    this.parties.memberOffline(s);
    const m = s.matchId ? this.matches.get(s.matchId) : null; if (m) m.disconnected(s);
    this.lobbies.leaveAll(s);                                       // lobbies and queues are not held
    this.markPresenceDirty();
    s.graceTimer = setTimeout(() => this.drop(s), LIMITS.reconnectGraceMs);
  }

  /** the grace period elapsed: remove every trace of the session */
  private drop(s: Session) {
    if (s.connected) return;
    this.parties.leave(s, 'timeout');
    const m = s.matchId ? this.matches.get(s.matchId) : null; if (m) m.leave(s);
    this.sessions.delete(s.id); this.byToken.delete(s.token); this.markPresenceDirty();
  }

  // ------------------------------------------------------------------ dispatch
  private handle(s: Session, m: ClientMsg) {
    const cat = m.t === 'match.cmd' ? 'cmd' : m.t === 'ping' ? 'ping' : m.t === 'match.buy' ? 'buy' : 'misc';
    if (!s.allow(cat)) { if (cat !== 'cmd' && ++s.strikes > 30) s.ws?.close(1008, 'rate limit'); else if (cat !== 'cmd' && cat !== 'ping') s.send({ t: 'error', code: 'rate_limited', text: 'You are doing that too often.' }); return; }
    const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
    switch (m.t) {
      case 'ping': s.send({ t: 'pong', n: Number(m.n) || 0, serverTime: Date.now() }); return;
      case 'presence.sub': s.presenceSub = !!m.on; if (m.on) this.pushPresenceTo(s); return;
      case 'settings':
        if (m.vis === 'public' || m.vis === 'invisible') s.vis = m.vis;
        if (m.invites === 'anyone' || m.invites === 'favorites' || m.invites === 'nobody') s.invitePolicy = m.invites;
        this.markPresenceDirty(); s.send({ t: 'notice', text: 'Privacy settings saved.' }); return;
      case 'friend': if (typeof m.uid === 'string' && m.uid.length <= 16 && m.uid !== s.uid) { if (m.add) s.favorites.add(m.uid); else s.favorites.delete(m.uid); this.markPresenceDirty(); } return;
      case 'block': if (typeof m.uid === 'string' && m.uid.length <= 16 && m.uid !== s.uid) { if (m.on) { s.blocked.add(m.uid); s.favorites.delete(m.uid); } else s.blocked.delete(m.uid); this.markPresenceDirty(); } return;

      case 'party.create': this.parties.create(s); return;
      case 'party.invite': { const t = int(m.target); if (!Number.isNaN(t)) this.parties.invite(s, t); return; }
      case 'party.request': { const t = int(m.target); if (!Number.isNaN(t)) this.parties.request(s, t); return; }
      case 'party.suggest': { const t = int(m.target); if (!Number.isNaN(t)) this.parties.suggest(s, t); return; }
      case 'party.respondInvite': { const i = int(m.inviteId); if (!Number.isNaN(i)) this.parties.respondInvite(s, i, !!m.accept); return; }
      case 'party.respondRequest': { const i = int(m.requestId); if (!Number.isNaN(i)) this.parties.respondRequest(s, i, !!m.accept); return; }
      case 'party.respondSuggest': { const i = int(m.suggestId); if (!Number.isNaN(i)) this.parties.respondSuggest(s, i, !!m.accept); return; }
      case 'party.leave': this.parties.leave(s); return;
      case 'party.kick': { const t = int(m.target); if (!Number.isNaN(t)) this.parties.kick(s, t); return; }
      case 'party.promote': { const t = int(m.target); if (!Number.isNaN(t)) this.parties.promote(s, t); return; }
      case 'party.ready': this.parties.setReady(s, !!m.ready); return;
      case 'party.settings': if (m.settings && typeof m.settings === 'object') this.parties.setSettings(s, m.settings, m.invitePolicy); return;
      case 'party.start': this.parties.start(s); return;
      case 'party.cancel': this.parties.cancel(s); return;

      case 'lobby.list': this.lobbies.list(s); return;
      case 'lobby.create': if (isMode(m.mode) && isDiff(m.difficulty)) this.lobbies.create(s, { name: String(m.name ?? '').slice(0, 24), mode: m.mode, private: !!m.private, perTeam: m.perTeam === 3 ? 3 : 5, fillBots: !!m.fillBots, difficulty: m.difficulty }); return;
      case 'lobby.join': this.lobbies.join(s, { id: typeof m.id === 'number' ? m.id : undefined, code: typeof m.code === 'string' ? m.code.slice(0, 8) : undefined }); return;
      case 'lobby.leave': this.lobbies.leave(s); return;
      case 'lobby.team': this.lobbies.team(s, m.squad === 1 ? 1 : 0); return;
      case 'lobby.ready': this.lobbies.ready(s, !!m.ready); return;
      case 'lobby.start': this.lobbies.start(s); return;
      case 'queue.join': this.lobbies.joinQueue(s, m.mode); return;
      case 'queue.leave': this.lobbies.leaveQueue(s); return;

      case 'match.cmd': { const c = validCmd(m.cmd); const run = s.matchId ? this.matches.get(s.matchId) : null; if (c && run && Number.isFinite(m.seq)) run.cmd(s, Math.trunc(m.seq), c); return; }
      case 'match.buy': { const run = s.matchId ? this.matches.get(s.matchId) : null; if (run && typeof m.item === 'string') run.buy(s, m.item.slice(0, 16)); return; }
      case 'match.leave': { const run = s.matchId ? this.matches.get(s.matchId) : null; if (run) run.leave(s); return; }
      case 'hello': return;
      default: return;
    }
  }

  // ------------------------------------------------------------------ matches
  startMatch(spec: MatchSpec): MatchRunner {
    const id = this.nextMatch++;
    // every party touched by this match moves to "inMatch" in the same step the humans are registered
    const partyIds = new Set<number>(); for (const h of spec.humans) if (h.s.partyId) partyIds.add(h.s.partyId);
    const runner = new MatchRunner(this, id, spec);
    this.matches.set(id, runner);
    for (const pid of partyIds) { const p = this.parties.parties.get(pid); if (p) this.parties.setState(p, 'inMatch'); }
    this.markPresenceDirty();
    return runner;
  }

  matchFinished(r: MatchRunner) {
    this.matches.delete(r.id);
    const partyIds = new Set<number>();
    for (const h of r.humans.values()) {
      if (h.s.matchId === r.id) { h.s.matchId = null; h.s.status = h.s.partyId ? 'party' : 'online'; }
      if (h.s.partyId) partyIds.add(h.s.partyId);
    }
    for (const pid of partyIds) { const p = this.parties.parties.get(pid); if (p) this.parties.matchEnded(p); }
    r.destroy(); this.markPresenceDirty();
  }

  afterMatchLeave(s: Session, _r: MatchRunner) {
    const p = this.parties.partyOf(s);
    if (p) s.send({ t: 'party.state', party: this.parties.view(p) });
    this.markPresenceDirty();
  }

  // ------------------------------------------------------------------ presence
  presenceFor(viewer: Session): PresenceEntry[] {
    const out: PresenceEntry[] = [];
    for (const o of this.sessions.values()) {
      if (o.id === viewer.id || !o.connected || o.vis === 'invisible') continue;
      if (o.blocked.has(viewer.uid) || viewer.blocked.has(o.uid)) continue;
      const p = this.parties.partyOf(o);
      out.push({ id: o.id, uid: o.uid, name: o.name, status: o.status, party: p ? { id: p.id, size: p.members.length, max: LIMITS.maxPartySize, joinable: p.state === 'lobby' && p.members.length < LIMITS.maxPartySize } : null, fav: viewer.favorites.has(o.uid) });
      if (out.length >= 100) break;
    }
    return out.sort((a, b) => Number(b.fav) - Number(a.fav) || a.name.localeCompare(b.name));
  }
  private pushPresenceTo(s: Session) { s.send({ t: 'presence', players: this.presenceFor(s), online: [...this.sessions.values()].filter((x) => x.connected).length }); }
  private pushPresence() { this.presenceDirty = false; for (const s of this.sessions.values()) if (s.connected && s.presenceSub) this.pushPresenceTo(s); }
}
