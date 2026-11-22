/**
 * Online panel: connect, live player list, Xbox-style party, lobbies + matchmaking, privacy.
 * Everything shown here comes from the server; there is no fake roster or fake presence.
 */
import { NetClient, defaultServerUrl, loadNetPrefs, saveNetPrefs } from '../network/client.ts';
import type { PresenceEntry, PartyState, LobbyState, LobbyListing, PartySettings, InvitePolicy, Visibility } from '../network/protocol.ts';
import type { Game } from '../game/game.ts';
import { h, toast } from './screens.ts';
import { loadSettings, updateSettings } from '../engine/settings.ts';
import { sfx } from '../audio/sfx.ts';

type Tab = 'play' | 'players' | 'party' | 'privacy';
interface Pending { kind: 'invite' | 'request' | 'suggest'; id: number; text: string; expires: number; }

export class OnlinePanel {
  readonly net = new NetClient();
  private host: HTMLElement;
  private overlay: HTMLElement | null = null;
  private notes: HTMLElement;
  private tab: Tab = 'play';
  presence: PresenceEntry[] = []; onlineCount = 0;
  party: PartyState | null = null; lobby: LobbyState | null = null; lobbies: LobbyListing[] = [];
  queue = { queued: false, since: 0, waiting: 0 };
  private pending: Pending[] = [];
  private url = defaultServerUrl();
  private busy = false; private error = '';
  private dirty = false;
  private tick: ReturnType<typeof setInterval>;
  private isOpen = false;
  private joinCode = '';
  private lobbyForm = { name: '', mode: 'objective' as 'objective' | 'elimination', private: true, perTeam: 3 as 3 | 5, fillBots: true, difficulty: 'normal' as 'easy' | 'normal' | 'hard' };

  constructor(private game: Game, private menuRoot: HTMLElement) {
    this.host = h('div', { id: 'online-host' }); document.body.appendChild(this.host);
    this.notes = h('div', { class: 'toasts', style: { bottom: '90px', zIndex: '45' } }); document.body.appendChild(this.notes);
    const saved = loadNetPrefs(); if (saved.url) this.url = saved.url;
    const net = this.net;
    net.onStatus = (s, d) => { if (s === 'closed' || s === 'reconnecting') { this.error = s === 'reconnecting' ? `Reconnecting… ${d ?? ''}` : this.error; } this.refresh(); };
    net.on('presence', (m) => { this.presence = m.players; this.onlineCount = m.online; this.refresh(); });
    net.on('party.state', (m) => { this.party = m.party; this.refresh(); });
    net.on('party.closed', (m) => { toast(m.reason); this.party = null; this.refresh(); });
    net.on('lobby.state', (m) => { this.lobby = m.lobby; this.refresh(); });
    net.on('lobby.list', (m) => { this.lobbies = m.lobbies; this.refresh(); });
    net.on('queue.state', (m) => { this.queue = m; this.refresh(); });
    net.on('notice', (m) => { toast(m.text, 3600); });
    net.on('error', (m) => { toast(m.text, 4200); sfx.uiError(); });
    net.on('party.invite', (m) => this.addPending({ kind: 'invite', id: m.inviteId, text: `${m.from.name} invited you to their party`, expires: Date.now() + m.ttl }));
    net.on('party.request', (m) => this.addPending({ kind: 'request', id: m.requestId, text: `${m.from.name} wants to join your party`, expires: Date.now() + m.ttl }));
    net.on('party.suggest', (m) => this.addPending({ kind: 'suggest', id: m.suggestId, text: `${m.from.name} suggests inviting ${m.target.name}`, expires: Date.now() + m.ttl }));
    net.on('match.start', (m) => {
      this.close(); this.queue.queued = false;
      if (this.game.state === 'playing' && this.game.online) return;       // resume after reconnect: session already running
      this.menuRoot.classList.add('hidden');
      this.game.startOnline(net, { you: m.you, squad: m.squad, mode: m.mode });
    });
    net.on('match.end', (m) => { this.game.netMatchEnded(m.winnerSquad); });
    this.game.onMatchEnd = () => { this.menuRoot.classList.remove('hidden'); this.tab = this.party ? 'party' : 'play'; this.open(); };
    this.tick = setInterval(() => { this.sweepPending(); if (this.dirty) this.render(); }, 500);
    (window as unknown as { __hf: Record<string, unknown> }).__hf.online = this;
  }

  // ------------------------------------------------------------------ lifecycle
  get connected() { return this.net.status === 'open'; }
  open(tab?: Tab) { if (tab) this.tab = tab; this.isOpen = true; this.menuRoot.classList.add('hidden'); this.render(); if (this.connected) this.net.send({ t: 'presence.sub', on: true }); }
  close() { this.isOpen = false; this.overlay?.remove(); this.overlay = null; if (this.game.state === 'menu') this.menuRoot.classList.remove('hidden'); }
  private refresh() { this.dirty = true; if (this.overlay) { /* debounce re-render to the next tick for smoothness */ } this.renderNotes(); }

  async connect() {
    const name = (loadSettings().name || '').trim() || `Guest${Math.floor(1000 + Math.random() * 9000)}`;
    this.busy = true; this.error = ''; this.render();
    try {
      saveNetPrefs({ url: this.url }); updateSettings({ name });
      const me = await this.net.connect(this.url, name);
      this.busy = false; toast(`Connected as ${me.name}`);
      const p = loadNetPrefs(); this.net.send({ t: 'settings', vis: p.vis, invites: p.invites });
      this.net.send({ t: 'presence.sub', on: true }); this.net.send({ t: 'lobby.list' });
    } catch (e) { this.busy = false; this.error = (e as Error).message; }
    this.render();
  }
  disconnect() { this.net.close(); this.party = null; this.lobby = null; this.presence = []; this.queue = { queued: false, since: 0, waiting: 0 }; this.render(); }

  // ------------------------------------------------------------------ notifications (invites / requests)
  private addPending(p: Pending) { this.pending.push(p); sfx.uiClick(); this.renderNotes(); if (this.game.state === 'playing') toast('Pause (Esc) to answer a party notification.', 3200); }
  private sweepPending() { const n = Date.now(); const before = this.pending.length; this.pending = this.pending.filter((p) => p.expires > n); if (before !== this.pending.length) this.renderNotes(); }
  private renderNotes() {
    this.notes.innerHTML = '';
    for (const p of this.pending) {
      const respond = (accept: boolean) => {
        const t = p.kind === 'invite' ? 'party.respondInvite' : p.kind === 'request' ? 'party.respondRequest' : 'party.respondSuggest';
        const key = p.kind === 'invite' ? 'inviteId' : p.kind === 'request' ? 'requestId' : 'suggestId';
        this.net.send({ t, [key]: p.id, accept } as never); this.pending = this.pending.filter((x) => x !== p); this.renderNotes();
        if (accept && p.kind === 'invite') { this.tab = 'party'; }
      };
      this.notes.appendChild(h('div', { class: 't', 'data-pending': p.kind, style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        h('span', {}, p.text), h('button', { class: 'btn primary', 'data-act': 'accept', style: { padding: '5px 12px' }, onClick: () => respond(true) }, 'Accept'), h('button', { class: 'btn', 'data-act': 'decline', style: { padding: '5px 12px' }, onClick: () => respond(false) }, 'Decline')));
    }
  }

  // ------------------------------------------------------------------ rendering
  private render() {
    this.dirty = false;
    if (!this.isOpen) { this.renderNotes(); return; }      // never draw over a running match
    const body = !this.connected ? this.connectView() : this.tabView();
    const status = this.net.status === 'open' ? h('span', { class: 'pill ok' }, `Connected · ${Math.round(this.net.rtt)} ms`) : this.net.status === 'reconnecting' ? h('span', { class: 'pill warn' }, 'Reconnecting') : h('span', { class: 'pill' }, 'Not connected');
    const el = h('div', { class: 'overlay', 'data-screen': 'online' }, h('div', { class: 'card', style: { width: 'min(900px, 96vw)', minHeight: '480px' } },
      h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Online'), status,
        this.connected ? h('button', { class: 'btn', 'data-act': 'disconnect', onClick: () => this.disconnect() }, 'Disconnect') : null,
        h('button', { class: 'btn', 'data-act': 'close', onClick: () => this.close() }, 'Back')),
      h('div', { style: { height: '10px' } }), body));
    this.overlay?.remove(); this.overlay = el; this.host.appendChild(el);
    this.renderNotes();
  }

  private connectView(): HTMLElement {
    const s = loadSettings();
    return h('div', { class: 'col', style: { gap: '14px', maxWidth: '560px' } },
      h('p', { class: 'dim', style: { margin: 0, lineHeight: 1.5 } }, 'Online play uses a separate game server. You join as a guest: no account, nothing but a display name is stored. Only players who allow it are shown in the list.'),
      h('label', { class: 'f' }, 'Display name', h('input', { type: 'text', value: s.name, maxlength: 16, placeholder: 'Guest', 'data-field': 'name', onChange: (e: Event) => updateSettings({ name: (e.target as HTMLInputElement).value }) })),
      h('label', { class: 'f' }, 'Server address', h('input', { type: 'text', value: this.url, 'data-field': 'url', spellcheck: false, onChange: (e: Event) => { this.url = (e.target as HTMLInputElement).value.trim(); } })),
      this.error ? h('div', { class: 'pill bad', style: { alignSelf: 'flex-start', whiteSpace: 'normal' } }, this.error) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary big', 'data-act': 'connect', disabled: this.busy ? true : null, onClick: () => { void this.connect(); } }, this.busy ? 'Connecting…' : 'Connect')),
      h('div', { class: 'dim', style: { fontSize: '12px', lineHeight: 1.5 } }, 'Run the server locally with ', h('span', { class: 'kbd' }, 'npm run server'), ' (listens on ws://localhost:8787/ws). For internet play host it behind TLS and enter its wss:// address here.'));
  }

  private tabView(): HTMLElement {
    const tabs = h('div', { class: 'tabs' }, ...(['play', 'players', 'party', 'privacy'] as Tab[]).map((t) => h('button', { class: this.tab === t ? 'on' : '', 'data-tab': t, onClick: () => { this.tab = t; if (t === 'play') this.net.send({ t: 'lobby.list' }); this.render(); } },
      t === 'players' ? `Players (${this.presence.length})` : t === 'party' ? `Party${this.party ? ` (${this.party.members.length})` : ''}` : t)));
    const view = this.tab === 'play' ? this.playView() : this.tab === 'players' ? this.playersView() : this.tab === 'party' ? this.partyView() : this.privacyView();
    return h('div', {}, tabs, view);
  }

  // ---------------- Play tab
  private playView(): HTMLElement {
    const n = this.net;
    if (this.lobby) return this.lobbyView(this.lobby);
    const seg = <T extends string | number | boolean>(cur: T, opts: [T, string][], set: (v: T) => void) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', onClick: () => { set(v); this.render(); } }, l)));
    const f = this.lobbyForm;
    const inParty = !!this.party && this.party.members.length > 1;
    return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))', gap: '22px' } },
      h('div', { class: 'col', style: { gap: '12px' } },
        h('h3', {}, 'Matchmaking'),
        this.queue.queued ? h('div', { class: 'col' }, h('div', {}, h('span', { class: 'pill warn' }, 'Searching'), ` ${this.queue.waiting} player(s) in the queue`), h('div', { class: 'dim', style: { fontSize: '13px' } }, 'If not enough players are found within a few seconds, bots fill the teams and are always labelled [BOT].'),
          h('button', { class: 'btn', 'data-act': 'queue-leave', onClick: () => (this.party ? n.send({ t: 'party.cancel' }) : n.send({ t: 'queue.leave' })) }, 'Cancel search'))
          : h('div', { class: 'col' }, inParty ? h('div', { class: 'dim', style: { fontSize: '13px' } }, 'You are in a party: the leader starts matches from the Party tab.') : h('div', { class: 'row' },
            h('button', { class: 'btn primary', 'data-act': 'queue-objective', onClick: () => n.send({ t: 'queue.join', mode: 'objective' }) }, 'Find match · Objective'), h('button', { class: 'btn', 'data-act': 'queue-elim', onClick: () => n.send({ t: 'queue.join', mode: 'elimination' }) }, 'Elimination'))),
        h('h3', {}, 'Join with a code'),
        h('div', { class: 'row' }, h('input', { type: 'text', placeholder: 'ABCDE', maxlength: 8, value: this.joinCode, 'data-field': 'code', style: { width: '120px', textTransform: 'uppercase' }, onInput: (e: Event) => { this.joinCode = (e.target as HTMLInputElement).value; } }),
          h('button', { class: 'btn', 'data-act': 'join-code', onClick: () => n.send({ t: 'lobby.join', code: this.joinCode }) }, 'Join')),
        h('h3', {}, 'Create a lobby'),
        h('div', { class: 'col' },
          h('label', { class: 'f' }, 'Name', h('input', { type: 'text', value: f.name, maxlength: 24, placeholder: 'My game', 'data-field': 'lobby-name', onInput: (e: Event) => { f.name = (e.target as HTMLInputElement).value; } })),
          h('div', { class: 'row' }, seg(f.mode, [['objective', 'Objective'], ['elimination', 'Elimination']], (v) => (f.mode = v)), seg(f.perTeam, [[3, '3v3'], [5, '5v5']], (v) => (f.perTeam = v))),
          h('div', { class: 'row' }, seg(f.private, [[true, 'Private (code)'], [false, 'Public']], (v) => (f.private = v)), seg(f.fillBots, [[true, 'Fill with bots'], [false, 'Humans only']], (v) => (f.fillBots = v))),
          h('button', { class: 'btn', 'data-act': 'create-lobby', onClick: () => n.send({ t: 'lobby.create', name: f.name, mode: f.mode, private: f.private, perTeam: f.perTeam, fillBots: f.fillBots, difficulty: f.difficulty }) }, 'Create lobby'))),
      h('div', { class: 'col' },
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Public lobbies'), h('button', { class: 'btn', 'data-act': 'refresh-lobbies', style: { padding: '5px 12px' }, onClick: () => n.send({ t: 'lobby.list' }) }, 'Refresh')),
        this.lobbies.length ? h('div', { class: 'col' }, ...this.lobbies.map((l) => h('div', { class: 'row', 'data-lobby': l.id, style: { justifyContent: 'space-between', background: '#12171b', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px 12px' } },
          h('div', {}, h('div', { style: { fontWeight: 700 } }, l.name), h('div', { class: 'dim', style: { fontSize: '12px' } }, `${l.mode} · host ${l.host} · ${l.players}/${l.max}`)),
          h('button', { class: 'btn primary', 'data-act': 'join-lobby', style: { padding: '5px 12px' }, onClick: () => n.send({ t: 'lobby.join', id: l.id }) }, 'Join'))))
          : h('div', { class: 'dim', style: { fontSize: '14px' } }, 'No public lobbies right now. Create one, or queue for a match.')));
  }

  private lobbyView(l: LobbyState): HTMLElement {
    const n = this.net; const me = n.me!;
    const col = (sq: 0 | 1) => h('div', { class: 'col', style: { flex: 1 } }, h('h3', { style: { color: sq === 0 ? 'var(--van)' : 'var(--gar)' } }, `Team ${sq + 1}`),
      ...l.players.filter((p) => p.squad === sq).map((p) => h('div', { class: 'row', style: { justifyContent: 'space-between', background: '#12171b', border: '1px solid var(--line)', borderRadius: '6px', padding: '6px 10px' } }, h('span', {}, p.name, p.id === l.host ? ' ★' : ''), h('span', { class: `pill ${p.ready ? 'ok' : ''}` }, p.ready ? 'ready' : 'not ready'))),
      h('button', { class: 'btn', 'data-act': 'join-team', style: { padding: '5px 12px' }, onClick: () => n.send({ t: 'lobby.team', squad: sq }) }, 'Join this team'));
    const iAmHost = l.host === me.id; const mine = l.players.find((p) => p.id === me.id);
    return h('div', { class: 'col', style: { gap: '14px' }, 'data-view': 'lobby' },
      h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, l.name), l.private ? h('span', { class: 'pill' }, `Code ${l.code}`) : h('span', { class: 'pill ok' }, 'Public'), h('span', { class: 'pill' }, `${l.mode} · ${l.perTeam}v${l.perTeam}${l.fillBots ? ' · bots fill' : ''}`)),
      l.state === 'countdown' ? h('div', { class: 'big sand', style: { fontSize: '30px', fontWeight: 900 } }, `Starting in ${l.countdown}…`) : null,
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '24px' } }, col(0), col(1)),
      h('div', { class: 'row' },
        iAmHost ? h('button', { class: 'btn primary', 'data-act': 'lobby-start', onClick: () => n.send({ t: 'lobby.start' }) }, 'Start match') : h('button', { class: 'btn primary', 'data-act': 'lobby-ready', onClick: () => n.send({ t: 'lobby.ready', ready: !mine?.ready }) }, mine?.ready ? 'Not ready' : 'Ready'),
        h('button', { class: 'btn danger', 'data-act': 'lobby-leave', onClick: () => n.send({ t: 'lobby.leave' }) }, 'Leave lobby')));
  }

  // ---------------- Players tab
  private playersView(): HTMLElement {
    const n = this.net; const hasParty = !!this.party;
    const rows = this.presence.map((p) => {
      const status = ({ online: 'Online', party: 'In a party', queue: 'In queue', lobby: 'In a lobby', match: 'In a match', away: 'Away' } as const)[p.status];
      const statusCls = p.status === 'online' ? 'ok' : p.status === 'match' ? 'bad' : 'warn';
      return h('div', { class: 'row', 'data-player': p.id, style: { background: '#12171b', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px 12px', justifyContent: 'space-between' } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('span', { class: 'avatar' }, p.name.slice(0, 2).toUpperCase()), h('div', {}, h('div', { style: { fontWeight: 700 } }, (p.fav ? '★ ' : '') + p.name), h('div', {}, h('span', { class: `pill ${statusCls}` }, status), p.party ? h('span', { class: 'dim', style: { fontSize: '12px', marginLeft: '8px' } }, `party ${p.party.size}/${p.party.max}`) : null))),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn primary', 'data-act': 'invite', style: { padding: '5px 10px' }, onClick: () => n.send({ t: hasParty && this.party!.leader !== n.me!.id && this.party!.invitePolicy === 'leader' ? 'party.suggest' : 'party.invite', target: p.id }) }, hasParty && this.party!.leader !== n.me!.id && this.party!.invitePolicy === 'leader' ? 'Suggest invite' : 'Invite'),
          h('button', { class: 'btn', 'data-act': 'request', title: 'Ask to join their party', disabled: p.party && !p.party.joinable ? true : null, style: { padding: '5px 10px' }, onClick: () => n.send({ t: 'party.request', target: p.id }) }, 'Request to join'),
          h('button', { class: 'btn', 'data-act': 'fav', style: { padding: '5px 10px' }, onClick: () => this.toggleFav(p) }, p.fav ? '★' : '☆'),
          h('button', { class: 'btn danger', 'data-act': 'block', style: { padding: '5px 10px' }, onClick: () => this.block(p) }, 'Block')));
    });
    return h('div', { class: 'col', 'data-view': 'players' },
      h('div', { class: 'dim', style: { fontSize: '13px' } }, `${this.onlineCount} connected · you can see ${this.presence.length} who allow it. Players who set themselves to invisible, or who blocked you, never appear.`),
      rows.length ? h('div', { class: 'col', style: { maxHeight: '48vh', overflow: 'auto' } }, ...rows) : h('div', { class: 'dim', style: { padding: '24px 0' } }, 'Nobody else is online right now. Open the game in a second browser window to try parties yourself.'));
  }

  private toggleFav(p: PresenceEntry) {
    const prefs = loadNetPrefs(); const set = new Set(prefs.favorites); if (set.has(p.uid)) set.delete(p.uid); else set.add(p.uid);
    saveNetPrefs({ favorites: [...set] }); this.net.send({ t: 'friend', uid: p.uid, add: set.has(p.uid) });
  }
  private block(p: PresenceEntry) {
    const prefs = loadNetPrefs(); const set = new Set(prefs.blocked); set.add(p.uid);
    const names = (prefs as unknown as { blockedNames?: Record<string, string> }).blockedNames ?? {}; names[p.uid] = p.name;
    saveNetPrefs({ blocked: [...set], ...({ blockedNames: names } as object) }); this.net.send({ t: 'block', uid: p.uid, on: true }); toast(`Blocked ${p.name}`);
  }

  // ---------------- Party tab
  private partyView(): HTMLElement {
    const n = this.net; const p = this.party;
    if (!p) return h('div', { class: 'col', style: { gap: '12px', maxWidth: '520px' }, 'data-view': 'party-empty' }, h('p', { class: 'dim', style: { lineHeight: 1.5 } }, 'You are not in a party. Create one and invite players from the Players tab, or ask to join someone else\'s party there. The party leader chooses the mode and starts the match for everyone.'),
      h('button', { class: 'btn primary', 'data-act': 'create-party', style: { alignSelf: 'flex-start' }, onClick: () => n.send({ t: 'party.create' }) }, 'Create party'));
    const me = n.me!; const iLead = p.leader === me.id; const mine = p.members.find((m) => m.id === me.id);
    const st = p.settings; const locked = p.state !== 'lobby';
    const set = (patch: Partial<PartySettings>, policy?: 'leader' | 'members') => n.send({ t: 'party.settings', settings: patch, invitePolicy: policy });
    const seg = <T extends string | number | boolean>(cur: T, opts: [T, string][], fn: (v: T) => void) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', disabled: !iLead || locked ? true : null, onClick: () => fn(v) }, l)));
    const stateLabel = ({ lobby: 'In party lobby', queue: 'Searching for a match', starting: 'Starting…', inMatch: 'In a match' } as const)[p.state];
    return h('div', { class: 'col', style: { gap: '14px' }, 'data-view': 'party' },
      h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, `Party · ${p.members.length}/${p.max}`), h('span', { class: `pill ${p.state === 'lobby' ? 'ok' : 'warn'}`, 'data-party-state': p.state }, stateLabel)),
      h('div', { class: 'col' }, ...p.members.map((m) => h('div', { class: 'row', 'data-member': m.id, style: { background: '#12171b', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px 12px', justifyContent: 'space-between', opacity: m.online ? 1 : 0.55 } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('span', { class: 'avatar' }, m.name.slice(0, 2).toUpperCase()), h('div', {}, h('div', { style: { fontWeight: 700 } }, `${m.leader ? '👑 ' : ''}${m.name}${m.id === me.id ? ' (you)' : ''}`),
          h('div', {}, h('span', { class: `pill ${m.online ? (m.ready ? 'ok' : '') : 'bad'}` }, !m.online ? 'offline' : m.leader ? 'leader' : m.ready ? 'ready' : 'not ready'), m.status === 'match' ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'in a match') : null))),
        iLead && m.id !== me.id ? h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn', 'data-act': 'promote', style: { padding: '5px 10px' }, disabled: locked || !m.online ? true : null, onClick: () => n.send({ t: 'party.promote', target: m.id }) }, 'Make leader'), h('button', { class: 'btn danger', 'data-act': 'kick', style: { padding: '5px 10px' }, disabled: locked ? true : null, onClick: () => n.send({ t: 'party.kick', target: m.id }) }, 'Remove')) : null))),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '28px' } },
        h('div', { class: 'col' }, h('h3', {}, 'Match settings' + (iLead ? '' : ' (leader only)')),
          seg(st.mode, [['objective', 'Objective'], ['elimination', 'Elimination']], (v) => set({ mode: v })),
          seg(st.visibility, [['private', 'Private (your party only + bots)'], ['public', 'Public (matchmaking)']], (v) => set({ visibility: v })),
          h('div', { class: 'row' }, seg(st.perTeam, [[3, '3v3'], [5, '5v5']], (v) => set({ perTeam: v })), seg(st.fillBots, [[true, 'Bots fill'], [false, 'No bots']], (v) => set({ fillBots: v }))),
          seg(st.difficulty, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => set({ difficulty: v })),
          seg(p.invitePolicy, [['leader', 'Only leader invites'], ['members', 'Members can invite']], (v) => set({}, v))),
        h('div', { class: 'col', style: { gap: '10px' } }, h('h3', {}, 'Actions'),
          !iLead ? h('button', { class: 'btn primary', 'data-act': 'ready', disabled: locked ? true : null, onClick: () => n.send({ t: 'party.ready', ready: !mine?.ready }) }, mine?.ready ? 'Not ready' : 'Ready up') : null,
          iLead && p.state === 'lobby' ? h('button', { class: 'btn primary big', 'data-act': 'start-party', onClick: () => n.send({ t: 'party.start' }) }, 'START FOR PARTY') : null,
          iLead && p.state === 'queue' ? h('button', { class: 'btn', 'data-act': 'cancel-queue', onClick: () => n.send({ t: 'party.cancel' }) }, 'Cancel matchmaking') : null,
          p.state === 'inMatch' ? h('div', { class: 'dim', style: { fontSize: '13px', maxWidth: '260px' } }, 'The party is in a match. When it ends everyone returns here and the leader can queue again.') : null,
          h('button', { class: 'btn danger', 'data-act': 'leave-party', onClick: () => n.send({ t: 'party.leave' }) }, 'Leave party'))));
  }

  // ---------------- Privacy tab
  private privacyView(): HTMLElement {
    const prefs = loadNetPrefs(); const n = this.net;
    const apply = (vis: Visibility, invites: InvitePolicy) => { saveNetPrefs({ vis, invites }); n.send({ t: 'settings', vis, invites }); this.render(); };
    const seg = <T extends string>(cur: T, opts: [T, string][], fn: (v: T) => void) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', onClick: () => fn(v) }, l)));
    const names = (prefs as unknown as { blockedNames?: Record<string, string> }).blockedNames ?? {};
    return h('div', { class: 'col', style: { gap: '16px', maxWidth: '600px' }, 'data-view': 'privacy' },
      h('label', { class: 'f' }, 'Who can see me online', seg<Visibility>(prefs.vis, [['public', 'Everyone'], ['invisible', 'Invisible (appear offline)']], (v) => apply(v, prefs.invites))),
      h('label', { class: 'f' }, 'Who can invite me', seg<InvitePolicy>(prefs.invites, [['anyone', 'Anyone'], ['favorites', 'Favorites only'], ['nobody', 'Nobody']], (v) => apply(prefs.vis, v))),
      h('h3', {}, 'Blocked players'),
      prefs.blocked.length ? h('div', { class: 'col' }, ...prefs.blocked.map((uid) => h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', {}, names[uid] ?? uid), h('button', { class: 'btn', style: { padding: '4px 10px' }, onClick: () => { saveNetPrefs({ blocked: prefs.blocked.filter((x) => x !== uid) }); n.send({ t: 'block', uid, on: false }); this.render(); } }, 'Unblock')))) : h('div', { class: 'dim' }, 'Nobody blocked.'),
      h('div', { class: 'dim', style: { fontSize: '12px', lineHeight: 1.5 } }, 'Your identity is a random guest token kept in this browser. Clearing site data creates a new identity and removes your favourites and block list.'));
  }
}
