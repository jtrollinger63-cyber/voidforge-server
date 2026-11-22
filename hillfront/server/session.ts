import type { WebSocket } from 'ws';
import type { InvitePolicy, ServerMsg, Status, Visibility } from '../src/network/protocol.ts';

/** token bucket: `burst` tokens, refilled at `perSec` */
export class Bucket {
  private tokens: number; private last = Date.now();
  constructor(private burst: number, private perSec: number) { this.tokens = burst; }
  take(cost = 1): boolean {
    const now = Date.now(); this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec); this.last = now;
    if (this.tokens >= cost) { this.tokens -= cost; return true; }
    return false;
  }
}

const BUCKETS: Record<string, [number, number]> = {
  cmd: [200, 100],        // 60-100 Hz input stream
  misc: [40, 12],         // settings, ready, list, leave ...
  invite: [5, 0.5],       // invites and suggestions
  request: [4, 0.3],      // join requests
  buy: [12, 3],
  ping: [6, 2],
};

export class Session {
  readonly id: number;
  readonly uid: string;
  readonly token: string;
  name: string;
  ws: WebSocket | null = null;
  connected = true;
  disconnectedAt = 0;
  status: Status = 'online';
  vis: Visibility = 'public';
  invitePolicy: InvitePolicy = 'anyone';
  presenceSub = false;
  favorites = new Set<string>();
  blocked = new Set<string>();
  partyId: number | null = null;
  lobbyId: number | null = null;
  matchId: number | null = null;
  queued = false;
  rtt = 60;
  strikes = 0;
  ip = '';
  graceTimer: ReturnType<typeof setTimeout> | null = null;
  private buckets = new Map<string, Bucket>();

  constructor(id: number, uid: string, token: string, name: string) { this.id = id; this.uid = uid; this.token = token; this.name = name; }

  allow(cat: string, cost = 1): boolean {
    let b = this.buckets.get(cat);
    if (!b) { const [burst, rate] = BUCKETS[cat] ?? BUCKETS.misc!; b = new Bucket(burst, rate); this.buckets.set(cat, b); }
    return b.take(cost);
  }

  send(msg: ServerMsg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }
}
