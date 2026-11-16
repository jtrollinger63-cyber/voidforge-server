// UI controller: title, main menu, mode setup, garage, settings, loading, pause, results, replay, championship.
import { TRACKS, TRACK_BY_ID, ENVS } from './tracks.js';
import { CARS, CAR_BY_ID, deriveSpec, UPGRADES, PAINTS, FINISHES, RIMS, RIM_COLORS } from './cars.js';
import { Save, CUPS, POINTS, DIFFICULTY, DRIFT_MEDALS, fmtMoney, xpForLevel, DEFAULT_SETTINGS } from './save.js';
import { buildTrackData } from './trackmath.js';
import { HUD, ordinal } from './hud.js';
import { Garage } from './garage.js';
import { PRESETS } from './post.js';
import { fmtTime } from './util.js';

const TIPS = ['Tap the handbrake to start a drift, then ease on the throttle to hold the slide.', 'Drifting charges your nitro. Hold Shift on a straight to use it.', 'Brake before the corner, not in it. Weight transfer is your friend.',
  'Kerbs are fast but rough; grass and sand will cost you speed and grip.', 'Upgrade tyres first: more grip improves every corner.', 'Press C to cycle through five camera views, including the cockpit.',
  'Press R to reset to the track if you get stuck.', 'Wet roads in Neon District have less grip: brake earlier.', 'Clean laps and overtakes earn bonus credits.', 'Free Drive is a great way to learn a track before racing it.'];
const MODES = {
  race: { name: 'Quick Race', sub: 'Race', blurb: 'Grid up against AI opponents over multiple laps.' },
  trial: { name: 'Time Trial', sub: 'Solo', blurb: 'Chase your best lap, with splits and a ghost of your personal best.' },
  free: { name: 'Free Drive', sub: 'Explore', blurb: 'No rules, no rivals. Explore the whole environment at your own pace.' },
  drift: { name: 'Drift Challenge', sub: 'Score attack', blurb: 'Link long, controlled slides into a huge multiplied score before time runs out.' },
  cup: { name: 'Championship', sub: 'Career', blurb: 'Compete across a series of events to win cups and unlock cars.' },
};
const SETTINGS_TABS = ['Graphics', 'Audio', 'Controls', 'Game'];

export class UI {
  constructor(game) {
    this.game = game; this.root = document.getElementById('ui'); this.hud = new HUD(document.getElementById('hud')); this.screens = {}; this.cur = null; this.stack = [];
    this.sel = { mode: 'race', trackId: Save.d.last?.trackId || 'circuit', laps: 3, ai: 5, diff: 1, cup: 'rookie' };
    if (Save.d.last) Object.assign(this.sel, Save.d.last);
    this.tdCache = {}; this.thumbs = {}; this.sTab = 0; this.gTab = 0; this.hudLast = performance.now();
    this.build(); this.bind();
    game.garage = this.garage = new Garage(game.renderer);
  }

  // ------------------------------------------------------------------------------------------ plumbing
  build() {
    const mk = (id, cls = '') => { const d = document.createElement('div'); d.className = 'screen ' + cls; d.id = 's-' + id; this.root.appendChild(d); this.screens[id] = d; return d; };
    for (const id of ['title', 'main', 'setup', 'garage', 'settings', 'loading', 'intro', 'pause', 'results', 'replay']) mk(id);
  }
  show(id, opts = {}) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('on', k === id); this.cur = id;
    if (id !== 'garage' && this.game.state === 'garage') this.game.state = this.game.world ? 'menu' : 'boot';
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    const f = this.screens[id].querySelector('[autofocus]'); if (f && !opts.nofocus) setTimeout(() => f.focus?.({ preventScroll: true }), 50);
  }
  hideAll() { for (const el of Object.values(this.screens)) el.classList.remove('on'); this.cur = null; }
  toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.getElementById('toasts').appendChild(d); setTimeout(() => d.remove(), 2300); }
  popup(t, ms = 2400) { const p = document.getElementById('popup'); p.textContent = t; p.classList.add('show'); clearTimeout(this.pt); this.pt = setTimeout(() => p.classList.remove('show'), ms); }
  sfx(k) { this.game.audio.ui(k); }
  td(id) { return (this.tdCache[id] ||= buildTrackData(TRACK_BY_ID[id])); }

  bind() {
    const g = this.game;
    this.root.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; g.audio.init(); this.act(el.dataset.act, el.dataset, el, e); });
    this.root.addEventListener('mouseover', (e) => { const el = e.target.closest('.mbtn,.btn,.tcard,.gcar,.opt'); if (el && el !== this.hov) { this.hov = el; g.audio.ui('hover'); } });
    this.root.addEventListener('input', (e) => { const el = e.target; if (el.dataset.set) this.setSetting(el.dataset.set, el.type === 'range' ? +el.value : el.value, el); });
    addEventListener('keydown', (e) => {
      if (!this.cur) return; const k = e.code;
      if (this.cur === 'title') { if (k !== 'F5' && !e.metaKey && !e.ctrlKey) this.act('enter'); return; }
      if (this.cur === 'main' || this.cur === 'pause') { const items = [...this.screens[this.cur].querySelectorAll('.mbtn')]; const i = items.indexOf(document.activeElement); if (k === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); } else if (k === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); } }
      if (k === 'Escape' && (this.cur === 'setup' || this.cur === 'garage' || this.cur === 'settings')) this.act('back');
      if (this.cur === 'garage') { if (k === 'ArrowDown' || k === 'ArrowUp') { const ids = CARS.map((c) => c.id), i = ids.indexOf(this.gCar), n = ids[(i + (k === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length]; this.act('gcar', { id: n }); e.preventDefault(); } }
    });
    // garage drag / wheel
    const cv = this.game.canvas; let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (this.cur === 'garage') drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    addEventListener('pointermove', (e) => { if (drag && this.cur === 'garage') { this.garage.pointer(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; } });
    addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { if (this.cur === 'garage') { this.garage.zoom(e.deltaY); e.preventDefault(); } }, { passive: false });
    // game events
    g.on('hud', (h) => { const now = performance.now(); h.showFps = Save.settings.showFps; this.hud.update(h, Math.min(0.1, (now - this.hudLast) / 1000)); this.hudLast = now; });
    g.on('countdown', (n) => { this.hud.countdown(n); });
    g.on('toast', (t) => this.toast(t));
    g.on('final-lap', () => { this.hud.center('FINAL LAP', 'small'); this.game.audio.beep(880, 0.15, 0.25); });
    g.on('finish', (e) => { this.hud.center(e.rank === 1 ? 'VICTORY!' : 'FINISH', 'small go'); });
    g.on('intro-done', () => { this.screens.intro.classList.remove('on'); this.hud.show(true); this.touch(true); });
    g.on('results', (d) => this.showResults(d));
    g.on('pause', (p) => { if (p) this.showPause(); else { this.hideAll(); this.hud.show(true); } });
    g.on('record', (t) => this.toast('New personal best ' + fmtTime(t)));
    g.on('replay-tick', (r) => this.replayTick(r)); g.on('replay-end', () => { });
    g.on('replay-back', () => this.act('replay-exit'));
    addEventListener('blur', () => { if (g.state === 'racing' || g.state === 'countdown') g.setPaused(true); });
    // touch controls
    const I = g.input, q = (id) => document.getElementById(id);
    I.bindTouch(q('tL'), 'left'); I.bindTouch(q('tR'), 'right'); I.bindTouch(q('tGas'), 'gas'); I.bindTouch(q('tBrake'), 'brake'); I.bindTouch(q('tNitro'), 'boost'); I.bindTouch(q('tHand'), 'hand');
    I.bindTouch(q('tCam'), null, 'camera'); I.bindTouch(q('tPause'), null, 'pause');
    addEventListener('touchstart', () => { I.usingTouch = true; }, { passive: true, once: true });
  }
  touch(on) { const t = document.getElementById('touch'); const show = on && (this.game.input.usingTouch || matchMedia('(pointer: coarse)').matches); t.hidden = !show; document.body.classList.toggle('touch-ui', !!show); t.style.setProperty('--ts', Save.settings.touchSize); document.getElementById('tL').hidden = document.getElementById('tR').hidden = !!Save.settings.tilt; }

  // ------------------------------------------------------------------------------------------ actions
  async act(a, d = {}, el) {
    const g = this.game, A = g.audio; const click = () => this.sfx('click');
    switch (a) {
      case 'enter': A.init(); A.ui('confirm'); this.renderMain(); this.show('main'); break;
      case 'mode': click(); this.sel.mode = d.mode; if (d.mode === 'cup') this.sel.cup = this.sel.cup || 'rookie'; this.stack.push('main'); this.renderSetup(); this.show('setup'); break;
      case 'garage': click(); this.stack.push(this.cur); this.openGarage(); break;
      case 'settings': click(); this.stack.push(this.cur); this.renderSettings(); this.show('settings'); break;
      case 'back': { this.sfx('back'); const to = this.stack.pop() || 'main'; if (this.cur === 'garage') this.closeGarage(); if (to === 'setup') this.renderSetup(); if (to === 'main') this.renderMain(); if (to === 'pause') this.showPause(); this.show(to); break; }
      case 'track': { const t = TRACK_BY_ID[d.id]; if (!Save.trackUnlocked(t) && !(this.sel.mode === 'cup')) { A.ui('error'); this.toast(`Reach level ${t.unlock} to unlock ${t.tagline}`); break; } click(); this.sel.trackId = d.id; this.renderSetup(); break; }
      case 'opt': click(); this.sel[d.k] = isNaN(+d.v) ? d.v : +d.v; this.renderSetup(true); break;
      case 'cup': click(); { const cup = CUPS.find((c) => c.id === d.id); if (cup.req && !Save.d.cupsWon.includes(cup.req)) { A.ui('error'); this.toast('Win the ' + CUPS.find((c) => c.id === cup.req).name + ' first'); break; } this.sel.cup = d.id; this.renderSetup(); } break;
      case 'cup-reset': click(); delete Save.d.champ[this.sel.cup]; Save.commit(); this.renderSetup(); break;
      case 'start': this.startFromSetup(); break;
      case 'gcar': click(); this.gCar = d.id; this.garage.show(d.id); this.renderGarage(); break;
      case 'gtab': click(); this.gTab = +d.t; this.garage.focusOn(this.gTab === 2 ? 'wheels' : 'car'); this.renderGarage(); break;
      case 'paint': click(); Save.patchSetup(this.gCar, { paint: d.hex }); this.garage.setPaint(d.hex); this.renderGarage(); break;
      case 'finish': click(); Save.patchSetup(this.gCar, { finish: d.id }); this.garage.setPaint(Save.setup(this.gCar).paint, d.id); this.renderGarage(); break;
      case 'rim': click(); Save.patchSetup(this.gCar, { rim: d.id }); this.garage.setRim(d.id, Save.setup(this.gCar).rimColor); this.renderGarage(); break;
      case 'rimc': click(); Save.patchSetup(this.gCar, { rimColor: d.hex }); this.garage.setRim(Save.setup(this.gCar).rim, d.hex); this.renderGarage(); break;
      case 'upgrade': if (Save.buyUpgrade(this.gCar, d.id)) { A.ui('buy'); this.garage.refresh(); this.garage.rev(); this.renderGarage(); } else { A.ui('error'); this.toast('Not enough credits'); } break;
      case 'buycar': if (Save.buyCar(this.gCar)) { A.ui('unlock'); Save.select(this.gCar); this.popup('Car purchased!'); this.renderGarage(); } else { A.ui('error'); this.toast(Save.carUnlockedForPurchase(this.gCar) ? 'Not enough credits' : `Requires level ${CAR_BY_ID[this.gCar].reqLevel}`); } break;
      case 'selectcar': click(); Save.select(this.gCar); this.toast(CAR_BY_ID[this.gCar].name + ' selected'); this.renderGarage(); break;
      case 'stab': click(); this.sTab = +d.t; this.renderSettings(); break;
      case 'tgl': click(); this.setSetting(d.k, !Save.settings[d.k]); this.renderSettings(true); break;
      case 'sel': click(); this.setSetting(d.k, isNaN(+d.v) || d.v === '' ? d.v : +d.v); this.renderSettings(true); break;
      case 'reset-save': if (confirm('Erase all progress, cars and settings?')) { Save.reset(); g.applySettings(); this.renderSettings(); this.toast('Progress reset'); } break;
      case 'resume': click(); g.setPaused(false); this.hideAll(); this.hud.show(true); break;
      case 'restart': click(); this.launch({ ...g.cfg }); break;
      case 'endsession': click(); g.setPaused(false); this.hideAll(); g.player.auto = true; g.finishRace(); break;
      case 'quit': click(); g.setPaused(false); this.toMenu(); break;
      case 'continue': click(); this.afterResults(); break;
      case 'retry': click(); this.launch({ ...g.cfg }); break;
      case 'replay': click(); this.startReplay(); break;
      case 'replay-exit': click(); g.state = 'results'; g.rig.setMode(4); this.show('results'); this.hud.show(false); break;
      case 'replay-toggle': { const R = g.replay; if (R.t >= (g.rec.frames.length - 1) * 0.05 - 0.1) { R.t = 0; } R.playing = !R.playing; this.replayRender(); break; }
      case 'replay-speed': { const R = g.replay; R.speed = R.speed === 1 ? 0.35 : R.speed === 0.35 ? 2 : 1; this.replayRender(); break; }
      case 'replay-cam': g.rig.next(); g.rig.cine.until = 0; break;
      case 'fullscreen': click(); { const d = document, el = d.documentElement; try { if (d.fullscreenElement) d.exitFullscreen(); else (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } catch (e) { this.toast('Fullscreen is not available here'); } } break;
      default: break;
    }
  }

  setSetting(k, v, el) {
    const S = Save.settings, g = this.game; S[k] = v; Save.commit();
    if (['master', 'music', 'sfx', 'engine'].includes(k)) g.audio.setVolumes({ [k]: v });
    else g.applySettings();
    if (el && el.parentElement) { const lab = el.parentElement.querySelector('.val'); if (lab) lab.textContent = fmtSetting(k, v); }
    if (k === 'quality') this.renderSettings(true);
    if (k === 'tilt' || k === 'touchSize') this.touch(this.game.state === 'racing');
  }

  // ------------------------------------------------------------------------------------------ title + main
  renderTitle() {
    this.screens.title.innerHTML = `<div class="scrim"></div><div class="wrap"><div class="title-xl"><span>VOID</span>FORGE<br><span style="color:#fff">RACING</span></div><div class="sub">PREMIUM 3D ARCADE RACER</div><div class="press">PRESS ANY KEY OR TAP TO START</div></div><div class="ver">v2.0 · BUILT FOR THE BROWSER</div>`;
    this.screens.title.addEventListener('pointerdown', () => this.cur === 'title' && this.act('enter'));
  }
  profileHtml() {
    const lp = Save.levelProgress, car = CAR_BY_ID[Save.d.selected];
    return `<div class="profile"><div class="chip">CREDITS <b>${fmtMoney(Save.d.credits)}</b></div><div class="chip lvl"><div class="row" style="justify-content:space-between"><span class="tag">LEVEL</span><b style="color:var(--cy);font-size:20px">${lp.level}</b></div><div class="bar"><i style="width:${Math.round(lp.frac * 100)}%"></i></div><div class="tag" style="margin-top:4px">${lp.into.toLocaleString()} / ${lp.need.toLocaleString()} XP</div></div></div>`;
  }
  renderMain() {
    const car = CAR_BY_ID[Save.d.selected], items = [
      ['race', 'Quick Race', 'Race AI opponents', '▶'], ['trial', 'Time Trial', 'Beat the clock', '⏱'], ['free', 'Free Drive', 'Roam freely', '∞'], ['drift', 'Drift Challenge', 'Score attack', '⤳'], ['cup', 'Championship', `${Save.d.cupsWon.length}/${CUPS.length} cups`, '★']];
    this.screens.main.innerHTML = `<div class="scrim"></div>${this.profileHtml()}<div class="wrap" style="justify-content:center"><div class="title-xl" style="font-size:clamp(30px,5vw,64px);margin-bottom:12px"><span>VOID</span>FORGE <span style="color:#fff;font-size:.6em;letter-spacing:.3em">RACING</span></div>
      <div class="menu-list">${items.map(([m, n, s, ic], i) => `<button class="mbtn" data-act="mode" data-mode="${m}" ${i === 0 ? 'autofocus' : ''}><span class="ic">${ic}</span>${n}<small>${s}</small></button>`).join('')}
      <button class="mbtn" data-act="garage"><span class="ic">⚙</span>Garage<small>${Save.d.owned.length}/${CARS.length} cars</small></button>
      <button class="mbtn" data-act="settings"><span class="ic">☰</span>Settings<small>Graphics &amp; audio</small></button></div></div>
      <div class="carcard"><div class="cl">${car.cls}</div><div class="nm">${car.name}</div><div class="tag">PI ${deriveSpec(car, Save.setup(car.id).upgrades).pi}</div></div>
      <div class="hintbar"><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>Enter</kbd> select · Drag in the garage to rotate the car</div>`;
  }

  // ------------------------------------------------------------------------------------------ setup
  thumb(id) {
    if (this.thumbs[id]) return this.thumbs[id];
    const td = this.td(id), env = ENVS[TRACK_BY_ID[id].env], c = document.createElement('canvas'); c.width = 360; c.height = 220; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 220); gr.addColorStop(0, env.sky.top); gr.addColorStop(0.55, env.sky.mid); gr.addColorStop(1, env.terrain.colors.mid); g.fillStyle = gr; g.fillRect(0, 0, 360, 220);
    g.fillStyle = 'rgba(4,6,12,0.55)'; g.fillRect(0, 0, 360, 220);
    const b = td.bounds, pad = 24, s = Math.min((360 - pad * 2) / (b.maxx - b.minx), (220 - pad * 2) / (b.maxz - b.minz)), ox = (360 - (b.maxx - b.minx) * s) / 2, oz = (220 - (b.maxz - b.minz) * s) / 2;
    const P = (x, z) => [(x - b.minx) * s + ox, (z - b.minz) * s + oz];
    const path = () => { g.beginPath(); for (let i = 0; i <= td.N; i += 3) { const [x, y] = P(td.px[i % td.N], td.pz[i % td.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.lineJoin = 'round'; };
    path(); g.lineWidth = 11; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke(); path(); g.lineWidth = 6; g.strokeStyle = '#dbe6ff'; g.stroke();
    const [sx, sy] = P(td.px[0], td.pz[0]); g.fillStyle = '#ffb703'; g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
    return (this.thumbs[id] = c);
  }
  trackCardHtml(t, sel) {
    const locked = !Save.trackUnlocked(t) && this.sel.mode !== 'cup', rec = Save.record(t.id), td = this.td(t.id);
    return `<button class="tcard ${sel ? 'on' : ''}" data-act="track" data-id="${t.id}"><div class="thumb" data-thumb="${t.id}"></div><div class="meta"><div class="nm">${t.name}</div><div class="tag" style="color:var(--cy)">${t.tagline}</div><div class="ds">${t.blurb}</div>
      <div class="st"><span>${(td.length / 1000).toFixed(1)} KM</span><span class="stars">${'★'.repeat(t.difficulty)}${'☆'.repeat(5 - t.difficulty)}</span>${rec && rec.best ? `<span>BEST ${fmtTime(rec.best)}</span>` : ''}</div></div>${locked ? `<div class="lock"><span>🔒</span>LEVEL ${t.unlock}</div>` : ''}</button>`;
  }
  statsHtml(spec, base) {
    const rows = [['SPEED', 'speed'], ['ACCEL', 'accel'], ['HANDLING', 'handling'], ['BRAKING', 'braking'], ['GRIP', 'grip']];
    return rows.map(([l, k]) => `<div class="stat"><span>${l}</span><div class="b"><i class="${base && spec.stats[k] > base.stats[k] ? 'up' : ''}" style="width:${spec.stats[k]}%"></i></div><span>${spec.stats[k]}</span></div>`).join('');
  }
  renderSetup(keepScroll) {
    const S = this.sel, M = MODES[S.mode], carId = Save.d.selected, car = CAR_BY_ID[carId], spec = deriveSpec(car, Save.setup(carId).upgrades);
    const scroll = keepScroll ? this.screens.setup.querySelector('.cards')?.scrollLeft : 0;
    let mid = '';
    if (S.mode === 'cup') {
      const cup = CUPS.find((c) => c.id === S.cup), st = Save.d.champ[S.cup] || null;
      mid = `<div class="tag">SELECT CUP</div><div class="cards">${CUPS.map((c) => { const locked = c.req && !Save.d.cupsWon.includes(c.req), won = Save.d.cupsWon.includes(c.id); const stt = Save.d.champ[c.id];
        return `<button class="tcard ${c.id === S.cup ? 'on' : ''}" data-act="cup" data-id="${c.id}"><div class="meta" style="padding:20px"><div class="nm" style="font-size:24px">${c.name}</div><div class="ds">${c.blurb}</div><div class="st"><span>${c.events.length} EVENTS</span><span class="stars">${'★'.repeat(c.difficulty + 1)}</span></div><div class="tag" style="margin-top:8px">REWARD: ${fmtMoney(c.reward.credits)} + ${CAR_BY_ID[c.reward.car].name}</div><div class="tag" style="color:${won ? 'var(--ok)' : 'var(--gold)'}">${won ? 'WON ✓' : stt ? `EVENT ${stt.event + 1}/${c.events.length}` : 'NOT STARTED'}</div></div>${locked ? `<div class="lock"><span>🔒</span>WIN ${CUPS.find((x) => x.id === c.req).name.toUpperCase()}</div>` : ''}</button>`; }).join('')}</div>`;
    } else mid = `<div class="tag">SELECT TRACK</div><div class="cards">${TRACKS.map((t) => this.trackCardHtml(t, t.id === S.trackId)).join('')}</div>`;
    const seg = (k, vals, labels) => `<div class="seg">${vals.map((v, i) => `<button class="${S[k] == v ? 'on' : ''}" data-act="opt" data-k="${k}" data-v="${v}">${labels ? labels[i] : v}</button>`).join('')}</div>`;
    let opts = '';
    if (S.mode === 'race') opts = `<div class="field"><label>Laps</label>${seg('laps', [1, 2, 3, 5, 8])}</div><div class="field"><label>Opponents</label>${seg('ai', [3, 5, 7])}</div><div class="field"><label>Difficulty</label>${seg('diff', [0, 1, 2, 3], DIFFICULTY.map((d) => d.name))}</div>`;
    else if (S.mode === 'trial') { const r = Save.record(S.trackId); opts = `<div class="field"><label>Personal best</label><b style="font-size:26px;font-style:italic">${r && r.best ? fmtTime(r.best) : '--:--.---'}</b><div class="tag">${r && r.ghost ? '👻 Ghost of your best lap enabled' : 'Set a lap to unlock your ghost'}</div></div><div class="tag" style="max-width:260px">Unlimited laps. Splits at 8 checkpoints compare against your best lap. Pause to finish and collect rewards.</div>`; }
    else if (S.mode === 'free') opts = `<div class="tag" style="max-width:340px;line-height:1.6">${M.blurb} Use <kbd>R</kbd> to reset to the road, <kbd>C</kbd> for cameras. Pause to collect distance rewards.</div>`;
    else if (S.mode === 'drift') { const m = DRIFT_MEDALS[S.trackId], best = Save.d.drift[S.trackId] || 0; opts = `<div class="field"><label>Medals (score)</label><div class="row" style="gap:18px"><span>🥉 <b>${m[0].toLocaleString()}</b></span><span>🥈 <b>${m[1].toLocaleString()}</b></span><span>🥇 <b>${m[2].toLocaleString()}</b></span></div><div class="tag">Best: ${best.toLocaleString()} · 2:30 time limit</div></div>`; }
    else if (S.mode === 'cup') {
      const cup = CUPS.find((c) => c.id === S.cup), st = Save.d.champ[S.cup], ev = st ? st.event : 0;
      opts = `<div class="field" style="min-width:260px"><label>Events</label>${cup.events.map((e, i) => `<div class="rline" style="padding:5px 0"><span>${i < ev ? '✓' : i === ev ? '▶' : '·'} ${TRACK_BY_ID[e.track].name}</span><b>${e.laps} laps${st && st.results[i] ? ' · ' + ordinal(st.results[i]) : ''}</b></div>`).join('')}</div>${st ? this.standingsHtml(st) : ''}`;
    }
    const canStart = S.mode === 'cup' ? !(CUPS.find((c) => c.id === S.cup).req && !Save.d.cupsWon.includes(CUPS.find((c) => c.id === S.cup).req)) : Save.trackUnlocked(TRACK_BY_ID[S.trackId]);
    const cupSt = S.mode === 'cup' ? Save.d.champ[S.cup] : null, cupDone = cupSt && cupSt.event >= CUPS.find((c) => c.id === S.cup).events.length;
    this.screens.setup.innerHTML = `<div class="scrim full"></div><div class="wrap"><div class="row"><button class="btn alt sm" data-act="back" autofocus>◀ Back</button><h2 class="hd"><small>${M.sub}</small>${M.name}</h2><div class="spacer"></div><div class="chip">CREDITS <b>${fmtMoney(Save.d.credits)}</b></div></div>
      ${mid}
      <div class="row" style="align-items:stretch;flex:1;min-height:0"><div class="panel" style="min-width:min(300px,100%)"><div class="tag">YOUR CAR</div><div style="font-size:24px;font-weight:900;font-style:italic;margin:4px 0">${car.name}</div><div class="tag" style="color:var(--cy)">${car.cls} · PI ${spec.pi}</div><div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">${this.statsHtml(spec)}</div><button class="btn alt sm" style="margin-top:12px" data-act="garage">Change car / Garage</button></div>
      <div class="panel row" style="flex:1;align-items:flex-start;gap:26px">${opts}</div></div>
      <div class="row"><div class="spacer"></div>${cupSt && S.mode === 'cup' ? `<button class="btn alt sm" data-act="cup-reset">Restart cup</button>` : ''}<button class="btn gold" data-act="start" ${canStart && !cupDone ? '' : 'disabled'}>${S.mode === 'cup' ? (cupSt ? (cupDone ? 'Cup complete' : 'Next event') : 'Start cup') : 'Start'} ▶</button></div></div>`;
    for (const el of this.screens.setup.querySelectorAll('[data-thumb]')) el.appendChild(this.thumb(el.dataset.thumb).cloneNode(true)).getContext('2d').drawImage(this.thumb(el.dataset.thumb), 0, 0);
    if (scroll) this.screens.setup.querySelector('.cards').scrollLeft = scroll;
  }
  standingsHtml(st) {
    const rows = Object.entries(st.points).sort((a, b) => b[1] - a[1]);
    return `<div class="field" style="min-width:210px"><label>Standings</label><table class="tbl">${rows.map(([n, p], i) => `<tr class="${n === 'YOU' ? 'me' : ''}"><td>${i + 1}</td><td>${n}</td><td style="text-align:right"><b>${p}</b></td></tr>`).join('')}</table></div>`;
  }

  startFromSetup() {
    const S = this.sel, g = this.game; Save.d.last = { mode: S.mode, trackId: S.trackId, laps: S.laps, ai: S.ai, diff: S.diff, cup: S.cup }; Save.commit();
    const cfg = { mode: S.mode, trackId: S.trackId, carId: Save.d.selected, laps: S.laps, aiCount: S.ai, diff: S.diff };
    if (S.mode === 'trial') { cfg.laps = 99; }
    if (S.mode === 'free') { cfg.laps = 0; }
    if (S.mode === 'cup') {
      const cup = CUPS.find((c) => c.id === S.cup); let st = Save.d.champ[S.cup];
      if (!st) { const names = ['Vex', 'Nova', 'Blaze', 'Rook', 'Echo', 'Zed', 'Kira'].sort(() => Math.random() - 0.5).slice(0, 5); st = Save.d.champ[S.cup] = { event: 0, points: { YOU: 0, ...Object.fromEntries(names.map((n) => [n, 0])) }, results: [], aiNames: names }; Save.commit(); }
      const ev = cup.events[st.event]; Object.assign(cfg, { mode: 'cup', trackId: ev.track, laps: ev.laps, aiCount: 5, diff: cup.difficulty, aiNames: st.aiNames, cup: { id: cup.id, event: st.event } });
    }
    this.launch(cfg);
  }

  async launch(cfg) {
    const g = this.game, def = TRACK_BY_ID[cfg.trackId]; this.lastCfg = cfg; this.stack.length = 0;
    this.hud.show(false); this.touch(false); this.hideAll();
    this.screens.loading.innerHTML = `<div class="ldwrap"><div class="tag">${MODES[cfg.mode].name}${cfg.laps && cfg.laps < 90 ? ' · ' + cfg.laps + ' laps' : ''}</div><div class="ldname">${def.name}</div><div class="tag" style="color:var(--cy);margin-top:6px">${def.tagline}</div><div class="ldbar"><i id="ldb"></i></div><div class="tag" id="ldl" style="margin-top:10px">Loading…</div><div class="ldtip">TIP · ${TIPS[(Math.random() * TIPS.length) | 0]}</div></div>`;
    this.show('loading', { nofocus: true });
    const steps = { 'Loading track…': 6, 'Preparing cars': 90 }; let p = 6;
    const set = (label) => { p = Math.min(96, p + 14); const b = document.getElementById('ldb'), l = document.getElementById('ldl'); if (b) b.style.width = (steps[label] || p) + '%'; if (l) l.textContent = label; };
    try { await g.startSession(cfg, set); } catch (err) { console.error(err); this.toast('Failed to load track: ' + err.message); return this.toMenu(); }
    this.hud.setMode(cfg.mode); this.hud.initMinimap(g.world.td);
    const b = document.getElementById('ldb'); if (b) b.style.width = '100%';
    await new Promise((r) => setTimeout(r, 250));
    const car = CAR_BY_ID[cfg.carId];
    this.screens.intro.innerHTML = `<div class="scrim bottom"></div><div class="wrap" style="justify-content:flex-end;padding-bottom:12vh"><div class="tag" style="color:var(--cy)">${def.tagline}</div><div class="title-xl" style="font-size:clamp(34px,7vw,96px)">${def.name}</div><div class="sub" style="letter-spacing:.3em">${car.name.toUpperCase()} · ${cfg.mode === 'race' || cfg.mode === 'cup' ? cfg.laps + ' LAPS · ' + DIFFICULTY[cfg.diff].name.toUpperCase() : MODES[cfg.mode].name.toUpperCase()}</div><div class="tag" style="margin-top:14px">PRESS ENTER OR SPACE TO SKIP</div></div>`;
    this.show('intro', { nofocus: true }); g.canvas.focus(); this.game.audio.startMusic && this.game.audio.stopMusic();
  }

  // ------------------------------------------------------------------------------------------ pause / results
  showPause() {
    const g = this.game, m = g.cfg.mode;
    this.hud.show(false);
    this.screens.pause.innerHTML = `<div class="scrim full"></div><div class="wrap center"><div class="dlg"><h2 class="hd"><small>${MODES[m].name}</small>PAUSED</h2><button class="mbtn" data-act="resume" autofocus>Resume</button><button class="mbtn" data-act="restart">Restart</button>${m !== 'race' && m !== 'cup' ? '<button class="mbtn" data-act="endsession">Finish &amp; collect rewards</button>' : ''}<button class="mbtn" data-act="settings">Settings</button><button class="mbtn" data-act="quit">Quit to menu</button><div class="tag">Esc to resume · C camera · R reset</div></div></div>`;
    this.stack.length = 0; this.stack.push('pause'); this.show('pause');
  }

  async toMenu() {
    const g = this.game; this.hud.show(false); this.touch(false); this.hideAll();
    this.screens.loading.innerHTML = `<div class="ldwrap"><div class="ldname">Voidforge</div><div class="ldbar"><i id="ldb" style="width:40%"></i></div></div>`; this.show('loading', { nofocus: true });
    await g.showMenuScene(Save.d.last?.trackId && Save.d.last.trackId !== 'neon' ? Save.d.last.trackId : 'coast'); this.renderMain(); this.show('main');
  }

  showResults(d) {
    const g = this.game; this.hud.show(false); this.touch(false); g.rig.setMode(4); g.rig.cine.until = 0;
    const p = d.rows.find((r) => r.isPlayer), mode = d.mode;
    let cupHtml = '', champ = null, afterCup = null;
    if (mode === 'cup') champ = this.applyCupResult(d);
    const unlocked = [];
    if (d.levelUp) { for (const t of TRACKS) if (t.unlock > d.before && t.unlock <= d.levelUp) unlocked.push('Track unlocked: ' + t.name); for (const c of CARS) if (c.reqLevel > d.before && c.reqLevel <= d.levelUp && !Save.owns(c.id)) unlocked.push(c.name + ' now available in the garage'); }
    const title = mode === 'drift' ? ['No medal', 'Bronze medal', 'Silver medal', 'GOLD MEDAL'][d.drift.medal] : mode === 'trial' ? 'Session complete' : mode === 'free' ? 'Session complete' : d.pos === 1 ? 'VICTORY' : d.pos <= 3 ? 'PODIUM' : 'FINISHED';
    const left = mode === 'race' || mode === 'cup'
      ? `<table class="tbl"><thead><tr><th>#</th><th>DRIVER</th><th>CAR</th><th>BEST LAP</th><th style="text-align:right">TIME</th></tr></thead><tbody>${d.rows.map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td><span class="dot" style="background:${r.color}"></span>${r.name}</td><td>${r.car}</td><td>${fmtTime(r.best)}</td><td style="text-align:right">${r.time != null ? fmtTime(r.time) : 'Lap ' + r.laps}</td></tr>`).join('')}</tbody></table>`
      : mode === 'drift' ? `<div style="text-align:center;padding:20px"><div class="tag">TOTAL SCORE</div><div class="big-pos">${d.drift.total.toLocaleString()}</div><div class="tag">Best chain ${d.drift.best.toLocaleString()} · ${DRIFT_MEDALS[d.cfg.trackId].map((m, i) => `${['🥉', '🥈', '🥇'][i]} ${m.toLocaleString()}`).join('  ')}</div></div>`
        : `<div style="text-align:center;padding:20px"><div class="tag">BEST LAP</div><div class="big-pos" style="font-size:clamp(34px,6vw,76px)">${fmtTime(d.best)}</div><div class="tag">${d.stats.distance ? (d.stats.distance / 1000).toFixed(1) + ' km driven' : ''} · top speed ${Math.round(d.stats.topSpeed)} km/h</div></div>`;
    if (champ) cupHtml = `<div style="margin-top:12px"><div class="tag">CHAMPIONSHIP — ${CUPS.find((c) => c.id === d.cfg.cup.id).name}</div>${this.standingsHtml(champ.st)}${champ.won ? `<div class="popupline" style="color:var(--gold);font-weight:900;margin-top:8px">🏆 CUP WON! +${fmtMoney(champ.reward.credits)} and ${CAR_BY_ID[champ.reward.car].name}</div>` : champ.done ? `<div style="color:var(--bad);margin-top:8px;font-weight:800">Cup finished — you needed first place overall. Restart the cup to try again.</div>` : ''}</div>`;
    this.screens.results.innerHTML = `<div class="scrim full"></div><div class="wrap"><div class="res"><div class="panel"><div class="row" style="align-items:flex-end;margin-bottom:10px"><div><div class="tag">${def(d)}</div><div class="big-pos">${mode === 'race' || mode === 'cup' ? ordinal(d.pos) : ''}${mode === 'drift' || mode === 'trial' || mode === 'free' ? title.toUpperCase() : ''}</div></div><div class="spacer"></div>${d.record ? '<div class="chip" style="color:var(--ok)">★ NEW RECORD</div>' : ''}</div>${left}${cupHtml}</div>
      <div class="panel"><div class="tag">REWARDS</div>${d.lines.map(([l, v]) => `<div class="rline"><span>${l}</span><b>+${fmtMoney(v)}</b></div>`).join('')}<div class="rtotal"><span>TOTAL</span><span style="color:var(--gold)" id="rtot">$0</span></div>
      <div class="tag" style="margin-top:16px">EXPERIENCE <b style="color:var(--cy)">+${d.xp.toLocaleString()} XP</b></div><div class="lvl" style="width:100%;margin-top:6px"><div class="row" style="justify-content:space-between"><span class="tag">LEVEL ${Save.level}</span><span class="tag">${Save.levelProgress.into} / ${Save.levelProgress.need}</span></div><div class="bar" style="height:10px;border-radius:5px;background:rgba(255,255,255,.14);overflow:hidden;margin-top:6px"><i id="rxp" style="display:block;height:100%;width:0;background:linear-gradient(90deg,var(--cy),var(--mg));transition:width 1.2s"></i></div></div>
      ${unlocked.map((u) => `<div class="chip" style="margin-top:10px;color:var(--gold)">🔓 ${u}</div>`).join('')}
      <div class="row" style="margin-top:18px"><button class="btn gold" data-act="continue" autofocus>${champ && !champ.done ? 'Continue' : 'Continue'}</button><button class="btn alt sm" data-act="retry">Retry</button>${g.rec && g.rec.frames.length > 40 ? '<button class="btn alt sm" data-act="replay">Watch replay</button>' : ''}</div></div></div></div>`;
    this.show('results');
    // count-up
    const tot = document.getElementById('rtot'); let t0 = performance.now(); const tick = (t) => { const k = Math.min(1, (t - t0) / 1400); tot.textContent = fmtMoney(d.credits * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    setTimeout(() => { const x = document.getElementById('rxp'); if (x) x.style.width = Math.round(Save.levelProgress.frac * 100) + '%'; }, 120);
    if (d.levelUp) { this.popup('LEVEL UP! ' + d.levelUp); g.audio.ui('unlock'); } else if (unlocked.length) g.audio.ui('unlock');
    this.pendingCup = champ;
    function def(dd) { return TRACK_BY_ID[dd.cfg.trackId].name + ' · ' + MODES[dd.mode].name; }
  }

  applyCupResult(d) {
    const cupId = d.cfg.cup.id, cup = CUPS.find((c) => c.id === cupId), st = Save.d.champ[cupId]; if (!st || st.event !== d.cfg.cup.event) return { st: st || { points: {} }, done: false };
    d.rows.forEach((r) => { const key = r.isPlayer ? 'YOU' : r.name; st.points[key] = (st.points[key] || 0) + (POINTS[r.pos - 1] || 0); });
    st.results[st.event] = d.pos; st.event++;
    const done = st.event >= cup.events.length; let won = false;
    if (done) { const top = Object.entries(st.points).sort((a, b) => b[1] - a[1])[0][0]; won = top === 'YOU'; if (won && !Save.d.cupsWon.includes(cupId)) { Save.d.cupsWon.push(cupId); Save.addCredits(cup.reward.credits); Save.grantCar(cup.reward.car); } }
    Save.commit(); return { st, done, won, reward: cup.reward };
  }
  afterResults() {
    const c = this.pendingCup;
    if (this.game.cfg.mode === 'cup' && c && !c.done) { this.sel.mode = 'cup'; this.sel.cup = this.game.cfg.cup.id; this.toMenuThen(() => { this.stack = ['main']; this.renderSetup(); this.show('setup'); }); }
    else this.toMenuThen(() => { this.renderMain(); this.show('main'); });
  }
  async toMenuThen(fn) { await this.toMenu(); fn(); }

  // ------------------------------------------------------------------------------------------ replay
  startReplay() {
    const g = this.game; if (!g.startReplay()) { this.toast('No replay available'); return; }
    this.hud.show(false); this.replayRender(); this.show('replay', { nofocus: true });
  }
  replayRender() {
    const R = this.game.replay; this.screens.replay.innerHTML = `<div class="scrim bottom"></div><div style="position:absolute;left:0;right:0;top:18px;text-align:center" class="tag">REPLAY · CINEMATIC CAMERA</div><div class="replaybar"><button class="btn sm" data-act="replay-toggle">${R && R.playing ? '❚❚' : '▶'}</button><input type="range" id="rScrub" min="0" max="1000" value="0"><button class="btn alt sm" data-act="replay-speed">${R.speed}x</button><button class="btn alt sm" data-act="replay-cam">Camera</button><button class="btn alt sm" data-act="replay-exit">Exit</button></div>`;
    const sc = this.screens.replay.querySelector('#rScrub'); sc.oninput = () => { const r = this.game.replay, dur = (this.game.rec.frames.length - 1) * 0.05; r.t = (sc.value / 1000) * dur; r.playing = false; };
  }
  replayTick(r) { const sc = this.screens.replay.querySelector('#rScrub'); if (sc && document.activeElement !== sc) sc.value = Math.round((r.t / r.dur) * 1000); }

  // ------------------------------------------------------------------------------------------ garage
  openGarage() {
    const g = this.game; this.hud.show(false); this.gCar = Save.d.selected; this.gTab = 0; g.state = 'garage'; g.audio.silence();
    this.garage.resize(g.w, g.h); this.garage.show(this.gCar, true); this.renderGarage(); this.show('garage', { nofocus: true });
  }
  closeGarage() { const g = this.game; g.state = g.world ? 'menu' : 'boot'; if (g.world) { g.renderer.toneMappingExposure = g.world.env.exposure; } this.game.post.setScene(g.scene); this.game.post.setCamera(g.camera); if (g.world) g.post.setGrade(g.world.env.grade); }
  renderGarage() {
    const id = this.gCar, car = CAR_BY_ID[id], owned = Save.owns(id), setup = Save.setup(id), spec = deriveSpec(car, setup.upgrades), base = deriveSpec(car, {});
    const list = CARS.map((c) => { const o = Save.owns(c.id), s = deriveSpec(c, Save.setup(c.id).upgrades), lockedLevel = !o && !Save.carUnlockedForPurchase(c.id);
      return `<button class="gcar ${c.id === id ? 'on' : ''} ${o ? '' : 'lockedc'}" data-act="gcar" data-id="${c.id}"><div class="n">${c.name}</div><div class="c">${c.cls}</div><div class="pi">${s.pi}</div><div class="tagc">${o ? (Save.d.selected === c.id ? 'SELECTED' : 'OWNED') : lockedLevel ? '🔒 LVL ' + c.reqLevel : fmtMoney(c.price)}</div></button>`; }).join('');
    const tabs = ['Overview', 'Paint', 'Wheels', 'Upgrades'];
    let body = '';
    if (this.gTab === 0) body = `<div class="tag">${car.tagline}</div><div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">${this.statsHtml(spec, base)}</div>
      <div class="rline"><span>Power</span><b>${Math.round(spec.hp)} hp</b></div><div class="rline"><span>Weight</span><b>${Math.round(spec.mass)} kg</b></div><div class="rline"><span>Top speed</span><b>${Math.round(spec.topKmh)} km/h</b></div><div class="rline"><span>Drivetrain</span><b>${car.drive}${car.turbo ? ' · Turbo' : ''}</b></div><div class="rline"><span>Performance index</span><b>${spec.pi}</b></div>`;
    else if (this.gTab === 1) body = `<div class="lab">Colour</div><div class="swatches">${PAINTS.map(([n, h]) => `<button class="sw ${h === setup.paint ? 'on' : ''}" title="${n}" style="background:${h}" data-act="paint" data-hex="${h}"></button>`).join('')}</div><div class="lab" style="margin-top:14px">Finish</div><div class="row">${FINISHES.map((f) => `<button class="opt ${f.id === setup.finish ? 'on' : ''}" data-act="finish" data-id="${f.id}">${f.name}</button>`).join('')}</div>${owned ? '' : '<div class="tag" style="color:var(--gold)">Customisation saves once purchased</div>'}`;
    else if (this.gTab === 2) body = `<div class="lab">Wheel design</div><div class="row">${RIMS.map((r) => `<button class="opt ${r.id === setup.rim ? 'on' : ''}" data-act="rim" data-id="${r.id}">${r.name}</button>`).join('')}</div><div class="lab" style="margin-top:14px">Wheel colour</div><div class="swatches">${RIM_COLORS.map(([n, h]) => `<button class="sw ${h === setup.rimColor ? 'on' : ''}" title="${n}" style="background:${h}" data-act="rimc" data-hex="${h}"></button>`).join('')}</div>`;
    else body = UPGRADES.map((u) => { const lv = setup.upgrades[u.id] || 0, cost = lv < u.max ? Save.upgradeCostFor(id, u.id) : 0;
      return `<div class="upg"><div class="n">${u.name}</div><div></div><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div><button class="btn sm ${lv >= u.max ? 'alt' : 'gold'}" data-act="upgrade" data-id="${u.id}" ${!owned || lv >= u.max ? 'disabled' : ''}>${lv >= u.max ? 'MAX' : fmtMoney(cost)}</button><div class="d">${u.desc}</div></div>`; }).join('') + (owned ? '' : '<div class="tag" style="color:var(--gold);margin-top:10px">Buy this car to upgrade it</div>');
    const action = owned ? (Save.d.selected === id ? '<button class="btn alt" disabled>Selected ✓</button>' : '<button class="btn gold" data-act="selectcar">Select car</button>') : `<button class="btn gold" data-act="buycar">${Save.carUnlockedForPurchase(id) ? 'Buy · ' + fmtMoney(car.price) : '🔒 Level ' + car.reqLevel}</button>`;
    this.screens.garage.innerHTML = `<div class="wrap"><div class="glist"><div class="tag">GARAGE</div>${list}</div><div class="spacer"></div><div class="gpanel panel"><div class="tabs">${tabs.map((t, i) => `<button class="${i === this.gTab ? 'on' : ''}" data-act="gtab" data-t="${i}">${t}</button>`).join('')}</div>${body}</div></div>
      <div class="gname"><div class="cl">${car.cls}</div><div class="nm">${car.name}</div></div><div class="gfoot"><div class="row"><button class="btn alt" data-act="back" autofocus>◀ Back</button><div class="chip">CREDITS <b>${fmtMoney(Save.d.credits)}</b></div></div>${action}</div>`;
  }

  // ------------------------------------------------------------------------------------------ settings
  renderSettings() {
    const S = Save.settings, T = this.sTab;
    const row = (name, desc, ctl) => `<div class="setrow"><div><div style="font-weight:800">${name}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>${ctl}</div>`;
    const sl = (k, min, max, step) => `<div class="slider"><input type="range" data-set="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><span class="val">${fmtSetting(k, S[k])}</span></div>`;
    const tg = (k) => `<button class="toggle ${S[k] ? 'on' : ''}" data-act="tgl" data-k="${k}"></button>`;
    const sg = (k, vals, labels) => `<div class="seg">${vals.map((v, i) => `<button class="${S[k] === v ? 'on' : ''}" data-act="sel" data-k="${k}" data-v="${v}">${labels[i]}</button>`).join('')}</div>`;
    let body = '';
    if (T === 0) body = row('Graphics preset', 'Low disables post-processing; Ultra adds 4096 shadows, MSAA and full motion blur.', sg('quality', ['low', 'medium', 'high', 'ultra'], ['Low', 'Medium', 'High', 'Ultra'])) + row('Resolution scale', 'Lower this on slower devices. The game also adapts automatically.', sl('resScale', 0.5, 1.25, 0.05)) + row('Shadows', '', tg('shadows')) + row('Bloom', 'Glow on lights, neon and the sun.', tg('bloom')) + row('Motion blur & speed effects', '', tg('motionBlur')) + row('Show FPS', '', tg('showFps'));
    else if (T === 1) body = row('Master volume', '', sl('master', 0, 1, 0.05)) + row('Music', '', sl('music', 0, 1, 0.05)) + row('Effects', 'Tyres, wind, impacts, interface.', sl('sfx', 0, 1, 0.05)) + row('Engine', '', sl('engine', 0, 1, 0.05));
    else if (T === 2) body = row('Steering sensitivity', 'Scales keyboard / touch steering input.', sl('steerSens', 0.5, 1.5, 0.05)) + row('Stability assist', 'Counter-steers slides for you. 0 = full manual.', sl('assist', 0, 1, 0.05)) + row('Tilt steering (touch)', 'Steer by tilting your device.', tg('tilt')) + row('Touch button size', '', sl('touchSize', 0.7, 1.4, 0.05)) + `<div class="setrow"><div><div style="font-weight:800">Keyboard</div><div class="d"><kbd>W</kbd>/<kbd>↑</kbd> accelerate · <kbd>S</kbd>/<kbd>↓</kbd> brake & reverse · <kbd>A</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>Shift</kbd> nitro · <kbd>C</kbd> camera · <kbd>R</kbd> reset · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute. Gamepads are supported too.</div></div></div>`;
    else body = row('Fullscreen', 'Recommended when embedded in a page.', '<button class="btn alt sm" data-act="fullscreen">Toggle</button>') + row('Units', '', sg('units', ['kmh', 'mph'], ['km/h', 'mph'])) + row('Camera shake', '', sl('camShake', 0, 1.5, 0.1)) + row('Field of view', 'Scales the speed-sensitive FOV.', sl('fov', 0.85, 1.2, 0.01)) + row('Body motion / camera roll', '', sl('motion', 0, 1.5, 0.1)) + `<div class="setrow"><div><div style="font-weight:800">Reset progress</div><div class="d">Erase credits, cars, records and settings.</div></div><button class="btn red sm" data-act="reset-save">Reset</button></div>`;
    this.screens.settings.innerHTML = `<div class="scrim full"></div><div class="wrap"><div class="row"><button class="btn alt sm" data-act="back" autofocus>◀ Back</button><h2 class="hd"><small>Options</small>Settings</h2></div><div class="tabs" style="max-width:640px">${SETTINGS_TABS.map((t, i) => `<button class="${i === T ? 'on' : ''}" data-act="stab" data-t="${i}">${t}</button>`).join('')}</div><div class="panel" style="max-width:760px;overflow-y:auto;touch-action:pan-y;flex:1">${body}</div></div>`;
  }
}

function fmtSetting(k, v) {
  if (['master', 'music', 'sfx', 'engine'].includes(k)) return Math.round(v * 100) + '%';
  if (k === 'resScale') return Math.round(v * 100) + '%';
  if (k === 'fov') return Math.round(v * 100) + '%'; return (+v).toFixed(2).replace(/\.?0+$/, '') || '0';
}
