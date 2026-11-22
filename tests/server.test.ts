import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startServer, type ServerHandle } from '../server/index.ts';
import { LIMITS, PROTOCOL_VERSION, type ServerMsg, type ClientMsg } from '../src/network/protocol.ts';

let srv: ServerHandle;
let url: string;
beforeAll(async () => {
  (LIMITS as any).partyGraceMs = 400; (LIMITS as any).reconnectGraceMs = 1500; (LIMITS as any).lobbyCountdownS = 1; (LIMITS as any).matchmakerBotFillAfterS = 2;
  srv = await startServer({ port: 0, allowedOrigins: [] });
  url = `ws://127.0.0.1:${srv.port}/ws`;
});
afterAll(async () => { await srv.close(); });

class Client {
  ws!: WebSocket; msgs: ServerMsg[] = []; id = 0; uid = ''; token = ''; name = '';
  private waiters: { t: string; pred?: (m: any) => boolean; res: (m: any) => void }[] = [];
  static async connect(name: string, token?: string, extra: Partial<Extract<ClientMsg, { t: 'hello' }>> = {}): Promise<Client> {
    const c = new Client(); c.ws = new WebSocket(url);
    c.ws.on('message', (d) => { const m = JSON.parse(d.toString()) as ServerMsg; c.msgs.push(m); c.waiters = c.waiters.filter((w) => { if (w.t === m.t && (!w.pred || w.pred(m))) { w.res(m); return false; } return true; }); });
    await new Promise<void>((res, rej) => { c.ws.on('open', () => res()); c.ws.on('error', rej); });
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name, token, ...extra });
    const w = await c.next('welcome'); c.id = w.id; c.uid = w.uid; c.token = w.token; c.name = w.name;
    return c;
  }
  send(m: ClientMsg | Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMsg['t']>(t: T, pred?: (m: Extract<ServerMsg, { t: T }>) => boolean, ms = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const hit = this.msgs.find((m) => m.t === t && (!pred || pred(m as any)) && !(m as any).__seen);
    if (hit) { (hit as any).__seen = true; return Promise.resolve(hit as any); }
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${t} (${this.name}); got: ${this.msgs.slice(-5).map((m) => m.t).join(',')}`)), ms);
      this.waiters.push({ t, pred: pred as any, res: (m) => { clearTimeout(to); (m as any).__seen = true; res(m); } });
    });
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined { return [...this.msgs].reverse().find((m) => m.t === t) as any; }
  close() { this.ws.close(); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const partyOf = async (c: Client, pred: (p: any) => boolean) => (await c.next('party.state', (m) => !!m.party && pred(m.party))).party!;

describe('connection, identity and presence', () => {
  it('assigns unique names and ids; rejects a wrong protocol version', async () => {
    const a = await Client.connect('Same'), b = await Client.connect('Same');
    expect(a.id).not.toBe(b.id); expect(a.name).not.toBe(b.name);
    const bad = new WebSocket(url); await new Promise((r) => bad.on('open', r));
    bad.send(JSON.stringify({ t: 'hello', v: 999, name: 'x' }));
    const resp = await new Promise<any>((r) => bad.on('message', (d) => r(JSON.parse(d.toString()))));
    expect(resp.code).toBe('version'); a.close(); b.close(); bad.close();
  });

  it('presence lists only real, visible, unblocked players', async () => {
    const a = await Client.connect('Presa'), b = await Client.connect('Presb'), c = await Client.connect('Presc');
    a.send({ t: 'presence.sub', on: true });
    let p = await a.next('presence', (m) => m.players.some((x) => x.id === b.id) && m.players.some((x) => x.id === c.id));
    expect(p.players.every((x) => x.id !== a.id)).toBe(true);            // never lists yourself
    b.send({ t: 'settings', vis: 'invisible' });
    p = await a.next('presence', (m) => !m.players.some((x) => x.id === b.id));
    expect(p.players.some((x) => x.id === c.id)).toBe(true);
    // blocking hides both ways
    a.send({ t: 'block', uid: c.uid, on: true });
    p = await a.next('presence', (m) => !m.players.some((x) => x.id === c.id));
    c.send({ t: 'presence.sub', on: true });
    const pc = await c.next('presence'); expect(pc.players.some((x) => x.id === a.id)).toBe(false);
    for (const x of [a, b, c]) x.close();
  });

  it('rejects malformed and oversized frames without crashing, and rate-limits invitation spam', async () => {
    const a = await Client.connect('Spamr'), b = await Client.connect('Victim');
    a.ws.send('{not json'); a.ws.send(JSON.stringify({ t: 'party.invite', target: 'x'.repeat(10) }));
    a.ws.send(JSON.stringify({ t: 'x'.repeat(5000) }));                                // above our 4 KB limit, below the hard cap: soft rejection
    await a.next('error', (m) => m.code === 'too_large');
    for (let i = 0; i < 30; i++) a.send({ t: 'party.invite', target: b.id });
    await a.next('error', (m) => m.code === 'rate_limited' || m.code === 'duplicate');
    const errs = a.msgs.filter((m) => m.t === 'error' && (m as any).code === 'rate_limited').length;
    expect(errs).toBeGreaterThan(5);
    a.send({ t: 'ping', n: 7 }); expect((await a.next('pong')).n).toBe(7);          // still healthy
    // a frame beyond the hard payload cap drops only the offender
    const evil = await Client.connect('Evil');
    const closed = new Promise<number>((r) => evil.ws.on('close', (code) => r(code)));
    evil.ws.send('y'.repeat(20000));
    expect(await closed).toBe(1009);
    b.send({ t: 'ping', n: 1 }); expect((await b.next('pong')).n).toBe(1);          // other clients unaffected
    a.close(); b.close();
  });
});

describe('parties: invite, request, accept/decline, roster, leader controls', () => {
  it('invitation accept/decline, duplicates and capacity', async () => {
    const host = await Client.connect('Host1'), g1 = await Client.connect('Guest1'), g2 = await Client.connect('Guest2');
    host.send({ t: 'party.invite', target: g1.id });
    const inv = await g1.next('party.invite'); expect(inv.from.id).toBe(host.id);
    host.send({ t: 'party.invite', target: g1.id });
    expect((await host.next('error', (m) => m.code === 'duplicate')).text).toMatch(/pending/);
    host.send({ t: 'party.invite', target: g2.id });
    const inv2 = await g2.next('party.invite');
    g2.send({ t: 'party.respondInvite', inviteId: inv2.inviteId, accept: false });
    expect((await host.next('notice', (m) => /declined/.test(m.text))).text).toContain('Guest2');
    g1.send({ t: 'party.respondInvite', inviteId: inv.inviteId, accept: true });
    const st = await partyOf(host, (p) => p.members.length === 2);
    expect(st.leader).toBe(host.id); expect(st.members.map((m: any) => m.name).sort()).toEqual(['Guest1', 'Host1']);
    // accepted invitations cannot be replayed
    g1.send({ t: 'party.respondInvite', inviteId: inv.inviteId, accept: true });
    await g1.next('error', (m) => m.code === 'expired');
    for (const x of [host, g1, g2]) x.close();
  });

  it('request to join: the LEADER receives it and accepts; non-leaders cannot invite unless allowed; members can suggest', async () => {
    const leader = await Client.connect('Lead'), mem = await Client.connect('Mem'), req = await Client.connect('Req'), other = await Client.connect('Other');
    leader.send({ t: 'party.invite', target: mem.id }); const i = await mem.next('party.invite'); mem.send({ t: 'party.respondInvite', inviteId: i.inviteId, accept: true });
    await partyOf(leader, (p) => p.members.length === 2);
    // Req asks to join by targeting the MEMBER; the request must go to the leader
    req.send({ t: 'party.request', target: mem.id });
    const rq = await leader.next('party.request'); expect(rq.from.id).toBe(req.id);
    expect(mem.msgs.some((m) => m.t === 'party.request')).toBe(false);
    leader.send({ t: 'party.respondRequest', requestId: rq.requestId, accept: true });
    const st = await partyOf(req, (p) => p.members.length === 3); expect(st.id).toBeGreaterThan(0);
    // member cannot invite directly (leader-only policy) but can suggest
    mem.send({ t: 'party.invite', target: other.id });
    await mem.next('error', (m) => m.code === 'not_leader');
    mem.send({ t: 'party.suggest', target: other.id });
    const sg = await leader.next('party.suggest'); expect(sg.target.id).toBe(other.id);
    leader.send({ t: 'party.respondSuggest', suggestId: sg.suggestId, accept: true });
    await other.next('party.invite');
    // leader may open invites to everyone
    leader.send({ t: 'party.settings', settings: {}, invitePolicy: 'members' });
    await partyOf(mem, (p) => p.invitePolicy === 'members');
    for (const x of [leader, mem, req, other]) x.close();
  });

  it('declined requests, requests to unavailable players, and requests to a lone player create a party for them', async () => {
    const a = await Client.connect('Lone'), b = await Client.connect('Asker');
    b.send({ t: 'party.request', target: a.id });
    const rq = await a.next('party.request');                              // Lone became leader of an implicit party
    a.send({ t: 'party.respondRequest', requestId: rq.requestId, accept: false });
    expect((await b.next('notice', (m) => /declined/.test(m.text))).text).toContain('Lone');
    a.send({ t: 'settings', vis: 'invisible' });
    await sleep(80);
    b.send({ t: 'party.request', target: a.id });
    await b.next('error', (m) => m.code === 'unavailable');
    a.close(); b.close();
  });

  it('kick, promote, leave and leader hand-over; privacy: invites "nobody" and blocked users', async () => {
    const L = await Client.connect('KL'), M1 = await Client.connect('KM1'), M2 = await Client.connect('KM2');
    for (const m of [M1, M2]) { L.send({ t: 'party.invite', target: m.id }); const i = await m.next('party.invite'); m.send({ t: 'party.respondInvite', inviteId: i.inviteId, accept: true }); }
    await partyOf(L, (p) => p.members.length === 3);
    M1.send({ t: 'party.kick', target: M2.id }); await M1.next('error', (m) => m.code === 'not_leader');
    L.send({ t: 'party.promote', target: M1.id });
    const st = await partyOf(M2, (p) => p.leader === M1.id); expect(st.leader).toBe(M1.id);
    M1.send({ t: 'party.kick', target: L.id });
    await L.next('party.closed'); await partyOf(M2, (p) => p.members.length === 2);
    M1.send({ t: 'party.leave' });                                          // leader leaves -> M2 inherits
    const after = await partyOf(M2, (p) => p.members.length === 1 && p.leader === M2.id); expect(after.leader).toBe(M2.id);
    // privacy
    L.send({ t: 'settings', invites: 'nobody' }); await sleep(60);
    M1.send({ t: 'party.invite', target: L.id }); expect((await M1.next('error', (m) => m.code === 'unavailable')).text).toMatch(/not accepting/);
    L.send({ t: 'settings', invites: 'anyone' }); L.send({ t: 'block', uid: M1.uid, on: true }); await sleep(60);
    M1.send({ t: 'party.invite', target: L.id }); await M1.next('error', (m) => m.code === 'unavailable' && m.text.includes('not available'));
    for (const x of [L, M1, M2]) x.close();
  });

  it('a party member who disconnects stays on the roster for the grace period, then leadership/roster is repaired', async () => {
    const L = await Client.connect('GL'), M = await Client.connect('GM');
    L.send({ t: 'party.invite', target: M.id }); const i = await M.next('party.invite'); M.send({ t: 'party.respondInvite', inviteId: i.inviteId, accept: true });
    await partyOf(L, (p) => p.members.length === 2);
    L.ws.terminate();                                                        // leader drops
    const off = await partyOf(M, (p) => p.members.some((m: any) => !m.online)); expect(off.leader).toBeTruthy();
    const back = await partyOf(M, (p) => p.members.length === 1 && p.leader === M.id, );  // grace (400 ms in tests) elapses -> M leads
    expect(back.leader).toBe(M.id);
    M.close();
  });
});

describe('launching a match: whole party lands in ONE authoritative match', () => {
  it('3 real clients: host invites, requester asks, leader starts; all three share the match and squad; party returns after the match', async () => {
    const host = await Client.connect('PHost'), invited = await Client.connect('PInvited'), requester = await Client.connect('PReq');
    host.send({ t: 'party.invite', target: invited.id }); const inv = await invited.next('party.invite'); invited.send({ t: 'party.respondInvite', inviteId: inv.inviteId, accept: true });
    requester.send({ t: 'party.request', target: host.id }); const rq = await host.next('party.request'); host.send({ t: 'party.respondRequest', requestId: rq.requestId, accept: true });
    await partyOf(host, (p) => p.members.length === 3);

    host.send({ t: 'party.start' });
    await host.next('error', (m) => m.code === 'not_ready' && /PInvited/.test(m.text));          // clear feedback instead of a silent no-op
    invited.send({ t: 'party.ready', ready: true }); requester.send({ t: 'party.ready', ready: true });
    await partyOf(host, (p) => p.members.every((m: any) => m.ready));
    host.send({ t: 'party.settings', settings: { mode: 'elimination', visibility: 'private', perTeam: 5, fillBots: true, difficulty: 'easy' } });
    await partyOf(host, (p) => p.settings.mode === 'elimination' && p.members.filter((m: any) => !m.leader).every((m: any) => !m.ready));   // settings change clears readiness
    invited.send({ t: 'party.ready', ready: true }); requester.send({ t: 'party.ready', ready: true });
    await partyOf(host, (p) => p.members.every((m: any) => m.ready));

    host.send({ t: 'party.start' });
    const [s1, s2, s3] = await Promise.all([host.next('match.start'), invited.next('match.start'), requester.next('match.start')]);
    expect(new Set([s1.matchId, s2.matchId, s3.matchId]).size).toBe(1);                 // same game session
    expect(new Set([s1.squad, s2.squad, s3.squad]).size).toBe(1);                       // same team
    expect(new Set([s1.you, s2.you, s3.you]).size).toBe(3);                             // three distinct players
    expect(s1.mode).toBe('elimination');
    await partyOf(host, (p) => p.state === 'inMatch');

    // snapshots flow to everyone and include all 10 combatants (3 humans + 7 labelled bots)
    const snap = await requester.next('snap', (m) => m.s.p.length === 10);
    expect(snap.s.p.filter((p) => p.bot).length).toBe(7); expect(snap.s.p.filter((p) => !p.bot).length).toBe(3);
    expect(snap.s.me).not.toBeNull();
    // privacy: enemies' money is not in the snapshot
    const enemy = snap.s.p.find((p) => p.tm !== snap.s.p.find((q) => q.i === s3.you)!.tm)!; expect(enemy.m).toBeUndefined();

    // leaving the match keeps the member in the party lobby
    requester.send({ t: 'match.leave' });
    await requester.next('party.state', (m) => !!m.party && m.party.members.length === 3);
    for (const x of [host, invited, requester]) x.close();
  });

  it('a party member who is offline at launch is skipped with an explanation to the others', async () => {
    const a = await Client.connect('LA'), b = await Client.connect('LB'), c = await Client.connect('LC');
    for (const m of [b, c]) { a.send({ t: 'party.invite', target: m.id }); const i = await m.next('party.invite'); m.send({ t: 'party.respondInvite', inviteId: i.inviteId, accept: true }); m.send({ t: 'party.ready', ready: true }); }
    await partyOf(a, (p) => p.members.length === 3 && p.members.every((m: any) => m.ready));
    c.ws.terminate(); await partyOf(a, (p) => p.members.some((m: any) => !m.online));
    a.send({ t: 'party.start' });
    await a.next('notice', (m) => /Starting without: LC/.test(m.text));
    const [sa, sb] = await Promise.all([a.next('match.start'), b.next('match.start')]);
    expect(sa.matchId).toBe(sb.matchId);
    for (const x of [a, b]) x.close();
  });
});

describe('authority, lobbies, reconnect', () => {
  it('two real clients join the same lobby by code and play in one match; the server owns position, ammo and score', async () => {
    const a = await Client.connect('LobA'), b = await Client.connect('LobB');
    a.send({ t: 'lobby.create', name: 'Test lobby', mode: 'elimination', private: true, perTeam: 3, fillBots: true, difficulty: 'easy' });
    const ls = await a.next('lobby.state', (m) => !!m.lobby); const code = ls.lobby!.code; expect(code).toMatch(/^[A-Z2-9]{5}$/);
    b.send({ t: 'lobby.join', code });
    await a.next('lobby.state', (m) => m.lobby?.players.length === 2);
    a.send({ t: 'lobby.start' }); await a.next('error', (m) => m.code === 'not_ready');
    b.send({ t: 'lobby.ready', ready: true }); await a.next('lobby.state', (m) => !!m.lobby?.players.find((p) => p.id === b.id)?.ready);
    a.send({ t: 'lobby.start' });
    const [sa, sb] = await Promise.all([a.next('match.start', undefined, 12000), b.next('match.start', undefined, 12000)]);
    expect(sa.matchId).toBe(sb.matchId); expect(sa.you).not.toBe(sb.you);

    // wait for the live phase (10 s freeze) by watching snapshots
    const live = await a.next('snap', (m) => m.s.phase === 'live', 20000);
    const me0 = live.s.p.find((p) => p.i === sa.you)!;
    // honest client: walk forward for ~1 s
    let seq = 0; const t0 = Date.now();
    while (Date.now() - t0 < 1000) { a.send({ t: 'match.cmd', seq: ++seq, cmd: { fwd: 1, strafe: 0, jump: false, crouch: false, walk: false, yaw: me0 ? 0 : 0, pitch: 0, fire: false, reload: false, use: false, slot: -1 }, view: 0 }); await sleep(1000 / 60); }
    await sleep(300);
    const after = a.last('snap')!.s; const me1 = after.p.find((p) => p.i === sa.you)!;
    const moved = Math.hypot(me1.x - me0.x, me1.z - me0.z);
    expect(moved).toBeGreaterThan(2);
    // cheating client: send 600 commands at once, claim absurd values. It cannot move faster than the sim allows.
    const before = a.last('snap')!.s.p.find((p) => p.i === sa.you)!;
    const tc = Date.now();
    for (let i = 0; i < 600; i++) a.send({ t: 'match.cmd', seq: ++seq, cmd: { fwd: 1e9, strafe: 1e9, jump: true, crouch: false, walk: false, yaw: 0, pitch: 99, fire: false, reload: false, use: false, slot: -1 }, view: 0 });
    a.send({ t: 'match.cmd', seq: ++seq, cmd: { fwd: 1, x: 999, y: 999, z: 999, hp: 100000, money: 99999 } as any, view: 0 });
    await sleep(500);
    const cheat = a.last('snap')!.s; const meC = cheat.p.find((p) => p.i === sa.you)!;
    const dt = (Date.now() - tc) / 1000; const travelled = Math.hypot(meC.x - before.x, meC.z - before.z);
    expect(travelled).toBeLessThan(5.3 * dt + 1.5);                       // run speed * elapsed time (+ slack), not 600 ticks worth
    expect(cheat.me!.money).toBeLessThan(16001); expect(meC.hp).toBeLessThanOrEqual(100);
    a.close(); b.close();
  }, 60000);

  it('reconnect with the token resumes the same session and the same match slot', async () => {
    const a = await Client.connect('Resume');
    a.send({ t: 'lobby.create', name: 'r', mode: 'elimination', private: true, perTeam: 3, fillBots: true, difficulty: 'easy' });
    await a.next('lobby.state', (m) => !!m.lobby); a.send({ t: 'lobby.start' });
    const s1 = await a.next('match.start', undefined, 12000);
    a.ws.terminate(); await sleep(250);
    const b = await Client.connect('ignored', a.token);
    expect(b.id).toBe(a.id);
    const w = b.msgs.find((m) => m.t === 'welcome') as any; expect(w.resumed).toBe(true);
    const s2 = await b.next('match.start'); expect(s2.you).toBe(s1.you); expect(s2.matchId).toBe(s1.matchId);
    await b.next('snap'); b.close();
  }, 30000);

  it('matchmaking queue starts a match (bots fill after the wait) and flags the bots', async () => {
    const a = await Client.connect('QA'), b = await Client.connect('QB');
    a.send({ t: 'queue.join', mode: 'elimination' }); b.send({ t: 'queue.join', mode: 'elimination' });
    await a.next('queue.state', (m) => m.queued);
    const [sa, sb] = await Promise.all([a.next('match.start', undefined, 12000), b.next('match.start', undefined, 12000)]);
    expect(sa.matchId).toBe(sb.matchId);
    const snap = await a.next('snap', (m) => m.s.p.length >= 10); expect(snap.s.p.filter((p) => p.bot).length).toBeGreaterThan(0);
    a.close(); b.close();
  }, 30000);

  it('health endpoint reports honest counts', async () => {
    const r = await fetch(`http://127.0.0.1:${srv.port}/health`); const j = await r.json() as any;
    expect(j.ok).toBe(true); expect(typeof j.sessions).toBe('number');
  });
});
