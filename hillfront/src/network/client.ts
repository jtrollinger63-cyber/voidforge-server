/**
 * Browser WebSocket client for the Hillfront server: handshake, token resume, RTT, typed message dispatch.
 * Identity is a guest token stored per server URL; favourites / blocked lists are stored locally and re-sent on every hello.
 */
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol.ts';

type Handler<T extends ServerMsg['t']> = (m: Extract<ServerMsg, { t: T }>) => void;

const LS = 'hillfront.net.v1';
interface Stored { tokens: Record<string, string>; favorites: string[]; blocked: string[]; url: string; vis: 'public' | 'invisible'; invites: 'anyone' | 'favorites' | 'nobody'; }
export function loadNetPrefs(): Stored {
  const d: Stored = { tokens: {}, favorites: [], blocked: [], url: '', vis: 'public', invites: 'anyone' };
  try { const r = localStorage.getItem(LS); if (r) Object.assign(d, JSON.parse(r)); } catch { /* storage blocked */ }
  return d;
}
export function saveNetPrefs(p: Partial<Stored>) { const cur = { ...loadNetPrefs(), ...p }; try { localStorage.setItem(LS, JSON.stringify(cur)); } catch { /* ignore */ } return cur; }

export function defaultServerUrl(): string {
  const w = window as unknown as { HILLFRONT_SERVER?: string };
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (w.HILLFRONT_SERVER) return w.HILLFRONT_SERVER;
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
  if (env) return env;
  const host = location.hostname || 'localhost';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}:8787/ws`;
}

export class NetClient {
  ws: WebSocket | null = null;
  url = '';
  me: { id: number; uid: string; token: string; name: string } | null = null;
  status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' = 'idle';
  rtt = 0;
  serverClockOffset = 0;
  lastError = '';
  private handlers = new Map<string, Set<(m: any) => void>>();
  private any = new Set<(m: ServerMsg) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingN = 0; private pingSent = new Map<number, number>();
  private wantOpen = false; private tries = 0;
  onStatus: ((s: NetClient['status'], detail?: string) => void) | null = null;
  private name = '';

  on<T extends ServerMsg['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t); if (!set) { set = new Set(); this.handlers.set(t, set); }
    set.add(fn as any); return () => set!.delete(fn as any);
  }
  onAny(fn: (m: ServerMsg) => void) { this.any.add(fn); return () => this.any.delete(fn); }

  connect(url: string, name: string): Promise<NonNullable<NetClient['me']>> {
    this.url = url; this.name = name; this.wantOpen = true; this.tries = 0;
    return this.open();
  }

  private open(): Promise<NonNullable<NetClient['me']>> {
    return new Promise((resolve, reject) => {
      this.status = this.me ? 'reconnecting' : 'connecting'; this.onStatus?.(this.status);
      let ws: WebSocket;
      try { ws = new WebSocket(this.url); } catch (e) { this.status = 'closed'; this.lastError = String(e); this.onStatus?.('closed', this.lastError); reject(new Error(this.lastError)); return; }
      this.ws = ws; let settled = false;
      const prefs = loadNetPrefs();
      const fail = (why: string) => { if (settled) return; settled = true; this.lastError = why; reject(new Error(why)); };
      ws.onopen = () => {
        const hello: ClientMsg = { t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: prefs.tokens[this.url], favorites: prefs.favorites, blocked: prefs.blocked };
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg; try { m = JSON.parse(ev.data as string) as ServerMsg; } catch { return; }
        if (m.t === 'welcome') {
          this.me = { id: m.id, uid: m.uid, token: m.token, name: m.name };
          const t = loadNetPrefs().tokens; t[this.url] = m.token; saveNetPrefs({ tokens: t });
          this.serverClockOffset = m.serverTime - Date.now(); this.tries = 0;
          this.status = 'open'; this.onStatus?.('open'); this.startPing();
          if (!settled) { settled = true; resolve(this.me); }
        } else if (m.t === 'pong') {
          const t0 = this.pingSent.get(m.n); if (t0) { this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - t0) * 0.3 : performance.now() - t0; this.pingSent.delete(m.n); }
        } else if (m.t === 'error' && (m.code === 'version' || m.code === 'full')) { this.wantOpen = false; fail(m.text); }
        for (const f of this.any) f(m);
        const set = this.handlers.get(m.t); if (set) for (const f of set) f(m);
      };
      ws.onerror = () => fail('Could not reach the server. Check the address and that the server is running.');
      ws.onclose = () => {
        this.stopPing();
        if (!settled) fail('Connection closed before the server answered.');
        if (this.ws !== ws) return;
        if (this.wantOpen && this.me && this.tries < 6) {
          this.tries++; this.status = 'reconnecting'; this.onStatus?.('reconnecting', `attempt ${this.tries}`);
          setTimeout(() => { if (this.wantOpen) this.open().catch(() => { /* retry via onclose */ }); }, Math.min(4000, 400 * this.tries));
        } else { this.status = 'closed'; this.onStatus?.('closed', this.lastError); }
      };
    });
  }

  send(m: ClientMsg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  get open_() { return this.status === 'open'; }

  close() { this.wantOpen = false; this.stopPing(); this.ws?.close(); this.ws = null; this.me = null; this.status = 'closed'; this.onStatus?.('closed'); }
  forgetIdentity() { const t = loadNetPrefs().tokens; delete t[this.url]; saveNetPrefs({ tokens: t }); }

  private startPing() {
    this.stopPing();
    const ping = () => { const n = ++this.pingN; this.pingSent.set(n, performance.now()); this.send({ t: 'ping', n }); if (this.pingSent.size > 8) this.pingSent.clear(); };
    ping(); this.pingTimer = setInterval(ping, 2000);
  }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}
