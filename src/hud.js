// In-race HUD: canvas gauge cluster + minimap, DOM readouts, event feed, countdown and drift panel.
import { fmtTime } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export const ordinal = (n) => n + ord(n);

export class HUD {
  constructor(root) {
    this.root = root; this.needle = 0; this.rpmS = 0; this.shown = false; this.cache = {}; this.feed = []; this.flashT = 0;
    root.innerHTML = `
      <div class="hud-vignette" id="hVig"></div><div class="hud-hit" id="hHit"></div>
      <div class="hud-tl"><div class="hud-pos" id="hPos"><span class="p">P</span><b id="hPosN">1</b><i id="hPosT">/ 6</i></div><div class="hud-lap" id="hLap">LAP <b id="hLapN">1</b>/<span id="hLapT">3</span></div></div>
      <div class="hud-tc" id="hTimes"><div class="t-main"><small>TIME</small><b id="hTime">0:00.000</b></div>
        <div class="t-row"><div><small>LAP</small><b id="hLapTime">0:00.000</b></div><div><small>LAST</small><b id="hLast">--:--.---</b></div><div><small>BEST</small><b id="hBest" class="best">--:--.---</b></div></div>
        <div class="t-cp" id="hCp"></div><div class="t-split" id="hSplit"></div></div>
      <div class="hud-tr"><canvas id="hMap" width="440" height="440"></canvas><div class="map-n">N</div></div>
      <div class="hud-feed" id="hFeed"></div>
      <div class="hud-drift" id="hDrift"><div class="d-label">DRIFT</div><div class="d-chain" id="dChain">0</div><div class="d-mult" id="dMult">x1.0</div><div class="d-bar"><i id="dBar"></i></div><div class="d-bank">BANKED <b id="dBank">0</b></div></div>
      <div class="hud-timer" id="hTimer"><small>TIME LEFT</small><b id="hTimerV">2:30</b></div>
      <div class="hud-br"><canvas id="hGauge" width="560" height="560"></canvas>
        <div class="nitro" id="hNitro"><span>NITRO</span><div class="bar"><i id="hNitroBar"></i></div></div></div>
      <div class="hud-center" id="hCenter"></div><div class="hud-warn" id="hWarn">WRONG WAY</div><div class="hud-lights" id="hLights"><i></i><i></i><i></i></div>
      <div class="hud-hint" id="hHint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> handbrake · <kbd>Shift</kbd> nitro · <kbd>C</kbd> camera · <kbd>R</kbd> reset · <kbd>Esc</kbd> pause</div>
      <div class="hud-fps" id="hFps"></div>`;
    this.$ = (id) => root.querySelector('#' + id);
    this.el = {}; for (const id of ['hPos', 'hPosN', 'hPosT', 'hLap', 'hLapN', 'hLapT', 'hTimes', 'hTime', 'hLapTime', 'hLast', 'hBest', 'hCp', 'hSplit', 'hMap', 'hFeed', 'hDrift', 'dChain', 'dMult', 'dBar', 'dBank', 'hTimer', 'hTimerV', 'hGauge', 'hNitro', 'hNitroBar', 'hCenter', 'hWarn', 'hLights', 'hHint', 'hFps', 'hVig', 'hHit']) this.el[id] = this.$(id);
    this.g = this.el.hGauge.getContext('2d'); this.m = this.el.hMap.getContext('2d');
    this.mapBase = null; this.lights = [...this.el.hLights.children];
  }

  show(v) { this.shown = v; this.root.style.display = v ? '' : 'none'; if (v) { this.el.hHint.style.opacity = 1; clearTimeout(this.hintT); this.hintT = setTimeout(() => { this.el.hHint.style.opacity = 0; }, 14000); } }
  setMode(mode) { this.mode = mode; this.root.dataset.mode = mode; }
  txt(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; this.el[id].textContent = v; } }

  initMinimap(td) {
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < td.N; i++) { minx = Math.min(minx, td.px[i]); maxx = Math.max(maxx, td.px[i]); minz = Math.min(minz, td.pz[i]); maxz = Math.max(maxz, td.pz[i]); }
    const pad = 80, s = Math.min(2400 / (maxx - minx + 1), 2400 / (maxz - minz + 1), 1.4), W = Math.ceil((maxx - minx) * s + pad * 2), H = Math.ceil((maxz - minz) * s + pad * 2);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const P = (x, z) => [(x - minx) * s + pad, (z - minz) * s + pad];
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= td.N; i += 2) { const [x, y] = P(td.px[i % td.N], td.pz[i % td.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    path(); g.lineWidth = Math.max(10, td.width * s * 1.9); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    path(); g.lineWidth = Math.max(5, td.width * s * 1.15); g.strokeStyle = 'rgba(190,205,230,0.95)'; g.stroke();
    const [sx, sy] = P(td.px[0], td.pz[0]); g.fillStyle = '#ffb703'; g.beginPath(); g.arc(sx, sy, 7, 0, 7); g.fill();
    this.mapBase = { c, P, s, minx, minz, pad };
  }

  // ------------------------------------------------------------------------------------------------ per-frame
  update(h, dt) {
    if (!this.shown) return;
    const E = this.el;
    this.txt('hPosN', String(h.pos)); this.txt('hPosT', '/ ' + h.total); E.hPos.style.display = h.mode === 'race' || h.mode === 'cup' ? '' : 'none';
    E.hLap.style.display = h.laps ? '' : 'none'; this.txt('hLapN', String(h.lap)); this.txt('hLapT', h.laps >= 90 ? '∞' : String(h.laps));
    this.txt('hTime', fmtTime(h.time)); this.txt('hLapTime', fmtTime(h.lapTime)); this.txt('hLast', fmtTime(h.last)); this.txt('hBest', fmtTime(h.best));
    E.hTimes.style.display = h.mode === 'drift' || h.mode === 'free' ? 'none' : '';
    // checkpoint pips + split delta
    if (this.cache.cp !== h.cp + ':' + h.cpCount) { this.cache.cp = h.cp + ':' + h.cpCount; E.hCp.innerHTML = Array.from({ length: h.cpCount }, (_, i) => `<i class="${i < h.cp - 1 ? 'on' : i === h.cp - 1 ? 'next' : ''}"></i>`).join(''); }
    if (h.split && h.split.delta != null) { const d = h.split.delta; E.hSplit.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3); E.hSplit.className = 't-split show ' + (d <= 0 ? 'ahead' : 'behind'); }
    else if (h.split) { E.hSplit.textContent = 'CP ' + h.split.i + '  ' + fmtTime(h.split.t); E.hSplit.className = 't-split show'; } else E.hSplit.className = 't-split';
    // drift panel / timer
    E.hDrift.style.display = h.mode === 'drift' ? 'block' : 'none'; E.hTimer.style.display = h.mode === 'drift' ? 'block' : 'none';
    if (h.mode === 'drift') {
      const d = h.drift; this.txt('dChain', Math.round(d.chain).toLocaleString()); this.txt('dMult', 'x' + d.mult.toFixed(1)); this.txt('dBank', Math.round(d.bank).toLocaleString());
      E.dBar.style.width = (d.active ? clamp(1 - d.idle, 0, 1) * 100 : 0) + '%'; E.hDrift.classList.toggle('active', !!d.active); E.hDrift.classList.toggle('flash', d.bankFlash > 0.4);
      const t = Math.max(0, h.timeLeft); this.txt('hTimerV', `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`); E.hTimer.classList.toggle('low', t < 15);
    }
    // nitro
    E.hNitroBar.style.width = Math.round(h.nitro * 100) + '%'; E.hNitro.classList.toggle('full', h.boostFull); E.hNitro.classList.toggle('on', h.boosting);
    E.hWarn.classList.toggle('show', !!h.wrongWay);
    E.hVig.style.opacity = clamp((h.speedN - 0.55) * 1.6, 0, 0.9) + (h.boosting ? 0.2 : 0);
    // event feed
    this.drawFeed(h.msgs); this.drawGauge(h, dt); this.drawMap(h);
    this.txt('hFps', h.showFps ? Math.round(h.fps) + ' fps' : '');
  }

  drawFeed(msgs) {
    const key = msgs.map((m) => m.t).join(','); if (key === this.cache.feed) return; this.cache.feed = key;
    this.el.hFeed.innerHTML = msgs.slice(-4).map((m, i, a) => `<div class="m ${m.kind}" style="opacity:${0.45 + 0.55 * ((i + 1) / a.length)}">${m.text}</div>`).join('');
    clearTimeout(this.feedT); this.feedT = setTimeout(() => { this.el.hFeed.innerHTML = ''; this.cache.feed = ''; }, 4200);
  }

  drawGauge(h, dt) {
    const g = this.g, S = 560, c = S / 2, r = 232;
    g.clearRect(0, 0, S, S);
    this.needle += (h.speed / h.maxSpeed - this.needle) * Math.min(1, dt * 14); this.rpmS += (h.rpm - this.rpmS) * Math.min(1, dt * 20);
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    // backing disc
    const bg = g.createRadialGradient(c, c, 20, c, c, r + 20); bg.addColorStop(0, 'rgba(14,18,30,0.86)'); bg.addColorStop(0.8, 'rgba(8,10,18,0.9)'); bg.addColorStop(1, 'rgba(4,6,10,0.6)');
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, r + 18, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, r + 16, 0, 7); g.stroke();
    // tachometer: segmented arc on the outside
    const seg = 34, rr = r + 4;
    for (let i = 0; i < seg; i++) {
      const f = i / seg, on = f < this.rpmS, a1 = a0 + sweep * f, a2 = a0 + sweep * (f + 0.8 / seg), red = f > 0.86;
      g.strokeStyle = on ? (red ? '#ff3b3b' : f > 0.7 ? '#ffb703' : '#25e6ff') : 'rgba(255,255,255,0.1)'; g.lineWidth = 11; g.lineCap = 'butt'; g.beginPath(); g.arc(c, c, rr, a1, a2); g.stroke();
    }
    const shiftLight = h.rpm > 0.93; if (shiftLight) { g.fillStyle = Math.floor(performance.now() / 70) % 2 ? '#ff3b3b' : '#ffb703'; g.beginPath(); g.arc(c, c - r - 34, 9, 0, 7); g.fill(); }
    // speed ticks
    const maxS = h.maxSpeed, step = maxS > 360 ? 40 : 20;
    g.fillStyle = '#e9f0ff'; g.font = '600 22px "Trebuchet MS","Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= maxS; v += step / 2) {
      const f = v / maxS, a = a0 + sweep * f, major = v % step === 0, r1 = r - 20, r2 = r - (major ? 44 : 32);
      g.strokeStyle = major ? '#fff' : 'rgba(255,255,255,0.45)'; g.lineWidth = major ? 3.5 : 2; g.beginPath(); g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.stroke();
      if (major) g.fillText(String(v), c + Math.cos(a) * (r - 72), c + Math.sin(a) * (r - 72));
    }
    // needle
    const na = a0 + sweep * clamp(this.needle, 0, 1.04);
    g.save(); g.translate(c, c); g.rotate(na); g.shadowColor = 'rgba(255,60,60,0.9)'; g.shadowBlur = 18;
    const gr = g.createLinearGradient(0, 0, r - 30, 0); gr.addColorStop(0, '#ff6a3d'); gr.addColorStop(1, '#ff2020'); g.fillStyle = gr;
    g.beginPath(); g.moveTo(-26, -4); g.lineTo(r - 28, -2); g.lineTo(r - 18, 0); g.lineTo(r - 28, 2); g.lineTo(-26, 4); g.closePath(); g.fill(); g.restore();
    g.fillStyle = '#0c0f18'; g.strokeStyle = '#ff4a3a'; g.lineWidth = 4; g.beginPath(); g.arc(c, c, 24, 0, 7); g.fill(); g.stroke();
    // digital readout
    g.fillStyle = '#fff'; g.font = 'italic 900 78px "Trebuchet MS","Segoe UI",sans-serif'; g.fillText(String(h.speed), c, c + 78);
    g.fillStyle = '#8da2c8'; g.font = '700 22px "Trebuchet MS",sans-serif'; g.fillText(h.unit, c, c + 122);
    // gear box
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.strokeStyle = h.shifting ? '#ffb703' : 'rgba(255,255,255,0.25)'; g.lineWidth = 3; g.beginPath(); g.roundRect(c - 34, c - 118, 68, 72, 12); g.fill(); g.stroke();
    g.fillStyle = h.gear === 'R' ? '#ff6a6a' : '#25e6ff'; g.font = 'italic 900 56px "Trebuchet MS",sans-serif'; g.fillText(h.gear, c, c - 80);
    if (h.turbo > 0.05) { g.strokeStyle = `rgba(120,200,255,${0.3 + h.turbo * 0.7})`; g.lineWidth = 5; g.beginPath(); g.arc(c, c, r - 100, a0 + 0.2, a0 + 0.2 + h.turbo * 1.1); g.stroke(); }
  }

  drawMap(h) {
    const B = this.mapBase; if (!B) return; const g = this.m, S = 440, R = S / 2, td = h.td;
    const p = h.cars.find((c) => c.id === h.playerId); if (!p) return; const v = p.veh;
    g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(R, R, R - 4, 0, 7); g.clip();
    g.fillStyle = 'rgba(8,12,22,0.62)'; g.fillRect(0, 0, S, S);
    const zoom = 1.05 / B.s; // 1 world metre ~ 1.05 minimap pixels (about 200 m visible)
    const [mx, mz] = B.P(v.x, v.z);
    g.translate(R, R + 40); g.rotate(v.heading - Math.PI); g.scale(zoom, zoom); g.translate(-mx, -mz);
    g.drawImage(B.c, 0, 0);
    for (const e of h.cars) { if (e.id === h.playerId) continue; const [x, y] = B.P(e.veh.x, e.veh.z); g.fillStyle = e.color; g.strokeStyle = '#000'; g.lineWidth = 3 / zoom; g.beginPath(); g.arc(x, y, 7 / zoom, 0, 7); g.fill(); g.stroke(); }
    g.restore();
    g.fillStyle = '#ffb703'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(R, R + 40 - 16); g.lineTo(R + 11, R + 40 + 12); g.lineTo(R, R + 40 + 6); g.lineTo(R - 11, R + 40 + 12); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 4, 0, 7); g.stroke();
  }

  // ------------------------------------------------------------------------------------------------ overlays
  countdown(n) {
    const lit = n === 0 ? 3 : 3 - n + 1;
    this.lights.forEach((l, i) => { l.className = n === 0 ? 'go' : i < lit ? 'on' : ''; });
    this.el.hLights.classList.add('show'); if (n === 0) setTimeout(() => this.el.hLights.classList.remove('show'), 900);
    this.center(n === 0 ? 'GO!' : String(n), n === 0 ? 'go' : '');
  }
  center(text, cls = '') { const c = this.el.hCenter; c.textContent = text; c.className = 'hud-center'; void c.offsetWidth; c.className = 'hud-center pop ' + cls; }
  hit(a) { const e = this.el.hHit; e.style.opacity = clamp(a, 0, 0.8); clearTimeout(this.hitT); this.hitT = setTimeout(() => { e.style.opacity = 0; }, 120); }
}
