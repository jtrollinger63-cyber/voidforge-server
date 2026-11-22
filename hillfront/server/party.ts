/**
 * Party service (Xbox-style). Deliberately independent from the shooter: it only needs sessions + a "launch" callback,
 * so another game can reuse it with the same account/presence service.
 *
 * Rules enforced here:
 *  - leader invites (or members, if the leader allows it); non-leaders can *suggest* an invite
 *  - anyone can REQUEST to join a visible player's party; the leader accepts/declines
 *  - invites 30 s, requests/suggestions 60 s, duplicates rejected, full parties rejected, blocked/invisible players unreachable
 *  - kick / promote / leave / leader hand-over / disband; disconnect keeps a slot for a grace period
 *  - START needs every online member ready; launch is atomic and all members get the same result or an explanation
 */
import { LIMITS, type PartySettings, type PartyState, type PartyInvitePolicy, type PartyMemberView } from '../src/network/protocol.ts';
import type { Session } from './session.ts';
import type { Hub } from './hub.ts';

interface Invite { id: number; partyId: number; from: number; target: number; expires: number; }
interface JoinRequest { id: number; partyId: number; from: number; expires: number; }
interface Suggest { id: number; partyId: number; from: number; target: number; expires: number; }

export class Party {
  members: number[] = [];                 // session ids in join order
  ready = new Set<number>();
  state: PartyState['state'] = 'lobby';
  invitePolicy: PartyInvitePolicy = 'leader';
  settings: PartySettings = { mode: 'objective', visibility: 'private', perTeam: 5, fillBots: true, difficulty: 'normal' };
  offlineSince = new Map<number, number>();
  constructor(readonly id: number, public leader: number) { this.members = [leader]; }
}

export class PartyManager {
  parties = new Map<number, Party>();
  private invites = new Map<number, Invite>();
  private requests = new Map<number, JoinRequest>();
  private suggests = new Map<number, Suggest>();
  private nextParty = 1; private nextToken = 1;
  private sweeper: ReturnType<typeof setInterval>;

  constructor(private hub: Hub) { this.sweeper = setInterval(() => this.sweep(), 1000); }
  dispose() { clearInterval(this.sweeper); }

  // ------------------------------------------------------------------ helpers
  partyOf(s: Session): Party | null { return s.partyId ? this.parties.get(s.partyId) ?? null : null; }
  private err(s: Session, code: string, text: string, ref?: string) { s.send({ t: 'error', code, text, ref }); }
  private note(s: Session, text: string) { s.send({ t: 'notice', text }); }
  private sess(id: number) { return this.hub.sessions.get(id); }

  view(p: Party): PartyState {
    const members: PartyMemberView[] = p.members.map((id) => { const m = this.sess(id); return { id, uid: m?.uid ?? '', name: m?.name ?? '?', ready: p.ready.has(id) || id === p.leader, online: !!m?.connected, status: m?.status ?? 'online', leader: id === p.leader }; });
    return { id: p.id, leader: p.leader, members, settings: p.settings, invitePolicy: p.invitePolicy, state: p.state, max: LIMITS.maxPartySize };
  }
  broadcast(p: Party) {
    const st = this.view(p);
    for (const id of p.members) this.sess(id)?.send({ t: 'party.state', party: st });
    this.hub.markPresenceDirty();
  }

  private ensure(s: Session): Party {
    let p = this.partyOf(s);
    if (!p) {
      p = new Party(this.nextParty++, s.id); this.parties.set(p.id, p); s.partyId = p.id;
      if (s.status === 'online') s.status = 'party';
      this.broadcast(p);
    }
    return p;
  }

  private pendingFor(p: Party) { let n = 0; for (const i of this.invites.values()) if (i.partyId === p.id) n++; return n; }

  /** can `from` reach `target`? (visible, not blocked either way, policy) */
  private reachable(from: Session, target: Session | undefined, action: 'invite' | 'request'): string | null {
    if (!target || !target.connected || target.vis === 'invisible' || target.id === from.id) return 'That player is not available.';
    if (target.blocked.has(from.uid) || from.blocked.has(target.uid)) return 'That player is not available.';
    if (action === 'invite') {
      if (target.invitePolicy === 'nobody') return `${target.name} is not accepting invitations.`;
      if (target.invitePolicy === 'favorites' && !target.favorites.has(from.uid)) return `${target.name} only accepts invitations from favorites.`;
    }
    return null;
  }

  // ------------------------------------------------------------------ invite / request / suggest
  create(s: Session) { if (s.matchId && !this.partyOf(s)) { /* allowed: parties persist across matches */ } this.ensure(s); }

  invite(s: Session, targetId: number) {
    if (!s.allow('invite')) return this.err(s, 'rate_limited', 'Slow down: too many invitations.');
    const target = this.sess(targetId);
    const bad = this.reachable(s, target, 'invite'); if (bad) return this.err(s, 'unavailable', bad);
    const p = this.ensure(s);
    if (p.state !== 'lobby') return this.err(s, 'busy', 'Your party is busy (queued or in a match).');
    if (s.id !== p.leader && p.invitePolicy === 'leader') return this.err(s, 'not_leader', 'Only the leader can invite. Use "Suggest" to ask the leader.');
    if (target!.partyId === p.id) return this.err(s, 'already', `${target!.name} is already in your party.`);
    if (p.members.length + this.pendingFor(p) >= LIMITS.maxPartySize) return this.err(s, 'full', 'Your party is full (including pending invitations).');
    for (const i of this.invites.values()) if (i.partyId === p.id && i.target === targetId) return this.err(s, 'duplicate', `${target!.name} already has a pending invitation.`);
    const inv: Invite = { id: this.nextToken++, partyId: p.id, from: s.id, target: targetId, expires: Date.now() + LIMITS.inviteTtlMs };
    this.invites.set(inv.id, inv);
    target!.send({ t: 'party.invite', inviteId: inv.id, from: { id: s.id, name: s.name }, partyId: p.id, ttl: LIMITS.inviteTtlMs });
    this.note(s, `Invitation sent to ${target!.name}.`);
  }

  request(s: Session, targetId: number) {
    if (!s.allow('request')) return this.err(s, 'rate_limited', 'Slow down: too many join requests.');
    const target = this.sess(targetId);
    const bad = this.reachable(s, target, 'request'); if (bad) return this.err(s, 'unavailable', bad);
    const tp = this.ensure(target!);               // a lone player is the leader of an implicit one-person party
    if (s.partyId === tp.id) return this.err(s, 'already', 'You are already in that party.');
    if (tp.state !== 'lobby') return this.err(s, 'busy', 'That party is busy (queued or in a match).');
    if (tp.members.length >= LIMITS.maxPartySize) return this.err(s, 'full', 'That party is full.');
    for (const r of this.requests.values()) if (r.partyId === tp.id && r.from === s.id) return this.err(s, 'duplicate', 'You already asked to join that party.');
    const leader = this.sess(tp.leader);
    if (!leader || !leader.connected) return this.err(s, 'unavailable', 'The party leader is away.');
    const req: JoinRequest = { id: this.nextToken++, partyId: tp.id, from: s.id, expires: Date.now() + LIMITS.requestTtlMs };
    this.requests.set(req.id, req);
    leader.send({ t: 'party.request', requestId: req.id, from: { id: s.id, name: s.name }, ttl: LIMITS.requestTtlMs });
    this.note(s, `Request sent to ${leader.name}.`);
  }

  suggest(s: Session, targetId: number) {
    if (!s.allow('invite')) return this.err(s, 'rate_limited', 'Slow down.');
    const p = this.partyOf(s); if (!p) return this.err(s, 'no_party', 'You are not in a party.');
    if (s.id === p.leader) return this.invite(s, targetId);
    const target = this.sess(targetId); const bad = this.reachable(s, target, 'invite'); if (bad) return this.err(s, 'unavailable', bad);
    for (const x of this.suggests.values()) if (x.partyId === p.id && x.target === targetId) return this.err(s, 'duplicate', 'Already suggested.');
    const sg: Suggest = { id: this.nextToken++, partyId: p.id, from: s.id, target: targetId, expires: Date.now() + LIMITS.suggestTtlMs };
    this.suggests.set(sg.id, sg);
    this.sess(p.leader)?.send({ t: 'party.suggest', suggestId: sg.id, from: { id: s.id, name: s.name }, target: { id: targetId, name: target!.name }, ttl: LIMITS.suggestTtlMs });
    this.note(s, 'Suggestion sent to the party leader.');
  }

  respondInvite(s: Session, inviteId: number, accept: boolean) {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.target !== s.id) return this.err(s, 'expired', 'That invitation is no longer valid.');
    this.invites.delete(inviteId);
    const inviter = this.sess(inv.from); const p = this.parties.get(inv.partyId);
    if (!accept) { if (inviter) this.note(inviter, `${s.name} declined your invitation.`); return; }
    if (!p) return this.err(s, 'expired', 'That party no longer exists.');
    this.join(s, p);
  }

  respondRequest(s: Session, requestId: number, accept: boolean) {
    const req = this.requests.get(requestId); const p = req ? this.parties.get(req.partyId) : null;
    if (!req || !p || p.leader !== s.id) return this.err(s, 'expired', 'That request is no longer valid.');
    this.requests.delete(requestId);
    const who = this.sess(req.from);
    if (!who || !who.connected) return this.err(s, 'unavailable', 'That player went away.');
    if (!accept) { this.note(who, `${s.name} declined your request.`); return; }
    this.join(who, p, s);
  }

  respondSuggest(s: Session, suggestId: number, accept: boolean) {
    const sg = this.suggests.get(suggestId); const p = sg ? this.parties.get(sg.partyId) : null;
    if (!sg || !p || p.leader !== s.id) return this.err(s, 'expired', 'That suggestion is no longer valid.');
    this.suggests.delete(suggestId);
    if (accept) this.invite(s, sg.target);
  }

  /** put `who` into `p` (leaving any other party first) */
  private join(who: Session, p: Party, acceptedBy?: Session) {
    if (p.state !== 'lobby') return this.err(who, 'busy', 'That party is busy (queued or in a match).');
    if (p.members.length >= LIMITS.maxPartySize) { this.err(who, 'full', 'That party is full.'); if (acceptedBy) this.err(acceptedBy, 'full', 'Your party is full.'); return; }
    if (who.partyId === p.id) return;
    if (who.partyId) this.leave(who, 'switched');
    if (who.lobbyId || who.queued) this.hub.lobbies.leaveAll(who);
    p.members.push(who.id); p.ready.delete(who.id); who.partyId = p.id; if (who.status === 'online') who.status = 'party';
    for (const id of p.members) if (id !== who.id) this.note(this.sess(id)!, `${who.name} joined the party.`);
    this.broadcast(p);
  }

  // ------------------------------------------------------------------ membership
  leave(s: Session, why = 'left') {
    const p = this.partyOf(s); if (!p) return;
    p.members = p.members.filter((id) => id !== s.id); p.ready.delete(s.id); p.offlineSince.delete(s.id);
    s.partyId = null; if (s.status === 'party') s.status = 'online';
    s.send({ t: 'party.state', party: null });
    if (why === 'left') for (const id of p.members) this.note(this.sess(id)!, `${s.name} left the party.`);
    if (p.state === 'queue') this.hub.lobbies.cancelPartyQueue(p, `${s.name} left, so the party left the queue.`);
    this.afterRemoval(p, s.id);
  }
  private afterRemoval(p: Party, removed: number) {
    // drop dangling invites / requests that referenced the removed member
    for (const [id, i] of this.invites) if (i.from === removed && i.partyId === p.id) this.invites.delete(id);
    if (p.members.length === 0) { this.dissolve(p); return; }
    if (p.leader === removed) {
      const online = p.members.find((id) => this.sess(id)?.connected) ?? p.members[0]!;
      p.leader = online; this.note(this.sess(online)!, 'You are now the party leader.');
      for (const id of p.members) if (id !== online) this.note(this.sess(id)!, `${this.sess(online)!.name} is now the party leader.`);
    }
    if (p.members.length === 1 && p.state === 'lobby') { /* a one-person party is still valid: it keeps accepting requests */ }
    this.broadcast(p);
  }
  private dissolve(p: Party) {
    this.parties.delete(p.id);
    for (const [id, i] of this.invites) if (i.partyId === p.id) this.invites.delete(id);
    for (const [id, r] of this.requests) if (r.partyId === p.id) this.requests.delete(id);
    for (const [id, x] of this.suggests) if (x.partyId === p.id) this.suggests.delete(id);
    this.hub.markPresenceDirty();
  }

  kick(s: Session, targetId: number) {
    const p = this.partyOf(s); if (!p || p.leader !== s.id) return this.err(s, 'not_leader', 'Only the leader can remove members.');
    if (targetId === s.id || !p.members.includes(targetId)) return this.err(s, 'invalid', 'That player is not in your party.');
    if (p.state !== 'lobby') return this.err(s, 'busy', 'You cannot remove members right now.');
    const t = this.sess(targetId)!;
    p.members = p.members.filter((id) => id !== targetId); p.ready.delete(targetId); t.partyId = null; if (t.status === 'party') t.status = 'online';
    t.send({ t: 'party.state', party: null }); t.send({ t: 'party.closed', reason: 'You were removed from the party.' });
    this.note(s, `${t.name} was removed.`); this.broadcast(p);
  }

  promote(s: Session, targetId: number) {
    const p = this.partyOf(s); if (!p || p.leader !== s.id) return this.err(s, 'not_leader', 'Only the leader can pass leadership.');
    const t = this.sess(targetId); if (!t || !p.members.includes(targetId) || targetId === s.id) return this.err(s, 'invalid', 'That player is not in your party.');
    if (!t.connected) return this.err(s, 'unavailable', 'That player is offline.');
    p.leader = targetId; for (const id of p.members) this.note(this.sess(id)!, `${t.name} is now the party leader.`); this.broadcast(p);
  }

  setReady(s: Session, ready: boolean) {
    const p = this.partyOf(s); if (!p || p.state !== 'lobby') return;
    if (ready) p.ready.add(s.id); else p.ready.delete(s.id);
    this.broadcast(p);
  }

  setSettings(s: Session, patch: Partial<PartySettings>, policy?: PartyInvitePolicy) {
    const p = this.partyOf(s); if (!p || p.leader !== s.id) return this.err(s, 'not_leader', 'Only the leader can change party settings.');
    if (p.state !== 'lobby') return this.err(s, 'busy', 'Settings are locked while queued or in a match.');
    const st = p.settings;
    if (patch.mode === 'objective' || patch.mode === 'elimination') st.mode = patch.mode;
    if (patch.visibility === 'private' || patch.visibility === 'public') st.visibility = patch.visibility;
    if (patch.perTeam === 3 || patch.perTeam === 5) st.perTeam = patch.perTeam;
    if (typeof patch.fillBots === 'boolean') st.fillBots = patch.fillBots;
    if (patch.difficulty === 'easy' || patch.difficulty === 'normal' || patch.difficulty === 'hard') st.difficulty = patch.difficulty;
    if (policy === 'leader' || policy === 'members') p.invitePolicy = policy;
    if (p.members.length > st.perTeam) st.perTeam = 5;
    for (const id of p.members) if (id !== p.leader) p.ready.delete(id);      // changed settings must be re-confirmed
    this.broadcast(p);
  }

  // ------------------------------------------------------------------ launching
  start(s: Session) {
    const p = this.partyOf(s); if (!p || p.leader !== s.id) return this.err(s, 'not_leader', 'Only the leader can start the match.');
    if (p.state !== 'lobby') return this.err(s, 'busy', 'The party is already queued or in a match.');
    const online = p.members.filter((id) => this.sess(id)?.connected);
    const notReady = online.filter((id) => id !== p.leader && !p.ready.has(id)).map((id) => this.sess(id)!.name);
    if (notReady.length) return this.err(s, 'not_ready', `Waiting for: ${notReady.join(', ')}.`);
    const busy = online.filter((id) => this.sess(id)!.status === 'match').map((id) => this.sess(id)!.name);
    if (busy.length) return this.err(s, 'busy', `Still in another match: ${busy.join(', ')}.`);
    const offline = p.members.filter((id) => !this.sess(id)?.connected).map((id) => this.sess(id)!.name);
    if (offline.length) for (const id of online) this.note(this.sess(id)!, `Starting without: ${offline.join(', ')} (offline).`);
    p.state = 'starting'; this.broadcast(p);
    const ok = this.hub.lobbies.launchParty(p, online.map((id) => this.sess(id)!));
    if (!ok) { p.state = 'lobby'; this.broadcast(p); }
  }

  cancel(s: Session) {
    const p = this.partyOf(s); if (!p || p.leader !== s.id) return this.err(s, 'not_leader', 'Only the leader can cancel the queue.');
    if (p.state === 'queue') this.hub.lobbies.cancelPartyQueue(p, 'The leader left the queue.');
  }

  setState(p: Party, st: PartyState['state']) { p.state = st; if (st === 'lobby') p.ready.clear(); this.broadcast(p); }

  /** the whole party comes back to its lobby after a match; the leader can queue again */
  matchEnded(p: Party) {
    p.state = 'lobby'; p.ready.clear();
    for (const id of p.members) { const m = this.sess(id); if (m && m.status !== 'match') m.status = 'party'; }
    this.broadcast(p);
    for (const id of p.members) this.sess(id)?.send({ t: 'notice', text: 'Back in the party lobby. The leader can start another match.' });
  }

  // ------------------------------------------------------------------ connection lifecycle
  memberOffline(s: Session) {
    const p = this.partyOf(s); if (!p) return;
    p.offlineSince.set(s.id, Date.now()); p.ready.delete(s.id); this.broadcast(p);
  }
  memberOnline(s: Session) {
    const p = this.partyOf(s); if (!p) return;
    p.offlineSince.delete(s.id); this.sess(s.id)?.send({ t: 'party.state', party: this.view(p) }); this.broadcast(p);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, i] of this.invites) if (i.expires < now) { this.invites.delete(id); const f = this.sess(i.from); const t = this.sess(i.target); if (f && t) this.note(f, `Your invitation to ${t.name} expired.`); }
    for (const [id, r] of this.requests) if (r.expires < now) { this.requests.delete(id); const f = this.sess(r.from); if (f) this.note(f, 'Your join request expired.'); }
    for (const [id, x] of this.suggests) if (x.expires < now) this.suggests.delete(id);
    for (const p of [...this.parties.values()]) {
      for (const [id, t] of p.offlineSince) if (now - t > LIMITS.partyGraceMs) { const s = this.sess(id); p.offlineSince.delete(id); if (s && !s.connected) this.leave(s, 'timeout'); }
    }
  }
}
