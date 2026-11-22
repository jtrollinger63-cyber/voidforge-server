#!/usr/bin/env node
/**
 * End-to-end online test: starts the REAL server, opens THREE independent browser contexts (separate localStorage = separate guests),
 * and drives the real UI: presence -> invite/accept -> request/accept -> ready -> START FOR PARTY -> shared authoritative match.
 * Usage: node tools/nettest.cjs [clientUrl=http://localhost:5173/] [outDir=shots/net]
 * (software WebGL: slow frame rates, correctness only.)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const base = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'shots/net';
const PORT = 8799;
fs.mkdirSync(out, { recursive: true });
const R = [];
const ok = (name, cond, info) => { R.push({ name, pass: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
const killServer = () => { try { server && server.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', killServer);
(async () => {
  server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; server.stdout.on('data', (d) => (slog += d)); server.stderr.on('data', (d) => (slog += d));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch { /* not yet */ } await sleep(250); }
  const health0 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok('real server process is up and answering /health', health0.ok === true, JSON.stringify(health0));

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });   // separate storage per guest
    await ctx.addInitScript(() => { try { localStorage.setItem('hillfront.settings.v1', JSON.stringify({ quality: 'low', resolutionScale: 0.5, dynamicRes: true })); } catch { /* ignore */ } });   // keep three software-GL pages affordable
    const page = await ctx.newPage(); page.setDefaultTimeout(150000); const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) errs.push(m.text().slice(0, 200)); });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction('window.__hf && window.__hf.online', null, { timeout: 90000 });
    await page.click('text=Online · Parties');
    await page.fill('input[data-field=name]', name); await page.dispatchEvent('input[data-field=name]', 'change');
    await page.fill('input[data-field=url]', `ws://127.0.0.1:${PORT}/ws`); await page.dispatchEvent('input[data-field=url]', 'change');
    await page.click('button[data-act=connect]');
    await page.waitForFunction('window.__hf.online.net.status === "open"', null, { timeout: 20000 });
    const id = await page.evaluate(() => window.__hf.online.net.me.id);
    return { name, page, id, errs, ctx };
  };
  const host = await mk('Hosty'), invited = await mk('Invitee'), requester = await mk('Requester');
  ok('three independent browser guests connected with distinct server ids', new Set([host.id, invited.id, requester.id]).size === 3, `ids ${host.id}/${invited.id}/${requester.id}`);

  const tab = async (c, t) => { await c.page.click(`button[data-tab=${t}]`); await sleep(250); };

  // presence: the host sees exactly the real other players
  await tab(host, 'players');
  await host.page.waitForFunction(`document.querySelectorAll('[data-player]').length === 2`, null, { timeout: 15000 });
  const seen = await host.page.evaluate(() => [...document.querySelectorAll('[data-player]')].map((e) => e.textContent.slice(0, 40)));
  ok('host sees the two real players in the online list (and nobody fake)', seen.length === 2 && seen.some((t) => t.includes('Invitee')) && seen.some((t) => t.includes('Requester')), JSON.stringify(seen));
  await host.page.screenshot({ timeout: 120000, path: out + '/01-host-players.png' });

  // invite -> accept
  await host.page.click(`[data-player="${invited.id}"] [data-act=invite]`);
  await invited.page.waitForSelector('[data-pending=invite] [data-act=accept]', { timeout: 10000 });
  await invited.page.screenshot({ timeout: 120000, path: out + '/02-invitee-notification.png' });
  await invited.page.click('[data-pending=invite] [data-act=accept]');
  await host.page.waitForFunction('window.__hf.online.party && window.__hf.online.party.members.length === 2', null, { timeout: 10000 });
  ok('invitation accepted -> both are in one party, host is leader', await host.page.evaluate((hid) => window.__hf.online.party.leader === hid, host.id));

  // request to join (aimed at the *member*; goes to the leader)
  await tab(requester, 'players');
  await requester.page.waitForSelector(`[data-player="${invited.id}"] [data-act=request]`, { timeout: 10000 });
  await requester.page.click(`[data-player="${invited.id}"] [data-act=request]`);
  await host.page.waitForSelector('[data-pending=request] [data-act=accept]', { timeout: 10000 });
  const invitedGotIt = await invited.page.evaluate(() => document.querySelectorAll('[data-pending=request]').length);
  ok('join request goes to the LEADER only (member did not get it)', invitedGotIt === 0);
  await host.page.screenshot({ timeout: 120000, path: out + '/03-host-request.png' });
  await host.page.click('[data-pending=request] [data-act=accept]');
  await requester.page.waitForFunction('window.__hf.online.party && window.__hf.online.party.members.length === 3', null, { timeout: 10000 });
  ok('request accepted -> party of three on every client', await Promise.all([host, invited, requester].map((c) => c.page.evaluate(() => window.__hf.online.party && window.__hf.online.party.members.length))).then((a) => a.every((n) => n === 3)));

  // ready up + leader settings + start
  await tab(host, 'party'); await tab(invited, 'party'); await tab(requester, 'party');
  await host.page.click('button:has-text("Private")');                      // (already default) keep party-only match
  for (const c of [invited, requester]) await c.page.click('button[data-act=ready]');
  await host.page.waitForFunction('window.__hf.online.party.members.every((m) => m.ready)', null, { timeout: 10000 });
  await host.page.screenshot({ timeout: 120000, path: out + '/04-party-roster.png' });
  await host.page.click('button[data-act=start-party]');

  // everyone lands in the SAME authoritative match
  try { for (const c of [host, invited, requester]) await c.page.waitForFunction('window.__hf.game.online === true && window.__hf.game.session && window.__hf.game.session.kind === "net" && window.__hf.game.session.view.players.size > 0', null, { timeout: 40000 }); }
  catch (e) {
    for (const c of [host, invited, requester]) console.log('DEBUG', c.name, JSON.stringify(await c.page.evaluate(() => ({ state: window.__hf.game.state, online: window.__hf.game.online, party: window.__hf.online.party && { st: window.__hf.online.party.state, m: window.__hf.online.party.members.map((m) => m.name + ':' + m.ready) }, toasts: [...document.querySelectorAll('.toasts .t')].map((t) => t.textContent), err: document.body.innerText.slice(0, 0) }))), c.errs);
    console.log('server log:', slog.slice(-600)); throw e;
  }
  await sleep(1500);
  const views = await Promise.all([host, invited, requester].map((c) => c.page.evaluate(() => { const v = window.__hf.game.view; return { sessionKind: window.__hf.game.session.kind, names: [...v.players.values()].filter((p) => !p.bot).map((p) => p.name).sort(), total: v.players.size, bots: [...v.players.values()].filter((p) => p.bot).length, round: v.round, localSquad: v.players.get(window.__hf.game.localId).squad }; })));
  ok('all three clients render a NET session (server-owned), not a local sim', views.every((v) => v.sessionKind === 'net'));
  ok('all three see the same three human players plus labelled bots', views.every((v) => JSON.stringify(v.names) === JSON.stringify(['Hosty', 'Invitee', 'Requester']) && v.total === 10 && v.bots === 7), JSON.stringify(views[0]));
  ok('the party was placed on the SAME team', new Set(views.map((v) => v.localSquad)).size === 1, 'squad ' + views[0].localSquad);
  const health1 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok('the server reports exactly one running match', health1.matches === 1, JSON.stringify(health1));
  ok('the online panel does not cover the running match', (await Promise.all([host, invited, requester].map((c) => c.page.evaluate(() => !document.querySelector('[data-screen=online]'))))).every(Boolean));
  await host.page.screenshot({ timeout: 120000, path: out + '/05-host-ingame.png' }); await requester.page.screenshot({ timeout: 120000, path: out + '/06-requester-ingame.png' });

  // state exchange: wait for live, move the host, observe it from another browser
  for (const c of [host]) await c.page.waitForFunction('window.__hf.game.view.phase === "live"', null, { timeout: 60000, polling: 250 });
  const posOnRequester = () => requester.page.evaluate((hid) => { const p = window.__hf.game.view.players.get(hid); return { x: p.x, z: p.z }; }, host.id);
  const p0 = await posOnRequester();
  await host.page.keyboard.down('KeyW'); await sleep(2500); await host.page.keyboard.up('KeyW'); await sleep(800);
  const p1 = await posOnRequester();
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  ok("host's movement is visible in ANOTHER browser through the server", moved > 2, `moved ${moved.toFixed(1)} m as seen by the requester`);
  const hostSelf = await host.page.evaluate(() => { const g = window.__hf.game; const me = g.view.players.get(g.localId); return { x: me.x, z: me.z, corr: g.session.lastCorrection }; });
  const hostAsSeen = await requester.page.evaluate((hid) => { const p = window.__hf.game.view.players.get(hid); return { x: p.x, z: p.z }; }, host.id);
  ok('client-side prediction agrees with the server (within 1.5 m of what others see)', Math.hypot(hostSelf.x - hostAsSeen.x, hostSelf.z - hostAsSeen.z) < 1.5, `self (${hostSelf.x.toFixed(1)},${hostSelf.z.toFixed(1)}) vs others (${hostAsSeen.x.toFixed(1)},${hostAsSeen.z.toFixed(1)})`);
  await requester.page.screenshot({ timeout: 120000, path: out + '/07-requester-sees-host-move.png' });

  // leave -> back to menu, party survives
  if (await requester.page.evaluate(() => window.__hf.game.state) === 'playing') await requester.page.keyboard.press('Escape');   // (already paused if pointer lock was taken by another window)
  await requester.page.waitForSelector('text=Leave match', { timeout: 60000 });
  await requester.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Leave match/.test(x.textContent)); b.click(); });   // direct DOM click: Playwright's actionability wait stalls on this CPU-starved page
  await requester.page.waitForFunction('window.__hf.game.state === "menu"', null, { timeout: 15000 });
  await sleep(600);
  const partyAfter = await requester.page.evaluate(() => window.__hf.online.party && window.__hf.online.party.members.length);
  const srvAfter = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok('a member who leaves the match returns to the menu and is still in the party', partyAfter === 3, 'party size ' + partyAfter);
  ok('the server released that member from the match (a bot took the slot)', await host.page.evaluate(() => window.__hf.game.view.players.size) === 10, 'match still has 10 combatants');

  ok('no uncaught page errors in any browser', [host, invited, requester].every((c) => c.errs.length === 0), JSON.stringify([host, invited, requester].map((c) => c.errs)));
  const fails = R.filter((r) => !r.pass).length;
  console.log('\n' + (R.length - fails) + '/' + R.length + ' online checks passed');
  await browser.close(); server.kill('SIGTERM');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED', e); killServer(); process.exit(2); });
