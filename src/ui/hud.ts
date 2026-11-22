import * as THREE from 'three';
import type { ViewState, ViewPlayer } from '../gameplay/view.ts';
import { WEAPONS, type WeaponId } from '../gameplay/weapons.ts';
import { TEAM_NAMES, RULES } from '../gameplay/sim.ts';
import type { MapDef } from '../map/hillfront.ts';
import { keyLabel, loadSettings } from '../engine/settings.ts';

const VAN = '#e0702b', GAR = '#3f8fd8';
const teamColor = (t: number) => (t === 0 ? VAN : GAR);

export interface HudContext {
  camera: THREE.PerspectiveCamera;
  spectating: ViewPlayer | null;
  prompt: string;
  progress: number | null;
  spread: number;
  visibleEnemies: Set<number>;
  fps: number; frameMs: number; drawCalls: number; tris: number; scale: number;
  netInfo?: string;
}

export class Hud {
  readonly root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private feed!: HTMLElement;
  private tags: HTMLElement[] = [];
  private mini!: HTMLCanvasElement; private miniCtx!: CanvasRenderingContext2D; private miniBase: HTMLCanvasElement | null = null;
  private cache = new Map<string, string>();
  private hitTimer = 0; private bannerTimer = 0; private toastTimer = 0;
  private dmgEls: HTMLElement[] = [];
  private dmgIdx = 0;
  private map: MapDef;
  private miniAcc = 0;
  private v3 = new THREE.Vector3();

  constructor(parent: HTMLElement, map: MapDef) {
    this.map = map;
    this.root = document.createElement('div'); this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="minimap"><canvas width="328" height="288"></canvas></div>
      <div class="bar">
        <div class="team" data-t="0" style="--c:${VAN}"><span class="nm">Vanguard</span><span class="sc" data-k="s0">0</span><span class="pips" data-k="p0"></span></div>
        <div class="clock" data-k="clock"><span class="t" data-k="time">1:45</span><span class="r" data-k="round">Round 1</span></div>
        <div class="team" data-t="1" style="--c:${GAR}"><span class="nm">Garrison</span><span class="sc" data-k="s1">0</span><span class="pips" data-k="p1"></span></div>
      </div>
      <div class="feed" data-k="feed"></div>
      <div class="cross" data-k="cross"><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><i class="dot"></i></div>
      <div class="hitm" data-k="hit"></div>
      <div class="dmg" data-k="dmg">${'<i></i>'.repeat(4)}</div>
      <div class="vig" data-k="vig"></div>
      <div class="vitals">
        <div class="vrow"><div class="hp" data-k="hp"><small>HEALTH</small>100</div><div class="ar" data-k="ar"><small>ARMOR</small>0</div></div>
        <div class="money" data-k="money">$800</div>
      </div>
      <div class="ammo"><div><span class="m" data-k="mag">30</span> <span class="rsv" data-k="rsv">/ 90</span></div><div class="nm" data-k="wname">A5 Carbine</div><div class="slots" data-k="slots"></div></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="banner" data-k="banner"><div class="big"></div><div class="sub"></div></div>
      <div class="toast" data-k="toast"></div>
      <div class="spec hidden" data-k="spec"></div>
      <div class="fps hidden" data-k="fps"></div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { this.el[e.dataset.k!] = e; });
    this.feed = this.el.feed!;
    this.mini = this.root.querySelector('canvas')!; this.miniCtx = this.mini.getContext('2d')!;
    this.dmgEls = [...this.el.dmg!.querySelectorAll('i')] as HTMLElement[];
    this.buildMiniBase();
  }

  private set(key: string, html: string) {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html); this.el[key]!.innerHTML = html;
  }
  private setText(key: string, text: string) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text); this.el[key]!.textContent = text;
  }

  // ----------------------------------------------------------------- minimap
  private buildMiniBase() {
    const W = this.mini.width, H = this.mini.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
    const b = this.map.world.bounds; const sx = W / (b.maxX - b.minX), sz = H / (b.maxZ - b.minZ);
    g.fillStyle = '#10161a'; g.fillRect(0, 0, W, H);
    // open ground (use the nav-ish grid of map cells)
    const { i0, j0 } = this.map.gridOrigin;
    const cell = this.map.cell;
    this.map.grid.forEach((row, rj) => [...row].forEach((ch, ri) => {
      const cx = (i0 + ri) * cell - cell / 2, cz = (j0 + rj) * cell - cell / 2;
      const x = (cx - b.minX) * sx, y = (cz - b.minZ) * sz;
      const open = ch === '.' || ch === 'a' || ch === 'A' || ch === 'H';
      g.fillStyle = ch === 'H' ? '#4a4e44' : open ? '#6b6559' : ch === 'T' ? '#2d3a40' : ch === 'G' ? '#2a3338' : '#222b30';
      g.fillRect(x, y, cell * sx + 0.6, cell * sz + 0.6);
    }));
    g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of this.map.sites) {
      const x = (s.x - b.minX) * sx, y = (s.z - b.minZ) * sz;
      g.fillStyle = 'rgba(255,207,92,.22)'; g.beginPath(); g.arc(x, y, s.radius * sx, 0, 6.3); g.fill();
      g.fillStyle = '#ffcf5c'; g.fillText(s.id, x, y);
    }
    this.miniBase = c;
  }

  private drawMini(view: ViewState, focus: ViewPlayer | null, visible: Set<number>) {
    const g = this.miniCtx, W = this.mini.width, H = this.mini.height;
    const b = this.map.world.bounds; const sx = W / (b.maxX - b.minX), sz = H / (b.maxZ - b.minZ);
    if (this.miniBase) g.drawImage(this.miniBase, 0, 0);
    const myTeam = focus?.team ?? 0;
    for (const p of view.players.values()) {
      if (!p.alive) continue;
      const mine = p.team === myTeam;
      if (!mine && !visible.has(p.id)) continue;
      const x = (p.x - b.minX) * sx, y = (p.z - b.minZ) * sz;
      g.fillStyle = teamColor(p.team); g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, p.id === focus?.id ? 7 : 5.5, 0, 6.3); g.fill(); g.stroke();
      const dx = -Math.sin(p.yaw) * 12, dz = -Math.cos(p.yaw) * 12;
      g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dz); g.stroke();
    }
    const bm = view.bomb;
    if (bm.state === 'planted' || bm.state === 'dropped') {
      const x = (bm.x - b.minX) * sx, y = (bm.z - b.minZ) * sz;
      g.fillStyle = bm.state === 'planted' ? '#ff4b3d' : '#ffcf5c'; g.fillRect(x - 6, y - 6, 12, 12); g.strokeStyle = '#000'; g.strokeRect(x - 6, y - 6, 12, 12);
    }
  }

  // ----------------------------------------------------------------- events
  killFeed(a: ViewPlayer | undefined, v: ViewPlayer | undefined, w: WeaponId, head: boolean, localId: number) {
    const row = document.createElement('div'); row.className = 'kf' + (a?.id === localId || v?.id === localId ? ' me' : '');
    const nm = (p: ViewPlayer | undefined) => `<span style="color:${p ? teamColor(p.team) : '#fff'}">${esc(p?.name ?? 'World')}</span>`;
    row.innerHTML = `${a ? nm(a) : ''}<span class="w">${WEAPONS[w]?.name ?? w}${head ? ' <span class="hs">★ HEADSHOT</span>' : ''}</span><span class="v">${nm(v)}</span>`;
    this.feed.appendChild(row);
    while (this.feed.children.length > 6) this.feed.firstChild!.remove();
    setTimeout(() => row.remove(), 7000);
  }
  hitMarker(kind: 'body' | 'head' | 'kill') {
    const h = this.el.hit!; h.className = 'hitm on' + (kind === 'head' ? ' head' : kind === 'kill' ? ' kill' : '');
    this.hitTimer = 0.14;
  }
  damageFrom(angleRelToView: number) {
    const e = this.dmgEls[this.dmgIdx++ % this.dmgEls.length]!;
    e.style.transform = `rotate(${angleRelToView}rad)`; e.style.transition = 'none'; e.style.opacity = '1';
    requestAnimationFrame(() => { e.style.transition = 'opacity 1.4s ease-out'; e.style.opacity = '0'; });
  }
  banner(big: string, sub = '', ms = 2600, color = '#fff') {
    const b = this.el.banner!; (b.firstElementChild as HTMLElement).textContent = big; (b.firstElementChild as HTMLElement).style.color = color; (b.lastElementChild as HTMLElement).textContent = sub;
    b.classList.add('on'); this.bannerTimer = ms / 1000;
  }
  toast(text: string, ms = 2400) { const t = this.el.toast!; t.textContent = text; t.classList.add('on'); this.toastTimer = ms / 1000; }

  // ----------------------------------------------------------------- per-frame
  update(dt: number, view: ViewState, local: ViewPlayer | null, ctx: HudContext) {
    const st = loadSettings();
    // timers
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.el.hit!.classList.remove('on'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.el.banner!.classList.remove('on'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.el.toast!.classList.remove('on'); }

    // scorebar
    const myTeamVan = (squad: number) => (squad ^ (view.swapped ? 1 : 0)) as 0 | 1;
    const sideScore = [0, 0];
    sideScore[myTeamVan(0)] = view.score[0]; sideScore[myTeamVan(1)] = view.score[1];
    this.setText('s0', String(sideScore[0])); this.setText('s1', String(sideScore[1]));
    for (const t of [0, 1]) {
      const list = [...view.players.values()].filter((p) => p.team === t);
      this.set(`p${t}`, list.map((p) => `<span class="pip${p.alive ? '' : ' dead'}"></span>`).join(''));
    }
    const planted = view.bomb.state === 'planted';
    let secs = planted ? view.bomb.timeLeft : view.phaseT;
    secs = Math.max(0, secs);
    const label = view.phase === 'freeze' ? 'Buy time' : view.phase === 'warmup' ? 'Warm-up' : planted ? 'Device' : view.phase === 'matchEnd' ? 'Match over' : `Round ${view.round}`;
    this.setText('time', `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`);
    this.setText('round', label);
    this.el.clock!.className = 'clock' + (planted ? ' planted' : secs < 10 && view.phase === 'live' ? ' warn' : '');

    // vitals for the player being viewed (self, or spectated target)
    const me = ctx.spectating ?? local;
    if (me) {
      this.set('hp', `<small>HEALTH</small>${Math.max(0, Math.ceil(me.hp))}`);
      this.el.hp!.classList.toggle('low', me.alive && me.hp <= 25);
      this.set('ar', `<small>ARMOR</small>${Math.ceil(me.armor)}${me.helmet ? ' ⛑' : ''}`);
      this.setText('money', local ? `$${local.money}` : '');
      const def = WEAPONS[me.weapon];
      this.setText('mag', def.slot === 'melee' ? '–' : String(me.mag));
      this.el.mag!.classList.toggle('low', def.slot !== 'melee' && me.mag <= Math.ceil(def.mag * 0.2));
      this.setText('rsv', def.slot === 'melee' ? '' : `/ ${me.reserve}`);
      this.setText('wname', me.reloading ? `${def.name} — reloading` : def.name);
      this.set('slots', me.slots.map((w, i) => (w ? `<span class="slot${me.cur === i ? ' cur' : ''}">${i + 1} ${WEAPONS[w].name.split(' ')[0]}</span>` : '')).join(''));
    }

    // crosshair
    const gap = (3 + ctx.spread * 5.5) * st.crosshairGap, len = 8 * st.crosshairSize;
    const cr = this.el.cross!; cr.style.setProperty('--gap', gap.toFixed(1)); cr.style.setProperty('--len', len.toFixed(1)); cr.style.setProperty('--cc', st.crosshairColor);
    cr.style.display = local?.alive && !ctx.spectating && view.phase !== 'matchEnd' ? '' : 'none';

    // vignette / prompt / progress
    this.el.vig!.style.opacity = local?.alive && local.hp < 35 ? String(1 - local.hp / 35) : '0';
    if (ctx.prompt) {
      const html = `<span class="k">${keyLabel(st.keys.use!)}</span>${esc(ctx.prompt)}` + (ctx.progress !== null ? `<div class="progress"><b style="width:${Math.round(ctx.progress * 100)}%"></b></div>` : '');
      this.set('prompt', html);
    } else this.set('prompt', '');

    // spectator banner
    const spec = this.el.spec!;
    if (ctx.spectating) { spec.classList.remove('hidden'); this.set('spec', `Spectating <b>${esc(ctx.spectating.name)}</b><small>Click or ${keyLabel(st.keys.spectateNext!)} to cycle teammates</small>`); }
    else spec.classList.add('hidden');

    // minimap (4 Hz is plenty)
    this.miniAcc += dt;
    if (this.miniAcc > 0.1) { this.miniAcc = 0; this.drawMini(view, me, ctx.visibleEnemies); }

    // teammate nametags
    let ti = 0;
    for (const p of view.players.values()) {
      if (!p.alive || p.id === (local?.id ?? -1) || p.team !== (me?.team ?? -1) || p.id === me?.id) continue;
      this.v3.set(p.x, p.y + (p.crouching ? 1.5 : 1.95), p.z).project(ctx.camera);
      if (this.v3.z > 1 || this.v3.z < -1) continue;
      let el = this.tags[ti];
      if (!el) { el = document.createElement('div'); el.className = 'tag'; this.root.appendChild(el); this.tags[ti] = el; }
      el.style.display = ''; el.style.left = `${(this.v3.x * 0.5 + 0.5) * 100}%`; el.style.top = `${(-this.v3.y * 0.5 + 0.5) * 100}%`;
      el.style.color = teamColor(p.team);
      el.innerHTML = `${esc(p.name)}<span class="b"><i style="width:${p.hp}%"></i></span>`;
      ti++;
    }
    for (let i = ti; i < this.tags.length; i++) this.tags[i]!.style.display = 'none';

    // perf readout
    const f = this.el.fps!;
    if (st.showFps) { f.classList.remove('hidden'); this.setText('fps', `${ctx.fps.toFixed(0)} fps · ${ctx.frameMs.toFixed(1)} ms\n${ctx.drawCalls} calls · ${(ctx.tris / 1000).toFixed(0)}k tris · ${(ctx.scale * 100).toFixed(0)}% res${ctx.netInfo ? '\n' + ctx.netInfo : ''}`); f.style.whiteSpace = 'pre'; }
    else f.classList.add('hidden');
    void RULES; void TEAM_NAMES;
  }

  show(v: boolean) { this.root.style.display = v ? '' : 'none'; }
}

export function esc(s: string): string { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
