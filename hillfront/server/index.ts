/**
 * Hillfront game server: HTTP health endpoint + WebSocket game/party service on one port.
 *   npm run server                      (default port 8787)
 *   PORT=9000 ALLOWED_ORIGINS=https://example.com npm run server
 * TLS: terminate TLS in front of this process (Render, Fly.io, Railway, nginx, Caddy...) so browsers connect with wss://.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Hub } from './hub.ts';
import { LIMITS } from '../src/network/protocol.ts';

export interface ServerHandle { port: number; hub: Hub; close(): Promise<void>; }

export async function startServer(opts: { port?: number; allowedOrigins?: string[]; maxSessions?: number } = {}): Promise<ServerHandle> {
  const allowed = opts.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const hub = new Hub({ maxSessions: opts.maxSessions ?? Number(process.env.MAX_SESSIONS ?? 500), allowedOrigins: allowed });
  const started = Date.now();
  const http = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.url === '/health' || req.url === '/') { res.writeHead(200, cors); res.end(JSON.stringify({ ok: true, game: 'hillfront', uptimeS: Math.round((Date.now() - started) / 1000), ...hub.stats() })); return; }
    res.writeHead(404, cors); res.end('{"error":"not found"}');
  });
  const wss = new WebSocketServer({
    server: http, path: '/ws', maxPayload: LIMITS.maxFrameBytes * 2, perMessageDeflate: false,
    verifyClient: (info, cb) => {
      const origin = info.origin;
      if (allowed.length && (!origin || !allowed.includes(origin))) { cb(false, 403, 'origin not allowed'); return; }
      cb(true);
    },
  });
  wss.on('connection', (ws, req) => hub.onConnection(ws, (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? ''));
  await new Promise<void>((resolve) => http.listen(opts.port ?? Number(process.env.PORT ?? 8787), resolve));
  const port = (http.address() as { port: number }).port;
  return {
    port, hub,
    close: () => new Promise<void>((resolve) => { hub.dispose(); for (const c of wss.clients) c.terminate(); wss.close(() => http.close(() => resolve())); }),
  };
}

// run directly: `tsx server/index.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const h = await startServer();
  // eslint-disable-next-line no-console
  console.log(`[hillfront-server] listening on :${h.port}  ws path /ws  health /health${process.env.ALLOWED_ORIGINS ? '  origins: ' + process.env.ALLOWED_ORIGINS : '  (all origins allowed: set ALLOWED_ORIGINS in production)'}`);
  const stop = async () => { await h.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
