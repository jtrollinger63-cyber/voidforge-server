/**
 * Wire protocol shared by the browser client and the Node server. JSON text frames, one object per frame: { t: "<type>", ... }.
 * Everything coming from a client is untrusted: use the validators below on the server.
 */
import type { Mode } from '../gameplay/sim.ts';

export const PROTOCOL_VERSION = 1;
export const LIMITS = {
  maxFrameBytes: 4096,
  maxName: 16,
  maxPartySize: 5,
  maxMatchHumans: 10,
  inviteTtlMs: 30_000,
  requestTtlMs: 60_000,
  suggestTtlMs: 60_000,
  reconnectGraceMs: 25_000,
  partyGraceMs: 20_000,
  cmdQueueMax: 8,
  lobbyCountdownS: 5,
  matchmakerBotFillAfterS: 8,
} as const;

export type Status = 'online' | 'party' | 'queue' | 'lobby' | 'match' | 'away';
export type Visibility = 'public' | 'invisible';
export type InvitePolicy = 'anyone' | 'favorites' | 'nobody';
export type PartyInvitePolicy = 'leader' | 'members';

export interface PresenceEntry { id: number; uid: string; name: string; status: Status; party: { id: number; size: number; max: number; joinable: boolean } | null; fav: boolean; }

export interface PartySettings { mode: Mode; visibility: 'private' | 'public'; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard'; }
export interface PartyMemberView { id: number; uid: string; name: string; ready: boolean; online: boolean; status: Status; leader: boolean; }
export interface PartyState { id: number; leader: number; members: PartyMemberView[]; settings: PartySettings; invitePolicy: PartyInvitePolicy; state: 'lobby' | 'queue' | 'starting' | 'inMatch'; max: number; }

export interface LobbyPlayer { id: number; name: string; squad: 0 | 1; ready: boolean; party: number | null; }
export interface LobbyState { id: number; code: string; name: string; host: number; mode: Mode; private: boolean; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard'; state: 'waiting' | 'countdown' | 'live'; countdown: number; players: LobbyPlayer[]; }
export interface LobbyListing { id: number; name: string; mode: Mode; players: number; max: number; host: string; perTeam: number; }

/** client -> server */
export type ClientMsg =
  | { t: 'hello'; v: number; name: string; token?: string; favorites?: string[]; blocked?: string[] }
  | { t: 'ping'; n: number }
  | { t: 'presence.sub'; on: boolean }
  | { t: 'settings'; vis?: Visibility; invites?: InvitePolicy }
  | { t: 'friend'; uid: string; add: boolean }
  | { t: 'block'; uid: string; on: boolean }
  | { t: 'party.create' }
  | { t: 'party.invite'; target: number }
  | { t: 'party.request'; target: number }
  | { t: 'party.suggest'; target: number }
  | { t: 'party.respondInvite'; inviteId: number; accept: boolean }
  | { t: 'party.respondRequest'; requestId: number; accept: boolean }
  | { t: 'party.respondSuggest'; suggestId: number; accept: boolean }
  | { t: 'party.leave' } | { t: 'party.kick'; target: number } | { t: 'party.promote'; target: number }
  | { t: 'party.ready'; ready: boolean } | { t: 'party.settings'; settings: Partial<PartySettings>; invitePolicy?: PartyInvitePolicy }
  | { t: 'party.start' } | { t: 'party.cancel' }
  | { t: 'lobby.list' } | { t: 'lobby.create'; name: string; mode: Mode; private: boolean; perTeam: 3 | 5; fillBots: boolean; difficulty: 'easy' | 'normal' | 'hard' }
  | { t: 'lobby.join'; id?: number; code?: string } | { t: 'lobby.leave' } | { t: 'lobby.team'; squad: 0 | 1 } | { t: 'lobby.ready'; ready: boolean } | { t: 'lobby.start' }
  | { t: 'queue.join'; mode: Mode } | { t: 'queue.leave' }
  | { t: 'match.cmd'; seq: number; cmd: WireCmd; view: number } | { t: 'match.buy'; item: string } | { t: 'match.leave' };

export interface WireCmd { fwd: number; strafe: number; jump: boolean; crouch: boolean; walk: boolean; yaw: number; pitch: number; fire: boolean; reload: boolean; use: boolean; slot: number; aim?: boolean; }

/** server -> client */
export type ServerMsg =
  | { t: 'welcome'; id: number; uid: string; token: string; name: string; v: number; resumed: boolean; serverTime: number }
  | { t: 'pong'; n: number; serverTime: number }
  | { t: 'error'; code: string; text: string; ref?: string }
  | { t: 'notice'; text: string }
  | { t: 'presence'; players: PresenceEntry[]; online: number }
  | { t: 'party.state'; party: PartyState | null }
  | { t: 'party.invite'; inviteId: number; from: { id: number; name: string }; partyId: number; ttl: number }
  | { t: 'party.request'; requestId: number; from: { id: number; name: string }; ttl: number }
  | { t: 'party.suggest'; suggestId: number; from: { id: number; name: string }; target: { id: number; name: string }; ttl: number }
  | { t: 'party.closed'; reason: string }
  | { t: 'lobby.list'; lobbies: LobbyListing[] }
  | { t: 'lobby.state'; lobby: LobbyState | null }
  | { t: 'queue.state'; queued: boolean; since: number; waiting: number }
  | { t: 'match.start'; matchId: number; you: number; squad: 0 | 1; mode: Mode; seed: number; tickRate: number }
  | { t: 'match.end'; matchId: number; winnerSquad: 0 | 1 | null; reason: string }
  | { t: 'snap'; s: Snapshot }
  | { t: 'ev'; e: unknown[] };

export interface SnapPlayer {
  i: number; n: string; sq: 0 | 1; tm: 0 | 1; bot: 0 | 1;
  x: number; y: number; z: number; r: number; q: number; v: number;
  /** bit0 alive, bit1 crouching, bit2 onGround, bit3 reloading, bit4 hasDevice, bit5 plant, bit6 defuse, bit7 helmet, bit8 kit, bit9 connected */
  f: number; hp: number; ar: number; w: string; cur: number;
  k: number; d: number; a: number; sc: number; m?: number;
  fa: number; ra: number; ha: number; da: number; ru: number; pc: number; pp: number;
}
export interface SnapMe { mag: number; res: number; slots: (string | null)[]; money: number; reloadT: number; equipT: number; useT: number; vx: number; vy: number; vz: number; jc: number; ground: number; punchP: number; punchY: number; spray: number; ammo: Record<string, [number, number]>; }
export interface Snapshot { tick: number; time: number; ack: number; phase: string; phaseT: number; phaseE: number; round: number; mode: Mode; score: [number, number]; swapped: boolean; bomb: { s: string; x: number; y: number; z: number; site: string | null; tl: number; c: number }; p: SnapPlayer[]; me: SnapMe | null; win: { w: number | null; r: string } | null; mw: number | null; ls: [number, number]; }

// ------------------------------------------------------------------ validation helpers (server side)
const num = (v: unknown, lo: number, hi: number, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown) => v === true;

export function validCmd(c: unknown): WireCmd | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  return {
    fwd: num(o.fwd, -1, 1), strafe: num(o.strafe, -1, 1), jump: bool(o.jump), crouch: bool(o.crouch), walk: bool(o.walk),
    yaw: num(o.yaw, -1e4, 1e4), pitch: num(o.pitch, -1.57, 1.57), fire: bool(o.fire), reload: bool(o.reload), use: bool(o.use),
    slot: Math.trunc(num(o.slot, -1, 2, -1)), aim: bool(o.aim),
  };
}

export function sanitizeName(raw: unknown, fallback = 'Guest'): string {
  const s = String(raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxName);
  return s.length >= 2 ? s : fallback;
}

export function makeCode(rnd: () => number = Math.random): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(rnd() * A.length)];
  return s;
}

export const MODES: Mode[] = ['objective', 'elimination'];
export const isMode = (m: unknown): m is Mode => m === 'objective' || m === 'elimination';
export const isDiff = (d: unknown): d is 'easy' | 'normal' | 'hard' => d === 'easy' || d === 'normal' || d === 'hard';
