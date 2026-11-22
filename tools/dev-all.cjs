#!/usr/bin/env node
/** One command for local play: starts the game server (ws://localhost:8787/ws) and the Vite dev client (http://localhost:5173). */
const { spawn } = require('child_process');
const run = (name, args) => { const p = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' }); p.on('exit', (c) => { console.log(`[${name}] exited (${c})`); process.exit(c ?? 0); }); return p; };
const kids = [run('server', ['tsx', 'server/index.ts']), run('client', ['vite', '--host', '0.0.0.0', '--port', '5173'])];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { kids.forEach((k) => k.kill()); process.exit(0); });
console.log('\n  Game client : http://localhost:5173\n  Game server : ws://localhost:8787/ws   (health: http://localhost:8787/health)\n  Open the client in TWO browser windows to try parties.\n');
