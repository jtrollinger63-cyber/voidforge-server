/**
 * Third-person soldier: the Toolbench rig (22 bones, 4 sockets, 53 clips) cloned per player.
 *
 * Animation strategy
 *  - Every full-body clip is split once into an UPPER-body and a LOWER-body variant (by bone name).
 *  - Locomotion plays on both halves; one-shot actions (fire / reload / hit / melee) play on the UPPER half only,
 *    so legs keep walking while the arms shoot or reload. Weights are managed manually and cross-faded.
 *  - Aim pitch is applied procedurally to Spine/Chest after the mixer.
 *  - Clip names come from the GLB; missing grip-set variants fall back to the base clip (documented in docs/ANIMATIONS.md).
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB } from '../assets/loader.ts';
import type { GripSet, WeaponId } from '../gameplay/weapons.ts';
import { WEAPONS } from '../gameplay/weapons.ts';

const WEAPONS_NOFLASH = ['knife'];
const UPPER = new Set(['Spine', 'Chest', 'Neck', 'Head', 'Shoulder_L', 'UpperArm_L', 'LowerArm_L', 'Hand_L', 'Shoulder_R', 'UpperArm_R', 'LowerArm_R', 'Hand_R']);

export interface SoldierAssets {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  clipNames: string[];
  weapons: THREE.Object3D;
}

let assetsPromise: Promise<SoldierAssets> | null = null;
export function loadSoldierAssets(): Promise<SoldierAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([loadGLB('soldier.glb'), loadGLB('weapons3p.glb')]).then(([s, w]) => {
      const clips = new Map<string, THREE.AnimationClip>();
      for (const c of s.animations) clips.set(c.name, c);
      return { scene: s.scene as THREE.Group, clips, clipNames: s.animations.map((c) => c.name), weapons: w.scene };
    });
  }
  return assetsPromise;
}

/** keep only tracks whose bone satisfies `keep` */
function splitClip(clip: THREE.AnimationClip, upper: boolean): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => UPPER.has(t.name.split('.')[0]!) === upper);
  return new THREE.AnimationClip(`${clip.name}@${upper ? 'U' : 'L'}`, clip.duration, tracks);
}

export interface SoldierViewState {
  speed: number; crouching: boolean; onGround: boolean; alive: boolean;
  weapon: WeaponId; pitch: number;
  firedAt: number; reloadAt: number; hurtAt: number; diedAt: number;
  using: 'none' | 'plant' | 'defuse';
  time: number;
}

/** grip transform measured against Socket_Hand_R (see docs/ANIMATIONS.md): rotates +Z muzzle -> +X, then shifts the grip to the origin. */
interface Grip { yaw: number; gx: number; gy: number; gz: number; scale: number; }
const GRIP: Record<string, Grip> = {
  'attacker-rifle':   { yaw: Math.PI / 2, gx: 0, gy: 0.105, gz: -0.12, scale: 1 },
  'defender-carbine': { yaw: Math.PI / 2, gx: 0, gy: 0.105, gz: -0.10, scale: 1 },
  'full-smg':         { yaw: Math.PI / 2, gx: 0, gy: 0.10, gz: -0.09, scale: 1 },
  'pump-shotgun':     { yaw: Math.PI / 2, gx: 0, gy: 0.105, gz: -0.14, scale: 1 },
  'marksman-rifle':   { yaw: Math.PI / 2, gx: 0, gy: 0.11, gz: -0.15, scale: 1 },
  'service-pistol':   { yaw: Math.PI / 2, gx: 0, gy: 0.075, gz: -0.045, scale: 1 },
  'combat-knife':     { yaw: Math.PI / 2, gx: 0, gy: 0.01, gz: 0.0, scale: 1 },
};

type ActionSet = { U: THREE.AnimationAction; L: THREE.AnimationAction; clip: THREE.AnimationClip };

export class Soldier {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly bones = new Map<string, THREE.Object3D>();
  readonly meshes: THREE.SkinnedMesh[] = [];
  private loco = new Map<string, ActionSet>();
  private oneShots = new Map<string, { act: THREE.AnimationAction; clip: THREE.AnimationClip }>();
  private weights = new Map<string, number>();
  private overlay = 0;            // current upper-body override weight
  private overlayTarget = 0;
  private overlayUntil = 0;
  private lastFired = -9; private lastReload = -9; private lastHurt = -9;
  private dead = false;
  private dieAction: THREE.AnimationAction | null = null;
  private workAction: ActionSet | null = null;
  private weaponNode: THREE.Object3D | null = null;
  private weaponKey = '';
  private team = -1;
  private assets: SoldierAssets;
  private pitchSm = 0;
  private muzzle = new THREE.Object3D();
  private fadeWork = 0;
  private flashObj: THREE.Group | null = null;
  private flashT = 0;
  private static flashMat: THREE.MeshBasicMaterial | null = null;
  private static flashGeo: THREE.PlaneGeometry | null = null;

  constructor(assets: SoldierAssets) {
    this.assets = assets;
    this.root = cloneSkinned(assets.scene) as THREE.Group;
    this.root.traverse((o) => {
      this.bones.set(o.name, o);
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) { sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = false; this.meshes.push(sm); }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    const sock = this.bones.get('Socket_Hand_R');
    sock?.add(this.muzzle);
  }

  private ensure(name: string): ActionSet | null {
    let a = this.loco.get(name);
    if (a) return a;
    const clip = this.assets.clips.get(name);
    if (!clip) return null;
    const U = this.mixer.clipAction(splitClip(clip, true)), L = this.mixer.clipAction(splitClip(clip, false));
    for (const x of [U, L]) { x.setEffectiveWeight(0); x.enabled = false; x.play(); x.enabled = false; }
    a = { U, L, clip };
    this.loco.set(name, a);
    return a;
  }

  private oneShot(name: string): { act: THREE.AnimationAction; clip: THREE.AnimationClip } | null {
    let o = this.oneShots.get(name);
    if (o) return o;
    const clip = this.assets.clips.get(name);
    if (!clip) return null;
    const up = splitClip(clip, true);
    const act = this.mixer.clipAction(up);
    act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false; act.enabled = false;
    o = { act, clip: up };
    this.oneShots.set(name, o);
    return o;
  }

  setTeamMaterials(mats: THREE.Material[] | null, team: number) {
    if (this.team === team || !mats) return;
    this.team = team;
    // the skinned meshes are in the same order as the GLB primitives (TeamColour, skin, visor, ...)
    this.meshes.forEach((m, i) => { if (mats[i]) m.material = mats[i]!; });
  }

  /** attach the correct world weapon for (weapon, team) to Socket_Hand_R */
  setWeapon(id: WeaponId, team: number) {
    const key = `${id}:${team}`;
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weaponNode) this.weaponNode.removeFromParent();
    const def = WEAPONS[id];
    const name = team === 0 ? def.model3p.vanguard : def.model3p.garrison;
    const src = this.assets.weapons.getObjectByName(name);
    const sock = this.bones.get('Socket_Hand_R');
    if (!src || !sock) { this.weaponNode = null; return; }
    const g = GRIP[name] ?? { yaw: Math.PI / 2, gx: 0, gy: 0.1, gz: -0.1, scale: 1 };
    const holder = new THREE.Group();
    const w = src.clone(true);
    w.position.set(-g.gx, -g.gy, -g.gz);
    holder.add(w);
    holder.rotation.y = g.yaw; holder.scale.setScalar(g.scale);
    w.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    sock.add(holder);
    this.weaponNode = holder;
    // muzzle flash sprite at the barrel tip (model +Z is the muzzle; bounds measured once per weapon)
    if (!Soldier.flashMat) {
      Soldier.flashMat = new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      Soldier.flashGeo = new THREE.PlaneGeometry(0.2, 0.2);
    }
    const box = new THREE.Box3().setFromObject(src);
    this.flashObj = new THREE.Group();
    for (let i = 0; i < 2; i++) { const q = new THREE.Mesh(Soldier.flashGeo!, Soldier.flashMat!); q.rotation.z = i * Math.PI / 4; this.flashObj.add(q); }
    this.flashObj.position.set(0, Math.min(box.max.y * 0.68, 0.22), box.max.z + 0.07);
    this.flashObj.visible = false; w.add(this.flashObj);
  }

  /** show the muzzle flash for a few frames */
  flash() { if (this.flashObj && WEAPONS_NOFLASH.indexOf(this.weaponKey.split(':')[0]!) < 0) { this.flashT = 0.055; this.flashObj.visible = true; this.flashObj.rotation.z = Math.random() * 6; } }
  /** world position of the barrel tip (valid after the last render) */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 { if (this.flashObj) return this.flashObj.getWorldPosition(out); return this.root.getWorldPosition(out); }

  private gripSuffix(w: WeaponId): string {
    const g: GripSet = WEAPONS[w].gripSet;
    return g === 'rifle' ? 'rifle' : g === 'sidearm' ? 'sidearm' : 'blade';
  }

  private pick(base: string, w: WeaponId): string {
    const sfx = this.gripSuffix(w);
    const specific = `${base}_${sfx}`;
    return this.assets.clips.has(specific) ? specific : base;
  }

  private target(name: string, w: number, set: Map<string, number>) { set.set(name, Math.max(set.get(name) ?? 0, w)); }

  update(dt: number, s: SoldierViewState) {
    // ---- death ----
    if (!s.alive) {
      if (!this.dead) {
        this.dead = true;
        const clip = this.assets.clips.get('die');
        if (clip) {
          for (const a of this.loco.values()) { a.U.enabled = a.L.enabled = false; }
          for (const o of this.oneShots.values()) o.act.stop();
          this.dieAction = this.mixer.clipAction(clip);
          this.dieAction.reset(); this.dieAction.setLoop(THREE.LoopOnce, 1); this.dieAction.clampWhenFinished = true; this.dieAction.setEffectiveWeight(1); this.dieAction.enabled = true; this.dieAction.play();
        }
      }
      this.mixer.update(dt);
      return;
    }
    if (this.dead) { // respawn
      this.dead = false; this.dieAction?.stop(); this.dieAction = null; this.mixer.stopAllAction();
      for (const a of this.loco.values()) { a.U.play(); a.L.play(); a.U.enabled = a.L.enabled = false; }
      this.weights.clear(); this.overlay = 0; this.overlayTarget = 0;
    }

    // ---- choose locomotion clip ----
    const moving = s.speed > 0.35;
    let base: string;
    if (!s.onGround) base = this.pick('jump', s.weapon);
    else if (s.crouching) base = this.pick('crouch', s.weapon);
    else if (!moving) base = this.pick('idle', s.weapon);
    else if (s.speed < 3.8) base = this.pick('walk', s.weapon);
    else base = this.pick('run', s.weapon);
    // plant / defuse crouch-work
    const working = s.using !== 'none' && this.assets.clips.has('work');
    if (working) base = 'work';

    const want = new Map<string, number>();
    this.target(base, 1, want);
    // fade logic
    const names = new Set([...this.weights.keys(), ...want.keys()]);
    const fade = 1 - Math.exp(-dt / 0.07);
    for (const n of names) {
      const cur = this.weights.get(n) ?? 0, tgt = want.get(n) ?? 0;
      const nw = cur + (tgt - cur) * fade;
      this.weights.set(n, nw < 0.003 && tgt === 0 ? 0 : nw);
    }
    for (const [n, w] of this.weights) {
      const set = this.ensure(n);
      if (!set) continue;
      const on = w > 0.003;
      if (on && !set.L.enabled) { set.L.enabled = set.U.enabled = true; set.L.reset(); set.U.reset(); set.L.play(); set.U.play(); }
      if (!on && set.L.enabled) { set.L.enabled = set.U.enabled = false; }
      set.L.setEffectiveWeight(w);
      // upper-body loco weight is reduced by the overlay
      set.U.setEffectiveWeight(w * (1 - this.overlay));
      const isMove = /^(walk|run|crouch)/.test(n);
      const ts = isMove && !/^crouch/.test(n) ? (n.startsWith('run') ? s.speed / 4.4 : s.speed / 1.9) : (n.startsWith('crouch') ? 1 : 1);
      set.L.setEffectiveTimeScale(Math.max(0.3, Math.min(1.6, ts))); set.U.setEffectiveTimeScale(set.L.timeScale);
    }

    // ---- one-shot upper-body overlays (fire / reload / hit / melee) ----
    const triggerOverlay = (clipName: string, dur: number) => {
      const o = this.oneShot(clipName);
      if (!o) return;
      o.act.reset(); o.act.enabled = true; o.act.setEffectiveWeight(1); o.act.setEffectiveTimeScale(Math.max(0.2, o.clip.duration / dur)); o.act.play();
      this.overlayTarget = 1; this.overlayUntil = s.time + dur;
    };
    const def = WEAPONS[s.weapon];
    if (s.hurtAt > this.lastHurt) { this.lastHurt = s.hurtAt; if (s.time - s.hurtAt < 0.3) triggerOverlay('hit', 0.45); }
    if (s.reloadAt > this.lastReload) { this.lastReload = s.reloadAt; if (s.time - s.reloadAt < 0.3 && def.slot !== 'melee') triggerOverlay(this.pick('reload', s.weapon), Math.min(def.reloadTime, 2.6)); }
    if (s.firedAt > this.lastFired) {
      this.lastFired = s.firedAt;
      if (s.time - s.firedAt < 0.3) triggerOverlay(def.slot === 'melee' ? 'melee' : this.pick('fire', s.weapon), def.slot === 'melee' ? 0.5 : 0.28);
    }
    if (s.time > this.overlayUntil) this.overlayTarget = 0;
    this.overlay += (this.overlayTarget - this.overlay) * (1 - Math.exp(-dt / (this.overlayTarget > this.overlay ? 0.035 : 0.12)));

    // one-shot actions: weight follows the overlay, auto-disable when done
    for (const o of this.oneShots.values()) {
      if (o.act.enabled) {
        o.act.setEffectiveWeight(this.overlay);
        if (!o.act.isRunning() || (o.act.time >= o.clip.duration - 1e-3 && this.overlayTarget === 0)) { if (this.overlay < 0.02) o.act.enabled = false; }
      }
    }

    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0 && this.flashObj) this.flashObj.visible = false; }
    this.mixer.update(dt);

    // ---- procedural aim pitch (after the mixer wrote the pose) ----
    this.pitchSm += (s.pitch - this.pitchSm) * (1 - Math.exp(-dt / 0.05));
    const p = THREE.MathUtils.clamp(this.pitchSm, -1.1, 1.1);
    const spine = this.bones.get('Spine'), chest = this.bones.get('Chest');
    // bones rotate about their local X; negative pitch = look down. 40 % spine / 60 % chest.
    if (spine) spine.rotateX(-p * 0.4);
    if (chest) chest.rotateX(-p * 0.6);
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
