/**
 * Game: owns the renderer stage, the map, the local session (offline practice sim) and every presentation system.
 * Presentation reads a ViewState; the simulation lives in GameSim (pure) so the same rules run on the server.
 */
import * as THREE from 'three';
import { createStage, type Stage } from '../engine/renderer.ts';
import { buildHillfront, type MapDef } from '../map/hillfront.ts';
import { buildMapView, type MapView } from '../map/mapview.ts';
import { GameSim, RULES, AIM, emptyCmd, viewAngles, type Cmd, type Mode, type SimEvent } from '../gameplay/sim.ts';
import { LocalSession, NetSession, type GameSession } from './session.ts';
import type { NetClient } from '../network/client.ts';
import { fillWithBots, makeBot, type Difficulty } from '../gameplay/bots.ts';
import { emptyView, syncFromSim, type ViewState, type ViewPlayer } from '../gameplay/view.ts';
import { WEAPONS, BUY_ITEMS, type WeaponId } from '../gameplay/weapons.ts';
import { eyeHeight, PLAYER } from '../gameplay/movement.ts';
import { Soldier, loadSoldierAssets, setSoldierShadowMode, type SoldierAssets, type SoldierViewState } from '../character/soldier.ts';
import { teamMaterials } from '../character/materials.ts';
import { Viewmodel } from '../weapons/viewmodel.ts';
import { Effects } from '../engine/effects.ts';
import { Input, type InputFrame } from '../engine/input.ts';
import { loadSettings, onSettings, type Settings } from '../engine/settings.ts';
import { QUALITY } from '../engine/quality.ts';
import { sfx } from '../audio/sfx.ts';
import { Hud } from '../ui/hud.ts';
import { Screens, renderWeaponIcons, toast } from '../ui/screens.ts';

export type GameState = 'menu' | 'playing' | 'paused' | 'result';

export interface PracticeOptions { mode: Mode; difficulty: Difficulty; side: 0 | 1 | 'random'; perTeam: number; seed?: number; }

const VIEW_CLEAR = new THREE.Color(0x000000);

export class Game {
  readonly stage: Stage;
  readonly map: MapDef;
  readonly mapView: MapView;
  private idleView: ViewState = emptyView();
  /** the active session's view (or an empty one while in the menu) */
  get view(): ViewState { return this.session ? this.session.view : this.idleView; }
  readonly hud: Hud;
  readonly screens: Screens;
  readonly input: Input;
  readonly vm: Viewmodel;
  readonly fx: Effects;
  readonly assets: SoldierAssets;
  state: GameState = 'menu';
  session: GameSession | null = null;
  /** the in-browser sim (offline practice only); null online */
  get sim(): GameSim | null { return this.session instanceof LocalSession ? this.session.sim : null; }
  onMatchEnd: ((winnerSquad: 0 | 1 | null) => void) | null = null;
  localId = -1;
  online = false;
  practice: PracticeOptions | null = null;

  private soldiers = new Map<number, Soldier>();
  private soldierGroup = new THREE.Group();
  private yaw = 0; private pitch = 0;
  private camPos = new THREE.Vector3();
  private eyeY = 1.6;
  private lastCur = 1; private prevCur = 0;
  private spectateId = -1;
  private last = performance.now();
  private frameMs = 16; private fpsEma = 60;
  private lowT = 0; private highT = 0;
  private visibleEnemies = new Set<number>(); private visAcc = 0;
  private shake = 0; private shakeT = 0;
  /** 0..1 smoothed aim-down-sights amount, bob state, smoothed view punch (degrees) */
  private aimK = 0; private aimWanted = false;
  private bobAmp = 0; private bobPhase = 0;
  private punchPs = 0; private punchYs = 0;
  private lockHint: HTMLElement; private scopeEl: HTMLElement;
  private deviceObj: THREE.Object3D | null = null; private deviceLight: THREE.Mesh | null = null; private beepT = 0;
  private resultTimer = -1;
  private menuT = 0; private menuVista = 0; private menuFade: HTMLElement;
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  private lastSlotSent = -1;
  private prevHp = 100;
  private lastVmWeapon: WeaponId | null = null; private lastVmTeam = -1;
  private lastFootstep = new Map<number, number>();
  private killedBy = '';
  onQuit: (() => void) | null = null;
  onPaused: ((p: boolean) => void) | null = null;
  /** hook for online mode: send commands / buy requests to the server instead of a local sim */
  net: { sendCmd?: (c: Cmd) => void; buy?: (id: string) => void } | null = null;

  private constructor(stage: Stage, map: MapDef, mapView: MapView, assets: SoldierAssets, canvas: HTMLCanvasElement) {
    this.stage = stage; this.map = map; this.mapView = mapView; this.assets = assets;
    stage.scene.add(mapView.group); stage.scene.add(this.soldierGroup);
    stage.staticBounds = mapView.bounds; stage.refreshStaticShadow();
    this.fx = new Effects(); stage.scene.add(this.fx.group);
    this.vm = new Viewmodel(assets.weapons);
    this.hud = new Hud(document.body, map);
    this.hud.show(false);
    this.screens = new Screens(document.body);
    this.input = new Input(canvas);
    this.menuFade = document.createElement('div');
    Object.assign(this.menuFade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', transition: 'opacity .6s', pointerEvents: 'none', zIndex: '14' });
    document.body.appendChild(this.menuFade);
    this.lockHint = document.createElement('div');
    Object.assign(this.lockHint.style, { position: 'fixed', left: '50%', top: '70px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(12,14,18,.78)', border: '1px solid rgba(255,255,255,.25)', borderRadius: '8px', color: '#fff', font: '600 13px system-ui, sans-serif', textAlign: 'center', maxWidth: '62vw', pointerEvents: 'none', zIndex: '13', display: 'none' });
    document.body.appendChild(this.lockHint);
    // scope reticle for the marksman rifle: black surround, clear circle, fine cross-hairs
    this.scopeEl = document.createElement('div');
    Object.assign(this.scopeEl.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9', display: 'none', background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 30vh, rgba(0,0,0,.96) 30.6vh)' });
    this.scopeEl.innerHTML = '<div style="position:absolute;left:50%;top:50%;width:61vh;height:1px;margin-left:-30.5vh;background:rgba(0,0,0,.85)"></div><div style="position:absolute;left:50%;top:50%;height:61vh;width:1px;margin-top:-30.5vh;background:rgba(0,0,0,.85)"></div><div style="position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px;border-radius:50%;background:#e33"></div>';
    document.body.appendChild(this.scopeEl);

    // pointer lock <-> pause
    this.input.onLockChange = (locked) => {
      // losing a lock we had (Esc / alt-tab) pauses; a browser that never grants one (embedded frames) must not pause the game forever
      if (!locked && this.state === 'playing' && !this.screens.open && !this.input.lockFailed) this.pause();
    };
    this.input.onFirstClick = () => { sfx.unlock(); if (this.state === 'playing' && !this.input.locked && !this.screens.open) this.input.requestLock(); };
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('keyup', (e) => this.onKeyUp(e));
    onSettings((s) => this.applySettings(s));
    this.applySettings(loadSettings());
    addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  /** build everything that is expensive once (map merge, soldier assets, weapon icons) */
  static async boot(canvas: HTMLCanvasElement, progress: (p: number, msg: string) => void): Promise<Game> {
    progress(0.05, 'Starting renderer');
    const settings = loadSettings();
    const stage = createStage(canvas, settings.quality);
    const map = buildHillfront();
    progress(0.15, 'Building Hill Town');
    const mapView = await buildMapView(map);
    progress(0.65, 'Loading soldiers and weapons');
    const assets = await loadSoldierAssets();
    // warm the team atlases / materials so the first spawn does not hitch
    teamMaterials(0); teamMaterials(1);
    progress(0.9, 'Preparing weapon cards');
    const g = new Game(stage, map, mapView, assets, canvas);
    g.screens.icons = renderWeaponIcons(stage.renderer, assets.weapons);
    progress(1, 'Ready');
    g.last = performance.now();
    requestAnimationFrame((t) => g.frame(t));
    return g;
  }

  // ------------------------------------------------------------------ settings / resize
  private applySettings(s: Settings) {
    if (this.stage.quality.name !== s.quality) this.stage.setQuality(s.quality);
    setSoldierShadowMode(this.stage.quality.shadows); for (const sd of this.soldiers.values()) sd.applyShadowMode(this.stage.quality.shadows);
    this.stage.dynamicScale = Math.min(this.stage.dynamicScale, s.resolutionScale); if (!s.dynamicRes) this.stage.dynamicScale = s.resolutionScale;
    this.stage.resize();
    this.fx.maxParticles = Math.min(160, QUALITY[s.quality].particles * 2);
    sfx.setVolume(s.volume, s.musicVolume);
    document.body.classList.toggle('hc-teams', s.highContrastTeams);
    this.onResize();
  }
  private onResize() {
    const s = loadSettings();
    this.stage.camera.fov = s.fov; this.stage.camera.updateProjectionMatrix();
    this.vm.resize(innerWidth / innerHeight, s.fov);
  }

  // ------------------------------------------------------------------ session control
  startPractice(opts: PracticeOptions) {
    this.stopSession();
    this.practice = opts; this.online = false;
    const sim = new GameSim({ mode: opts.mode, seed: opts.seed ?? ((Math.random() * 1e9) | 0), skipWarmup: true });
    const side = opts.side === 'random' ? (Math.random() < 0.5 ? 0 : 1) : opts.side;
    const me = sim.addPlayer(loadSettings().name || 'You', side, false);
    this.localId = me.id;
    fillWithBots(sim, opts.perTeam, opts.difficulty);
    sim.round = 0; (sim as unknown as { beginRound(): void }).beginRound();
    this.session = new LocalSession(sim, me.id);
    this.beginPlaying();
    this.hud.banner('Hillfront', `${opts.perTeam}v${opts.perTeam} ${opts.mode} practice · ${opts.difficulty} bots`, 2600, '#e9b872');
  }

  /** an authoritative online match (server owns the simulation; we render snapshots + predict our own movement) */
  startOnline(net: NetClient, start: { you: number; squad: 0 | 1; mode: Mode }) {
    this.stopSession();
    this.practice = null; this.online = true; this.localId = start.you;
    this.session = new NetSession(net, start.you, this.map.world, start.mode, start.squad);
    this.net = { sendCmd: undefined, buy: undefined };
    this.beginPlaying();
    this.hud.banner('Online match', `${start.mode} · you are on ${start.squad === 0 ? 'Squad 1' : 'Squad 2'}`, 2600, '#e9b872');
  }
  /** the server told us the match is over */
  netMatchEnded(winnerSquad: 0 | 1 | null) {
    if (!this.online || (this.state !== 'playing' && this.state !== 'paused')) return;
    this.view.matchWinnerSquad = winnerSquad;
    this.state = 'result'; this.input.exitLock(); this.screens.close();
    const me = this.view.players.get(this.localId);
    this.screens.result(this.view, me?.squad ?? 0, { menu: () => { this.quitToMenu(); this.onMatchEnd?.(winnerSquad); }, party: () => { this.quitToMenu(); this.onMatchEnd?.(winnerSquad); } });
  }

  private beginPlaying() {
    this.state = 'playing'; this.resultTimer = -1;
    this.screens.close();
    document.getElementById('menu')?.classList.add('hidden');
    this.hud.show(true);
    this.view.players.clear();
    this.fx.clearDecals();
    for (const s of this.soldiers.values()) { s.root.removeFromParent(); s.dispose(); }
    this.soldiers.clear();
    this.spectateId = -1; this.lastVmWeapon = null; this.prevHp = 100;
    sfx.unlock(); sfx.stopMusic(); sfx.startAmbience();
    this.input.enabled = true; this.input.clearAll();
    if (this.session) { this.session.sync(); const me = this.view.players.get(this.localId); if (me) { this.yaw = me.yaw; this.pitch = 0; this.eyeY = me.y + eyeHeight({ crouching: me.crouching } as never); } }
    this.input.requestLock();
  }

  stopSession() {
    this.session?.leave?.(); this.session?.dispose(); this.session = null; this.localId = -1; this.practice = null; this.online = false; this.net = null;
    for (const s of this.soldiers.values()) { s.root.removeFromParent(); s.dispose(); }
    this.soldiers.clear();
    if (this.deviceObj) { this.deviceObj.removeFromParent(); this.deviceObj = null; }
    this.hud.show(false); this.screens.close(); this.input.exitLock();
    sfx.stopAmbience();
  }

  quitToMenu() {
    this.stopSession(); this.state = 'menu';
    document.getElementById('menu')?.classList.remove('hidden');
    sfx.startMusic();
    this.onQuit?.();
  }

  restartPractice() { if (this.practice) this.startPractice(this.practice); }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.input.exitLock(); this.input.clearAll();
    this.screens.pause({
      online: this.online,
      onResume: () => this.resume(),
      onSettings: () => this.screens.settings((s) => this.applySettings(s), () => this.pause()),
      onQuit: () => this.quitToMenu(),
      onRestart: () => this.restartPractice(),
    });
    this.onPaused?.(true);
  }
  resume() { if (this.state !== 'paused') return; this.screens.close(); this.state = 'playing'; this.input.clearAll(); this.input.requestLock(); this.onPaused?.(false); }

  // ------------------------------------------------------------------ keys
  private onKey(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      if (this.state === 'playing') { if (this.screens.open === 'buy') this.screens.close(); else this.pause(); }
      else if (this.state === 'paused' && this.screens.open === 'pause') this.resume();
      return;
    }
    if (this.state === 'playing' && this.screens.open === 'buy' && /^Digit[1-9]$/.test(e.code)) {
      const me = this.view.players.get(this.localId); if (!me) return;
      const items = BUY_ITEMS.filter((i) => !i.team || (i.team === 'vanguard') === (me.team === 0));
      const it = items[Number(e.code.slice(5)) - 1];
      if (it) { this.doBuy(it.id); this.openBuy(true); }
    }
  }
  private onKeyUp(_e: KeyboardEvent) { /* reserved */ }

  private doBuy(id: string): { ok: boolean; reason?: string } {
    if (!this.session) return { ok: false, reason: 'no match' };
    const r = this.session.buy(id);
    if (r.ok) sfx.buy(); else { sfx.uiError(); toast(r.reason ?? 'Cannot buy'); }
    return r;
  }
  private openBuy(refresh = false) {
    const me = this.view.players.get(this.localId); if (!me || !this.session) return;
    if (this.screens.open === 'buy' && !refresh) { this.screens.close(); return; }
    if (!me.alive) return;
    this.session.sync();
    this.screens.buy(this.view, this.view.players.get(this.localId)!, (id) => this.doBuy(id), () => !!this.session && this.session.canBuy());
  }

  // ------------------------------------------------------------------ main loop
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = (now - this.last) / 1000; this.last = now;
    const dt = Math.min(0.1, Math.max(0.0005, rawDt));
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.08; this.fpsEma += (1 / Math.max(0.001, rawDt) - this.fpsEma) * 0.08;
    this.stage.renderer.info.reset();

    if (this.state === 'menu') { this.menuFrame(dt); this.render(false); return; }

    const session = this.session;
    if (session) {
      const live = this.state !== 'result' && this.state !== 'paused';
      let f: InputFrame | null = null;
      if (live) { f = this.input.enabled ? this.input.poll(dt, this.lookScale()) : null; this.control(dt, f); } else this.input.poll(dt);
      // offline practice pauses with the menu; an online match keeps running (and keeps streaming neutral input)
      if (!live && this.online) session.setCmd(emptyCmd());
      session.advance(dt, !live && !this.online);
      this.handleEvents(session.drainEvents());
      session.sync();
    }
    this.updateDynamicRes(rawDt);
    this.tickResult(dt);
    this.updatePresentation(dt);
    this.render(true);
  }

  // ------------------------------------------------------------------ local control
  private control(dt: number, f: InputFrame | null) {
    const session = this.session!; const p = this.view.players.get(this.localId); if (!p) return;
    const blocked = !!this.screens.open && this.screens.open !== 'score';
    if (f) {
      if (!blocked || this.screens.open === 'buy') {
        const st = loadSettings();
        this.yaw -= f.lookX; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - f.lookY));
        if (f.buyPressed) this.openBuy();
        if (f.scoreboard && !this.screens.open) this.screens.scoreboard(this.view, this.localId);
        else if (!f.scoreboard && this.screens.isScoreboardOpen()) this.screens.close();
        void st;
      }
      if (this.screens.isScoreboardOpen() && performance.now() - this.sbT > 250) { this.sbT = performance.now(); this.screens.scoreboard(this.view, this.localId); }
    }
    if (!p.alive) {
      if (f?.spectateNext || (f && this.input.primaryHeld && this.spectateEdge())) this.cycleSpectate();
      session.setCmd(emptyCmd()); return;
    }
    const cmd: Cmd = emptyCmd();
    if (f && (!blocked || this.screens.open === 'buy')) {
      cmd.fwd = f.fwd; cmd.strafe = f.strafe; cmd.jump = f.jump; cmd.crouch = f.crouch; cmd.walk = f.walk;
      cmd.fire = f.fire && !blocked; cmd.reload = f.reload; cmd.use = f.use;
      // aim-down-sights is not available while reloading / equipping / planting, and not with the knife
      this.aimWanted = f.aim && !blocked && WEAPONS[p.weapon].slot !== 'melee' && !p.reloading && p.equipT <= 0 && p.using === 'none';
      cmd.aim = this.aimWanted;
      // weapon selection
      let slot = f.slot;
      if (f.wheel !== 0) { const order = [0, 1, 2].filter((i) => p.slots[i]); const idx = order.indexOf(p.cur); slot = order[(idx + (f.wheel > 0 ? 1 : -1) + order.length) % order.length]!; }
      if (slot === 9) slot = this.prevCur;
      if (slot >= 0 && p.slots[slot] && slot !== p.cur) { this.prevCur = p.cur; cmd.slot = slot; }
      if (f.inspect) this.vm.inspect();
    }
    if (!f || blocked) this.aimWanted = false;
    cmd.yaw = this.yaw; cmd.pitch = this.pitch;
    session.setCmd(cmd);
    void dt;
  }
  private sbT = 0;
  private specEdge = false;
  private spectateEdge(): boolean { const held = this.input.primaryHeld; const edge = held && !this.specEdge; this.specEdge = held; return edge; }
  private cycleSpectate() {
    const me = this.view.players.get(this.localId); if (!me) return;
    const mates = [...this.view.players.values()].filter((p) => p.alive && p.team === me.team && p.id !== me.id);
    const pool = mates.length ? mates : [...this.view.players.values()].filter((p) => p.alive);
    if (!pool.length) return;
    const idx = pool.findIndex((p) => p.id === this.spectateId);
    this.spectateId = pool[(idx + 1) % pool.length]!.id;
  }

  // ------------------------------------------------------------------ events -> effects / audio / hud
  private listener(): { pos: THREE.Vector3; right: THREE.Vector3 } {
    const c = this.stage.camera; c.updateMatrixWorld();
    return { pos: c.position, right: this.tmp2.set(1, 0, 0).applyQuaternion(c.quaternion) };
  }
  private audioFor(x: number, y: number, z: number): { dist: number; pan: number } {
    const L = this.listener(); const dx = x - L.pos.x, dy = y - L.pos.y, dz = z - L.pos.z; const dist = Math.hypot(dx, dy, dz);
    const pan = dist > 0.5 ? (dx * L.right.x + dy * L.right.y + dz * L.right.z) / dist : 0;
    return { dist, pan };
  }

  private handleEvents(events: SimEvent[]) {
    const V = this.view; const lid = this.localId;
    const pl = (id: number) => this.view.players.get(id) ?? this.cache.get(id);
    for (const e of events) {
      switch (e.t) {
        case 'shot': {
          const shooter = pl(e.id); if (!shooter) break;
          const local = e.id === lid;
          const a = this.audioFor(e.ox, e.oy, e.oz);
          sfx.shot(e.w, a.dist, a.pan, local);
          let sx = e.ox, sy = e.oy, sz = e.oz;
          if (local) {
            // viewmodel muzzle -> world
            const cam = this.stage.camera; const m = this.tmp.copy(this.vm.muzzleVm).applyMatrix4(cam.matrixWorld);
            sx = m.x; sy = m.y; sz = m.z;
          } else {
            const s = this.soldiers.get(e.id); if (s) { s.flash(); const mw = s.muzzleWorld(this.tmp); sx = mw.x; sy = mw.y; sz = mw.z; }
          }
          if (e.w !== 'knife') {
            if (e.hit !== 'none' || true) this.fx.tracer(sx, sy, sz, e.hx, e.hy, e.hz);
            this.fx.muzzleSmoke(sx + e.dx * 0.2, sy + e.dy * 0.2, sz + e.dz * 0.2, e.dx, e.dy, e.dz);
          }
          if (e.hit === 'world') { this.fx.impact(e.hx, e.hy, e.hz, e.nx, e.ny, e.nz, 'world'); const b = this.audioFor(e.hx, e.hy, e.hz); sfx.impact(b.dist, b.pan, 'world'); }
          else if (e.hit === 'player') { this.fx.impact(e.hx, e.hy, e.hz, e.nx, e.ny, e.nz, 'player'); }
          break;
        }
        case 'hit': {
          const victim = pl(e.v);
          if (e.a === lid && e.v !== lid) { this.hud.hitMarker(e.killed ? 'kill' : e.head ? 'head' : 'body'); sfx.hitMarker(e.head, e.killed); }
          if (e.v === lid) {
            sfx.hurt(e.dmg > 25); this.shake = Math.min(1, this.shake + Math.min(0.5, e.dmg * 0.01));
            const att = e.a >= 0 ? pl(e.a) : null;
            if (att && victim) {
              const ang = Math.atan2(-(att.x - victim.x), -(att.z - victim.z)); // world heading to attacker
              this.hud.damageFrom(this.yaw - ang + Math.PI);
            }
          }
          break;
        }
        case 'kill': {
          const a = V.players.get(e.a) ?? (e.a >= 0 ? this.cachedPlayer(e.a) : undefined), v = V.players.get(e.v) ?? this.cachedPlayer(e.v);
          this.hud.killFeed(a, v, e.w, e.head, lid);
          if (e.v === lid) { const k = e.a >= 0 ? pl(e.a) : null; this.killedBy = k?.name ?? ''; this.spectateId = -1; if (k) this.hud.toast(`Eliminated by ${k.name}`, 3000); }
          break;
        }
        case 'reload': { const p = pl(e.id); if (p) { const a = this.audioFor(p.x, p.y + 1, p.z); sfx.reload(a.dist, a.pan, p.weapon); } break; }
        case 'equip': { const p = pl(e.id); if (p) { const a = this.audioFor(p.x, p.y + 1, p.z); sfx.equip(a.dist, a.pan); } break; }
        case 'dry': if (e.id === lid) sfx.empty(); break;
        case 'phase': this.onPhase(e.phase, e.round); break;
        case 'roundEnd': {
          const me = pl(lid); const won = me ? e.winner === me.team : false;
          sfx.roundEnd(won);
          const names = ['Vanguard', 'Garrison'];
          this.hud.banner(e.winner === null ? 'Draw' : `${names[e.winner]} win the round`, e.reason, 4200, e.winner === 0 ? '#e0702b' : '#3f8fd8');
          break;
        }
        case 'plantStart': if (e.id === lid) sfx.plantStart(); break;
        case 'planted': { sfx.planted(); this.hud.banner(`Device planted · site ${e.site}`, 'Garrison: disarm it before the timer ends', 3400, '#ff6a4d'); this.spawnDevice(); break; }
        case 'defused': { sfx.defused(); this.hud.banner('Device disarmed', '', 3000, '#7dff9b'); break; }
        case 'exploded': {
          const b = this.view.bomb; const a = this.audioFor(b.x, b.y, b.z); sfx.explosion(a.dist); this.fx.explosion(b.x, b.y, b.z); this.shake = Math.min(1, 0.4 + Math.max(0, 1 - a.dist / 60));
          if (this.deviceObj) { this.deviceObj.visible = false; } break;
        }
        case 'deviceDropped': this.hud.toast('The device was dropped'); break;
        case 'devicePicked': if (e.id === lid) this.hud.toast('You picked up the device'); break;
        case 'matchEnd': { if (!this.online) this.resultTimer = 3.2; break; }
        case 'sides': this.hud.banner('Sides swap', 'Half time', 3000, '#e9b872'); break;
        default: break;
      }
    }
  }
  private cache = new Map<number, ViewPlayer>();
  private cachedPlayer(id: number): ViewPlayer | undefined { return this.cache.get(id) ?? this.view.players.get(id); }

  private onPhase(phase: string, round: number) {
    const me = this.view.players.get(this.localId);
    if (phase === 'freeze') {
      this.fx.clearDecals(); if (this.deviceObj) { this.deviceObj.visible = false; }
      if (me) { this.yaw = me.yaw; this.pitch = 0; }
      this.spectateId = -1; this.screens.close();
      const hasDev = me?.hasDevice ? 'You carry the device — plant it at site A or B' : me?.team === 0 ? 'Escort the device carrier to a site' : 'Hold both sites. Disarm the device if it is planted';
      this.hud.banner(`Round ${round}`, hasDev, 3800, '#e9b872');
      if (round > 1) sfx.roundStart();
      if (me?.alive) setTimeout(() => this.hud.toast(`Press ${loadSettings().keys.buy!.replace('Key', '')} to open the quartermaster`, 3500), 800);
    } else if (phase === 'live') { this.hud.banner('Go', '', 900, '#ffffff'); sfx.roundStart(); }
    else if (phase === 'warmup') this.hud.banner('Warm-up', '', 2000);
  }

  private tickResult(dt: number) {
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.resultTimer = -1; this.state = 'result'; this.input.exitLock();
        const me = this.view.players.get(this.localId);
        this.screens.result(this.view, me?.squad ?? 0, { again: this.practice ? () => this.restartPractice() : undefined, menu: () => this.quitToMenu() });
      }
    }
  }

  // ------------------------------------------------------------------ objective visuals
  private spawnDevice() {
    if (!this.deviceObj) {
      const p = this.mapView.piece('objective-device');
      const g = new THREE.Group();
      if (p) { g.add(p); p.scale.setScalar(1.6); }
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false }));
      led.position.set(0, 0.34, 0); g.add(led); this.deviceLight = led;
      this.stage.scene.add(g); this.deviceObj = g;
    }
    const b = this.view.bomb; this.deviceObj.position.set(b.x, b.y, b.z); this.deviceObj.visible = true;
  }

  private updateDevice(dt: number) {
    const b = this.view.bomb;
    if ((b.state === 'planted' || b.state === 'dropped') && !(this.deviceObj?.visible)) this.spawnDevice();
    if (this.deviceObj) {
      if (b.state === 'planted' || b.state === 'dropped') { this.deviceObj.visible = true; this.deviceObj.position.set(b.x, b.y, b.z); }
      else if (b.state !== 'exploded') this.deviceObj.visible = false;
    }
    if (b.state === 'planted' && this.deviceLight) {
      const rate = b.timeLeft > 10 ? 1.0 : b.timeLeft > 5 ? 0.5 : 0.22;
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = rate; const a = this.audioFor(b.x, b.y, b.z); if (a.dist < 60) sfx.beep(b.timeLeft > 5 ? 1000 : 1400, Math.max(0.15, 0.7 - a.dist / 90));
        (this.deviceLight.material as THREE.MeshBasicMaterial).color.setHex(0xffffff); setTimeout(() => (this.deviceLight!.material as THREE.MeshBasicMaterial).color.setHex(0xff2a1a), 90);
      }
    }
  }

  // ------------------------------------------------------------------ aim down sights
  /** current magnification of the camera (1 = hip) */
  private zoomNow(): number {
    const me = this.view.players.get(this.localId); if (!me || !me.alive) return 1;
    return 1 + (WEAPONS[me.weapon].zoom - 1) * this.aimK;
  }
  /** mouse-look scale: turning slows in proportion to the zoom so a scoped crosshair is as controllable as a hip one */
  private lookScale(): number { return 1 / this.zoomNow(); }

  // ------------------------------------------------------------------ presentation
  private spreadDeg(me: ViewPlayer): number {
    const d = WEAPONS[me.weapon]; if (d.slot === 'melee') return 0;
    const mf = Math.min(1, me.speed / PLAYER.runSpeed);
    let s = d.spreadBase + d.spreadMove * mf * mf + (me.onGround ? 0 : d.spreadJump); if (me.crouching) s *= d.crouchMul;
    s *= 1 + Math.min(me.spray, 12) * 0.035;
    return this.aimK > 0.01 ? s * (1 - (1 - AIM.spreadMul) * this.aimK) : s;
  }

  private updatePresentation(dt: number) {
    const V = this.view; const me = V.players.get(this.localId);
    for (const p of V.players.values()) this.cache.set(p.id, { ...p });
    // spectate target
    let spec: ViewPlayer | null = null;
    if (me && !me.alive && V.phase !== 'matchEnd') {
      let t = this.spectateId >= 0 ? V.players.get(this.spectateId) : undefined;
      if (!t || !t.alive) { this.spectateId = -1; this.cycleSpectate(); t = this.spectateId >= 0 ? V.players.get(this.spectateId) : undefined; }
      spec = t && t.alive ? t : null;
    }
    const focus = spec ?? (me && me.alive ? me : null);

    // ---- camera
    const cam = this.stage.camera, s = loadSettings();
    if (focus) {
      const eye = eyeHeight({ crouching: focus.crouching } as any);
      const target = focus.y + eye;
      this.eyeY += (target - this.eyeY) * Math.min(1, dt * 14); if (Math.abs(target - this.eyeY) > 1.2) this.eyeY = target;
      let yaw = spec ? spec.yaw : this.yaw, pitch = spec ? spec.pitch : this.pitch;
      if (focus === me) {
        // the sim's view punch arrives in 60 Hz steps (one per shot): ease the camera toward it so each shot is a kick, not a jolt
        const kp = 1 - Math.exp(-dt / 0.035);
        this.punchPs += (me.punchP - this.punchPs) * kp; this.punchYs += (me.punchY - this.punchYs) * kp;
        const va = viewAngles(yaw, pitch, this.punchYs, this.punchPs);       // same function the sim aims bullets with => crosshair = where shots go
        yaw = va.yaw; pitch = va.pitch;
      }
      this.camPos.set(focus.x, this.eyeY, focus.z);
      // head bob: phase advances with distance travelled, amplitude eases in/out (no sudden jumps), kept very small
      const bobTarget = !s.reduceMotion && focus.onGround && !focus.crouching ? Math.min(1, focus.speed / 5.2) : 0;
      this.bobAmp += (bobTarget - this.bobAmp) * (1 - Math.exp(-dt / 0.12));
      this.bobPhase += dt * focus.speed * 1.9;
      const bob = Math.sin(this.bobPhase) * 0.0055 * this.bobAmp * (1 - 0.7 * this.aimK);
      cam.position.set(this.camPos.x, this.camPos.y + bob, this.camPos.z);
      cam.rotation.order = 'YXZ';
      // shake (explosions, taking damage): smooth low-frequency motion, small, decays fast — never random per-frame noise
      this.shake = Math.max(0, this.shake - dt * 2.6);
      this.shakeT += dt;
      const sh = s.reduceMotion ? 0 : this.shake * this.shake;
      const t = this.shakeT;
      cam.rotation.set(pitch + Math.sin(t * 23.0) * sh * 0.012, yaw + Math.sin(t * 19.0 + 1.7) * sh * 0.012, Math.sin(t * 15.0 + 0.6) * sh * 0.01);
    } else if (me && !me.alive) {
      // death cam: slow orbit over the spot we fell
      const t = performance.now() * 0.0002;
      cam.position.set(me.x + Math.cos(t) * 3.2, me.y + 2.4, me.z + Math.sin(t) * 3.2); cam.lookAt(me.x, me.y + 0.6, me.z);
    }
    // aim-down-sights: ease toward the target, then zoom the camera (viewmodel keeps its own fixed FOV)
    const aimGoal = this.aimWanted && me && me.alive && !spec ? 1 : 0;
    this.aimK += (aimGoal - this.aimK) * (1 - Math.exp(-dt / (aimGoal ? 0.07 : 0.05)));
    if (Math.abs(this.aimK - aimGoal) < 0.002) this.aimK = aimGoal;
    {
      const z = this.zoomNow(); const f0 = s.fov, fz = (2 * Math.atan(Math.tan(f0 * Math.PI / 360) / z)) * 180 / Math.PI;
      if (Math.abs(cam.fov - fz) > 0.01) { cam.fov = fz; cam.updateProjectionMatrix(); }
      const sc = me && me.alive && !spec && WEAPONS[me.weapon].scoped && this.aimK > 0.92;
      this.scopeEl.style.display = sc ? 'block' : 'none';
    }
    // pointer-lock hint (shown whenever mouse capture is not active during play)
    {
      const show = this.state === 'playing' && !this.input.locked && !this.screens.open;
      this.lockHint.style.display = show ? 'block' : 'none';
      if (show) this.lockHint.textContent = this.input.steerWaiting ? 'Mouse capture is blocked in this window. Put the cursor in the middle of the screen, then nudge it toward an edge to turn (arrow keys also turn). Open the game in its own browser tab for full mouse-look.' : this.input.steering ? 'Mouse capture is blocked in this window: the cursor steers the view (middle = still). Open the game in its own browser tab for full mouse-look.' : 'Click the game to capture the mouse and aim';
    }
    this.stage.followShadow(cam.position.x, 0, cam.position.z);
    cam.updateMatrixWorld();

    // ---- viewmodel
    const showVm = !!me && me.alive && !spec && V.phase !== 'matchEnd';
    if (me && showVm) {
      const team = me.team as 0 | 1;
      if (this.lastVmWeapon !== me.weapon || this.lastVmTeam !== team) { this.vm.setWeapon(me.weapon, team, s.fov); this.lastVmWeapon = me.weapon; this.lastVmTeam = team; this.vm.resize(innerWidth / innerHeight, s.fov); }
      this.vm.update(dt, { alive: me.alive, weapon: me.weapon, speed: me.speed, onGround: me.onGround, crouching: me.crouching, firedAt: me.firedAt, reloadAt: me.reloadAt, reloading: me.reloading, reloadT: me.reloadT, equipT: me.equipT, time: V.time, turnX: 0, turnY: 0, reduceMotion: s.reduceMotion, dt, aim: this.aimK });
    }

    // ---- soldiers
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm);
    for (const p of V.players.values()) {
      let sd = this.soldiers.get(p.id);
      if (!sd) { sd = new Soldier(this.assets); sd.setTeamMaterials(teamMaterials(p.team as 0 | 1), p.team); sd.setWeapon(p.weapon, p.team); this.soldierGroup.add(sd.root); this.soldiers.set(p.id, sd); }
      sd.setTeamMaterials(teamMaterials(p.team as 0 | 1), p.team); sd.setWeapon(p.weapon, p.team);
      const hide = p.id === this.localId && p.alive && !spec || (spec && p.id === spec.id);
      sd.root.visible = !hide;
      sd.root.position.set(p.x, p.y, p.z); sd.root.rotation.y = p.yaw + Math.PI;
      if (hide) continue;
      // animation LOD: far or off-screen soldiers keep their pose
      this.sphere.center.set(p.x, p.y + 0.9, p.z); this.sphere.radius = 1.4;
      const dist = cam.position.distanceTo(this.sphere.center);
      const vis = this.frustum.intersectsSphere(this.sphere);
      if (!vis && dist > 8) continue;
      const st: SoldierViewState = { speed: p.speed, crouching: p.crouching, onGround: p.onGround, alive: p.alive, weapon: p.weapon, pitch: p.pitch, firedAt: p.firedAt, reloadAt: p.reloadAt, hurtAt: p.hurtAt, diedAt: p.diedAt, using: p.using, time: V.time };
      sd.update(dt * (dist > 40 ? 1 : 1), st);
      // footsteps
      if (p.alive && p.onGround && p.speed > 3.6 && p.id !== this.localId) { this.footstep(p, dist); }
    }
    // remove soldiers of departed players
    for (const [id, sd] of this.soldiers) if (!V.players.has(id)) { sd.root.removeFromParent(); sd.dispose(); this.soldiers.delete(id); }

    // local footsteps
    if (me && me.alive && me.onGround && me.speed > 3.6 && !(this.input.isDown(loadSettings().keys.walk!)) && !me.crouching) this.footstep(me, 0);

    // ---- visible enemies for the minimap (every 0.2 s)
    this.visAcc += dt;
    if (this.visAcc > 0.2 && focus && this.session) {
      this.visAcc = 0; this.visibleEnemies.clear();
      const mates = [...V.players.values()].filter((p) => p.alive && p.team === focus.team);
      for (const e of V.players.values()) {
        if (!e.alive || e.team === focus.team) continue;
        for (const m of mates) { if (Math.hypot(m.x - e.x, m.z - e.z) < 70 && this.session.world.clearLine(m.x, m.y + 1.5, m.z, e.x, e.y + 1.2, e.z)) { this.visibleEnemies.add(e.id); break; } }
      }
    }

    this.fx.update(dt, cam);
    this.updateDevice(dt);

    // ---- hud
    const fp = me && me.alive ? me : null;
    this.hud.update(dt, V, me ?? null, {
      camera: cam, spectating: spec, prompt: this.promptFor(me), progress: this.progressFor(me), spread: fp ? this.spreadDeg(fp) : 0,
      visibleEnemies: this.visibleEnemies, fps: this.fpsEma, frameMs: this.frameMs, drawCalls: this.stage.renderer.info.render.calls, tris: this.stage.renderer.info.render.triangles, scale: this.stage.dynamicScale * this.stage.quality.renderScale,
    });
    // hit-flash on own damage
    if (me) { this.prevHp = me.hp; }
  }

  private footstep(p: ViewPlayer, dist: number) {
    const key = p.id; const last = this.lastFootstep.get(key) ?? 0; const now = performance.now();
    const interval = 330 / Math.max(0.6, p.speed / 5.2) * (p.speed > 4.6 ? 1 : 1.35);
    if (now - last < interval) return; this.lastFootstep.set(key, now);
    const a = this.audioFor(p.x, p.y + 0.5, p.z); sfx.step(p.id, p.id === this.localId ? 4 : a.dist, p.id === this.localId ? 0 : a.pan, Math.min(1, p.speed / 5.2), p.crouching);
    void dist;
  }

  private promptFor(me: ViewPlayer | undefined): string {
    if (!me || !me.alive || this.view.mode !== 'objective' || this.view.phase !== 'live') return '';
    const b = this.view.bomb;
    if (me.team === 0) {
      if (me.using === 'plant') return 'Planting…';
      if (me.hasDevice) { const site = this.map.sites.find((s) => Math.hypot(me.x - s.x, me.z - s.z) <= s.radius); return site ? `Hold to plant at site ${site.id}` : 'Carry the device to site A or B'; }
      if (b.state === 'dropped' && Math.hypot(me.x - b.x, me.z - b.z) < 12) return 'Walk over the device to pick it up';
    } else if (b.state === 'planted') {
      if (me.using === 'defuse') return 'Disarming…';
      if (Math.hypot(me.x - b.x, me.z - b.z) < 2.0) return me.kit ? 'Hold to disarm (kit: faster)' : 'Hold to disarm';
    }
    return '';
  }
  private progressFor(me: ViewPlayer | undefined): number | null {
    if (!me || me.using === 'none') return null;
    return Math.min(1, me.useT / (me.using === 'plant' ? RULES.plantTime : me.kit ? RULES.defuseTimeKit : RULES.defuseTime));
  }

  // ------------------------------------------------------------------ menu backdrop
  private menuFrame(dt: number) {
    this.menuT += dt;
    const vistas = this.map.vistas; const v = vistas[this.menuVista % vistas.length]!;
    const t = this.menuT * 0.06;
    const cam = this.stage.camera;
    cam.position.set(v.pos[0] + Math.sin(t) * 1.2, v.pos[1] + 0.25 + Math.sin(t * 1.7) * 0.15, v.pos[2] + Math.cos(t * 0.8) * 0.8);
    cam.lookAt(v.look[0] + Math.sin(t * 0.7) * 0.6, v.look[1], v.look[2]);
    this.stage.followShadow(v.look[0], 0, v.look[2]);
    if (this.menuT > 12) { this.menuFade.style.opacity = '1'; if (this.menuT > 12.7) { this.menuT = 0; this.menuVista++; this.menuFade.style.opacity = '0'; } }
    this.fx.update(dt, cam);
  }
  get currentVistaName(): string { return this.map.vistas[this.menuVista % this.map.vistas.length]!.name; }

  // ------------------------------------------------------------------ dynamic resolution
  private updateDynamicRes(rawDt: number) {
    const s = loadSettings(); if (!s.dynamicRes || this.state !== 'playing') return;
    const ms = rawDt * 1000;
    if (ms > 24) { this.lowT += rawDt; this.highT = 0; } else if (ms < 15) { this.highT += rawDt; this.lowT = 0; } else { this.lowT = this.highT = 0; }
    if (this.lowT > 1.2 && this.stage.dynamicScale > 0.55) { this.stage.dynamicScale = Math.max(0.55, this.stage.dynamicScale - 0.07); this.stage.resize(); this.lowT = 0; }
    else if (this.highT > 5 && this.stage.dynamicScale < s.resolutionScale) { this.stage.dynamicScale = Math.min(s.resolutionScale, this.stage.dynamicScale + 0.05); this.stage.resize(); this.highT = 0; }
  }

  // ------------------------------------------------------------------ render
  private render(withVm: boolean) {
    const r = this.stage.renderer;
    r.info.autoReset = false;
    r.autoClear = false; r.clear();
    r.render(this.stage.scene, this.stage.camera);
    const me = this.view.players.get(this.localId);
    if (withVm && me && me.alive && this.state !== 'result' && !(this.spectateId >= 0)) { r.clearDepth(); r.render(this.vm.scene, this.vm.camera); }
    void VIEW_CLEAR;
  }
}
