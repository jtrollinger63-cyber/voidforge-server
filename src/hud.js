// DOM HUD: text readouts, minimap, menu widgets, results table.
import { fmtTime } from './util.js';

const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export const ordinal = (n) => n + ord(n);

function bounds(td) {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < td.N; i++) { minx = Math.min(minx, td.px[i]); maxx = Math.max(maxx, td.px[i]); minz = Math.min(minz, td.pz[i]); maxz = Math.max(maxz, td.pz[i]); }
  return { minx, maxx, minz, maxz };
}

function projector(td, W, H, pad) {
  const b = bounds(td);
  const s = Math.min((W - pad * 2) / (b.maxx - b.minx), (H - pad * 2) / (b.maxz - b.minz));
  const ox = (W - (b.maxx - b.minx) * s) / 2, oy = (H - (b.maxz - b.minz) * s) / 2;
  return (x, z) => [(x - b.minx) * s + ox, (b.maxz - z) * s + oy];
}

function strokeTrack(g, td, proj, widthPx, color) {
  g.beginPath();
  for (let i = 0; i < td.N; i += 2) { const [x, y] = proj(td.px[i], td.pz[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.lineJoin = 'round'; g.lineWidth = widthPx; g.strokeStyle = color; g.stroke();
}

export function drawTrackPreview(canvas, td) {
  const W = (canvas.width = 240), H = (canvas.height = 160);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const proj = projector(td, W, H, 16);
  strokeTrack(g, td, proj, 11, 'rgba(255,255,255,0.16)');
  strokeTrack(g, td, proj, 6, '#9fb4d8');
  const [sx, sy] = proj(td.px[0], td.pz[0]);
  g.fillStyle = '#ffb703'; g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fill();
}

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'), posN: $('posN'), posSuf: $('posSuf'), posTot: $('posTot'), lapN: $('lapN'), lapT: $('lapT'),
      tNow: $('tNow'), tLast: $('tLast'), tBest: $('tBest'), kmh: $('kmh'), gear: $('gear'),
      rpm: $('rpmbar').firstElementChild, boost: $('boostbar').firstElementChild, boostBar: $('boostbar'),
      center: $('center'), toast: $('toast'), hint: $('hint'), fxSpeed: $('fxspeed'), fxDmg: $('fxdmg'), mini: $('mini'),
    };
    this.cache = {};
    this.mg = this.el.mini.getContext('2d');
    this.toastTimer = 0;
  }

  txt(key, v) { if (this.cache[key] !== v) { this.cache[key] = v; this.el[key].textContent = v; } }
  sty(key, prop, v) { const k = key + prop; if (this.cache[k] !== v) { this.cache[k] = v; this.el[key].style[prop] = v; } }

  show(v) { this.el.root.hidden = !v; }

  setRace(pos, total, lap, laps) {
    this.txt('posN', String(pos)); this.txt('posSuf', ord(pos)); this.txt('posTot', `/ ${total}`);
    this.txt('lapN', String(lap)); this.txt('lapT', String(laps));
  }

  setTimes(now, last, best) {
    this.txt('tNow', fmtTime(now)); this.txt('tLast', fmtTime(last)); this.txt('tBest', fmtTime(best));
  }

  setSpeed(kmh, gear, rpm, boost, boosting, speed01) {
    this.txt('kmh', String(kmh)); this.txt('gear', gear);
    this.sty('rpm', 'width', `${Math.round(rpm * 100)}%`);
    this.sty('boost', 'width', `${Math.round(boost * 100)}%`);
    const full = boost > 0.98;
    if (this.cache.full !== full) { this.cache.full = full; this.el.boostBar.classList.toggle('full', full); }
    this.sty('fxSpeed', 'opacity', boosting ? '1' : String(Math.max(0, (speed01 - 0.85) * 2).toFixed(2)));
  }

  damage(amount) {
    this.el.fxDmg.style.opacity = String(Math.min(0.9, amount));
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { this.el.fxDmg.style.opacity = '0'; }, 120);
  }

  center(text, cls = '') {
    const c = this.el.center;
    c.textContent = text; c.className = ''; void c.offsetWidth; c.className = 'pop ' + cls;
  }

  centerHold(text, cls = '') {
    const c = this.el.center;
    if (!text) { c.style.opacity = '0'; c.className = ''; return; }
    if (c.textContent !== text || !c.className.includes('warn')) { c.textContent = text; c.className = cls; }
    c.style.opacity = '1';
  }

  clearCenterHold() { this.el.center.style.opacity = ''; }

  toast(msg, ms = 2200) {
    const t = this.el.toast; t.textContent = msg; t.classList.add('on');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  fadeHint(v) { this.el.hint.style.opacity = v ? '1' : '0'; }

  // ---- minimap ----
  initMinimap(td) {
    const c = this.el.mini, W = c.width, H = c.height;
    this.mproj = projector(td, W, H, 24);
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const g = off.getContext('2d');
    strokeTrack(g, td, this.mproj, 22, 'rgba(255,255,255,0.14)');
    strokeTrack(g, td, this.mproj, 12, 'rgba(160,180,215,0.95)');
    const [sx, sy] = this.mproj(td.px[0], td.pz[0]);
    const a = td.heading[0];
    g.save(); g.translate(sx, sy); g.rotate(Math.atan2(-Math.cos(a), Math.sin(a)) + Math.PI / 2);
    g.fillStyle = '#fff'; g.fillRect(-3, -15, 6, 30); g.restore();
    this.mbase = off;
  }

  drawMinimap(cars, playerId) {
    const g = this.mg, W = this.el.mini.width, H = this.el.mini.height;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.mbase, 0, 0);
    for (const c of cars) {
      if (c.id === playerId) continue;
      const [x, y] = this.mproj(c.x, c.z);
      g.fillStyle = c.colorCss; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.stroke();
    }
    const p = cars.find((c) => c.id === playerId);
    if (p) {
      const [x, y] = this.mproj(p.x, p.z);
      g.fillStyle = '#ffb703'; g.strokeStyle = '#fff'; g.lineWidth = 4;
      g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill(); g.stroke();
    }
  }
}

export function buildResults(rows, laps) {
  const body = document.getElementById('resBody');
  body.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr'); if (r.me) tr.className = 'me';
    tr.innerHTML = `<td>${i + 1}</td><td><span class="dot" style="background:${r.color}"></span>${r.name}</td>` +
      `<td>${r.best ? fmtTime(r.best) : '—'}</td><td style="text-align:right">${r.time != null ? fmtTime(r.time) : r.gap}</td>`;
    body.appendChild(tr);
  });
}
