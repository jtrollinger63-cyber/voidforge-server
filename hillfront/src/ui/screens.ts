import * as THREE from 'three';
import { BUY_ITEMS, WEAPONS, type WeaponId } from '../gameplay/weapons.ts';
import type { ViewState, ViewPlayer } from '../gameplay/view.ts';
import { loadSettings, updateSettings, resetSettings, KEY_LABELS, DEFAULT_KEYS, keyLabel, type Settings } from '../engine/settings.ts';
import { sfx } from '../audio/sfx.ts';
import { esc } from './hud.ts';

type Child = string | Node | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) { if (c === null || c === undefined || c === false) continue; e.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return e;
}

// ----------------------------------------------------------------------------- weapon icons
const iconCache = new Map<WeaponId, string>();
export function renderWeaponIcons(renderer: THREE.WebGLRenderer, weapons: THREE.Object3D): Map<WeaponId, string> {
  if (iconCache.size) return iconCache;
  const W = 384, Ht = 168;
  const rt = new THREE.WebGLRenderTarget(W, Ht, { colorSpace: THREE.SRGBColorSpace } as any);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x8c7a5c, 2.1)); const dl = new THREE.DirectionalLight(0xfff0d8, 2.6); dl.position.set(2, 3, 1.5); scene.add(dl);
  const cam = new THREE.OrthographicCamera(-0.62, 0.62, 0.27, -0.27, 0.01, 10); cam.position.set(3, 0.1, 0); cam.lookAt(0, 0.1, 0);
  const prevRT = renderer.getRenderTarget(); const prevTM = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  const buf = new Uint8Array(W * Ht * 4); const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = Ht; const g = canvas.getContext('2d')!;
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const def = WEAPONS[id]; const src = weapons.getObjectByName(def.model3p.vanguard); if (!src) continue;
    // camera sits on +X looking at -X: screen-right is world -Z, so rotate 180° to put the muzzle (+Z) on the right
    const m = src.clone(true); m.rotation.y = Math.PI; scene.add(m);
    const box = new THREE.Box3().setFromObject(m); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    const fit = Math.min(1.1 / Math.max(sz.z, sz.x, 0.01), 0.42 / Math.max(sz.y, 0.01)); m.scale.multiplyScalar(fit); m.position.sub(c.multiplyScalar(fit)); m.position.y += 0.1;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, Ht, buf);
    const img = g.createImageData(W, Ht);
    for (let y = 0; y < Ht; y++) img.data.set(buf.subarray((Ht - 1 - y) * W * 4, (Ht - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0); iconCache.set(id, canvas.toDataURL('image/png'));
    scene.remove(m);
  }
  renderer.setRenderTarget(prevRT); renderer.toneMapping = prevTM; rt.dispose();
  return iconCache;
}

// ----------------------------------------------------------------------------- helpers
export class Screens {
  private layer: HTMLElement;
  private current: { name: string; el: HTMLElement } | null = null;
  onClose: (() => void) | null = null;
  icons: Map<WeaponId, string> = new Map();

  constructor(parent: HTMLElement) { this.layer = h('div', { id: 'screens' }); parent.appendChild(this.layer); }

  get open(): string | null { return this.current?.name ?? null; }
  close() { if (this.current) { this.current.el.remove(); this.current = null; this.onClose?.(); } }
  private show(name: string, el: HTMLElement) { this.close(); this.layer.appendChild(el); this.current = { name, el }; }

  // ----------------------------------------------------------------------------- buy
  buy(view: ViewState, me: ViewPlayer, doBuy: (id: string) => { ok: boolean; reason?: string }, canBuy: () => boolean) {
    const render = () => {
      const st = loadSettings();
      const owned = (id: string) => me.slots.includes(id as WeaponId) || (id === 'armor' && me.armor >= 100 && me.helmet) || (id === 'kit' && me.kit);
      const cards = BUY_ITEMS.filter((i) => !i.team || (i.team === 'vanguard') === (me.team === 0)).map((item, idx) => {
        const w = item.weapon ? WEAPONS[item.weapon] : null;
        const locked = item.price > me.money || !canBuy();
        const stat = (t: string, v: number) => h('div', { class: 'stat' }, h('span', { class: 't' }, t), h('span', { class: 'bar' }, h('i', { style: { width: `${Math.round(Math.min(1, v) * 100)}%` } })));
        return h('button', { class: `wcard${owned(item.id) ? ' owned' : ''}${locked && !owned(item.id) ? ' locked' : ''}`, 'data-id': item.id, onClick: () => { const r = doBuy(item.id); if (!r.ok) { sfx.uiError(); toast(r.reason ?? 'Cannot buy'); } else { sfx.buy(); render(); } } },
          h('span', { class: 'hk kbd' }, String(idx + 1)),
          h('div', { class: 'nm' }, item.name),
          h('div', { class: 'pr' }, item.price === 0 ? 'Included' : `$${item.price}`),
          w && this.icons.get(w.id) ? h('img', { src: this.icons.get(w.id)!, alt: w.name }) : h('div', { style: { height: '84px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '34px' } }, item.kind === 'armor' ? '🛡' : item.kind === 'kit' ? '🧰' : '🔫'),
          h('div', { class: 'bl' }, w ? w.blurb : item.kind === 'armor' ? 'Absorbs bullet damage and protects the head.' : 'Disarm the device in about half the time.'),
          w && w.slot !== 'melee' ? h('div', {}, stat('Damage', (w.damage * w.pellets * 0.5) / 60), stat('Fire rate', w.rpm / 800), stat('Accuracy', 1 - w.spreadBase / 5), stat('Mobility', (w.moveMul - 0.8) / 0.25)) : null);
      });
      const el = h('div', { class: 'overlay' }, h('div', { class: 'card buy' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Quartermaster'), h('div', { class: 'sand mono', style: { fontSize: '22px', fontWeight: '800' } }, `$${me.money}`), h('button', { class: 'btn', onClick: () => this.close() }, `Close (${keyLabel(st.keys.buy!)})`)),
        h('div', { class: 'dim', style: { fontSize: '12px', marginBottom: '10px' } }, canBuy() ? 'Click a card or press its number. Purchases are final; weapons you keep survive the round.' : 'Buy time is over.'),
        h('div', { class: 'grid' }, ...cards)));
      this.show('buy', el);
    };
    render();
  }

  // ----------------------------------------------------------------------------- scoreboard
  scoreboard(view: ViewState, localId: number) {
    const mk = (team: 0 | 1) => {
      const list = [...view.players.values()].filter((p) => p.team === team).sort((a, b) => b.score - a.score || b.kills - a.kills);
      const squad = list[0]?.squad ?? (team ^ (view.swapped ? 1 : 0));
      return h('div', { style: { '--c': team === 0 ? 'var(--van)' : 'var(--gar)' } as any },
        h('div', { class: 'th' }, h('span', {}, team === 0 ? 'Vanguard' : 'Garrison'), h('span', { class: 'mono' }, String(view.score[squad as 0 | 1]))),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'n' }, 'K'), h('th', { class: 'n' }, 'A'), h('th', { class: 'n' }, 'D'), h('th', { class: 'n' }, 'Score'), h('th', { class: 'n' }, '$'), h('th', { class: 'n' }, 'Ping'))),
          h('tbody', {}, ...list.map((p) => h('tr', { class: `${p.id === localId ? 'me' : ''}${p.alive ? '' : ' dead'}` },
            h('td', {}, p.name, p.bot ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'bot') : null, p.hasDevice ? ' 💣' : ''), h('td', { class: 'n' }, String(p.kills)), h('td', { class: 'n' }, String(p.assists)), h('td', { class: 'n' }, String(p.deaths)), h('td', { class: 'n' }, String(p.score)),
            h('td', { class: 'n' }, team === (view.players.get(localId)?.team ?? -1) ? `$${p.money}` : '—'), h('td', { class: 'n' }, p.bot ? '—' : String(p.ping)))))));
    };
    const el = h('div', { class: 'overlay clear' }, h('div', { class: 'card sb' }, h('h2', {}, `Round ${view.round} · ${view.mode === 'objective' ? 'Objective' : 'Elimination'}`), mk(0), mk(1)));
    this.show('score', el);
  }
  isScoreboardOpen() { return this.current?.name === 'score'; }

  // ----------------------------------------------------------------------------- pause
  pause(opts: { onResume: () => void; onSettings: () => void; onQuit: () => void; onRestart?: () => void; online: boolean }) {
    const el = h('div', { class: 'overlay' }, h('div', { class: 'card', style: { width: '340px' } },
      h('h2', {}, 'Paused'),
      h('div', { class: 'col' },
        h('button', { class: 'btn primary big', onClick: () => { this.close(); opts.onResume(); } }, 'Resume'),
        h('button', { class: 'btn', onClick: opts.onSettings }, 'Settings'),
        opts.onRestart && !opts.online ? h('button', { class: 'btn', onClick: () => { this.close(); opts.onRestart!(); } }, 'Restart practice match') : null,
        h('button', { class: 'btn danger', onClick: () => { this.close(); opts.onQuit(); } }, opts.online ? 'Leave match' : 'Quit to menu')),
      h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '14px' } }, opts.online ? 'Online matches keep running while you are in this menu.' : 'Practice matches pause while this menu is open.')));
    this.show('pause', el);
  }

  // ----------------------------------------------------------------------------- results
  result(view: ViewState, localSquad: number, actions: { again?: () => void; menu: () => void; party?: () => void }) {
    const won = view.matchWinnerSquad === localSquad;
    const list = [...view.players.values()].sort((a, b) => b.score - a.score).slice(0, 3);
    const el = h('div', { class: 'overlay' }, h('div', { class: 'card result' },
      h('div', { class: 'big', style: { color: won ? 'var(--ok)' : 'var(--bad)' } }, won ? 'Victory' : 'Defeat'),
      h('div', { class: 'dim' }, `Final score ${view.score[localSquad as 0 | 1]} – ${view.score[(localSquad ^ 1) as 0 | 1]}`),
      h('h3', {}, 'Top performers'),
      h('div', { class: 'col' }, ...list.map((p, i) => h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', {}, `${i + 1}. ${p.name}`), h('span', { class: 'mono dim' }, `${p.kills} K / ${p.deaths} D · ${p.score} pts`)))),
      h('div', { class: 'row', style: { marginTop: '18px', justifyContent: 'center' } },
        actions.again ? h('button', { class: 'btn primary', onClick: () => { this.close(); actions.again!(); } }, 'Play again') : null,
        actions.party ? h('button', { class: 'btn', onClick: () => { this.close(); actions.party!(); } }, 'Back to party lobby') : null,
        h('button', { class: 'btn', onClick: () => { this.close(); actions.menu(); } }, 'Main menu'))));
    this.show('result', el);
  }

  // ----------------------------------------------------------------------------- settings
  settings(onChange: (s: Settings) => void, onBack?: () => void) {
    let tab = 'controls'; let rebinding: string | null = null;
    const render = () => {
      const s = loadSettings();
      const set = (p: Partial<Settings>) => { const n = updateSettings(p); onChange(n); };
      const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string = (v) => v.toFixed(2)) => h('label', { class: 'f' }, h('span', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', {}, label), h('span', { class: 'sand mono' }, fmt(s[key] as number))),
        h('input', { type: 'range', min, max, step, value: s[key], onInput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).previousElementSibling; set({ [key]: v } as any); (e.target as HTMLElement).parentElement!.querySelector('.sand')!.textContent = fmt(v); } }));
      const check = (label: string, key: keyof Settings) => h('label', { class: 'row', style: { fontSize: '14px', gap: '10px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: s[key] ? true : null, onChange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked } as any) }), label);
      const seg = <T extends string>(key: keyof Settings, opts: [T, string][]) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: s[key] === v ? 'on' : '', onClick: () => { set({ [key]: v } as any); render(); } }, l)));

      let body: HTMLElement;
      if (tab === 'controls') {
        body = h('div', { class: 'col', style: { gap: '14px' } },
          h('div', { class: 'row' }, slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05), slider('Field of view', 'fov', 60, 105, 1, (v) => `${v.toFixed(0)}°`)),
          check('Invert vertical look', 'invertY'),
          h('h3', {}, 'Key bindings (click, then press a key)'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '6px 18px' } }, ...Object.keys(DEFAULT_KEYS).map((a) => h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'dim', style: { fontSize: '13px' } }, KEY_LABELS[a] ?? a),
            h('button', { class: 'btn', style: { minWidth: '92px', padding: '5px 10px' }, onClick: () => { rebinding = a; render(); } }, rebinding === a ? 'Press a key…' : keyLabel(s.keys[a]!))))),
          h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Arrow keys always turn the camera, which also works where the browser blocks mouse capture. Hold right mouse button to look around without capture.'),
          h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, onClick: () => { set({ keys: { ...DEFAULT_KEYS } }); render(); } }, 'Reset keys'));
      } else if (tab === 'graphics') {
        body = h('div', { class: 'col', style: { gap: '14px' } },
          h('label', { class: 'f' }, 'Quality preset', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
          h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Low: no shadows, 70 % render scale (aim: weak Chromebooks). Medium: soft shadows. High: larger shadow map + anti-aliasing.'),
          slider('Resolution scale', 'resolutionScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
          check('Dynamic resolution (lower resolution automatically when frame time is high)', 'dynamicRes'),
          check('Show FPS / performance overlay', 'showFps'),
          check('Reduce motion (no head-bob or weapon sway)', 'reduceMotion'));
      } else if (tab === 'audio') {
        body = h('div', { class: 'col', style: { gap: '14px' } }, slider('Master volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`), slider('Music volume', 'musicVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
      } else {
        body = h('div', { class: 'col', style: { gap: '14px' } },
          h('label', { class: 'f' }, 'Player name', h('input', { type: 'text', value: s.name, maxlength: 16, placeholder: 'Guest', onChange: (e: Event) => set({ name: (e.target as HTMLInputElement).value }) })),
          h('div', { class: 'row' }, h('label', { class: 'f' }, 'Crosshair colour', h('input', { type: 'text', value: s.crosshairColor, onChange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (/^#[0-9a-f]{6}$/i.test(v)) set({ crosshairColor: v }); } })), slider('Crosshair size', 'crosshairSize', 0.5, 2.5, 0.1), slider('Crosshair gap', 'crosshairGap', 0, 3, 0.1)),
          check('High-contrast teammate tags', 'highContrastTeams'),
          h('button', { class: 'btn danger', style: { alignSelf: 'flex-start' }, onClick: () => { const n = resetSettings(); onChange(n); render(); } }, 'Reset all settings'));
      }
      const tabs = h('div', { class: 'tabs' }, ...(['controls', 'graphics', 'audio', 'gameplay'] as const).map((t) => h('button', { class: tab === t ? 'on' : '', onClick: () => { tab = t; rebinding = null; render(); } }, t === 'gameplay' ? 'Gameplay & access' : t)));
      const el = h('div', { class: 'overlay' }, h('div', { class: 'card', style: { width: 'min(780px, 94vw)', minHeight: '420px' } }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Settings'), h('button', { class: 'btn', onClick: () => { this.close(); onBack?.(); } }, 'Done')), tabs, body));
      this.show('settings', el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (this.current?.name !== 'settings') return;
      if (rebinding) { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') { const keys = { ...loadSettings().keys, [rebinding]: e.code }; const n = updateSettings({ keys }); onChange(n); } rebinding = null; render(); }
    };
    addEventListener('keydown', onKey, true);
    render();
  }
}

// ----------------------------------------------------------------------------- toasts
let toastHost: HTMLElement | null = null;
export function toast(text: string, ms = 2600) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.appendChild(toastHost); }
  const t = h('div', { class: 't' }, text); toastHost.appendChild(t); setTimeout(() => t.remove(), ms);
}
void esc;
