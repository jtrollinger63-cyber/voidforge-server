/**
 * First-person viewmodel.
 *
 * *** PROVISIONAL ***  The licensed CuiGames animated viewmodels (A5 Carbine, P50, T12) were not obtainable from the
 * build sandbox (see assets/inbox/README.md). Until they are imported this class renders the CC0 Hill Town weapon models
 * with procedurally posed gloved hands. The public surface (setWeapon / update / events / muzzle) is what a
 * GLB-clip-driven implementation will also provide, so the swap does not touch game code.
 *
 * Hands are placed from the SAME hold table the third-person soldier uses (holds.ts): the firing hand's palm sits on the pistol grip,
 * the support hand cups the handguard / forend, both measured in weapon-model space and carried through the animated rig every frame.
 *
 * Rendered in its own pass with a cleared depth buffer so the gun never clips into walls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WEAPONS, type WeaponId } from '../gameplay/weapons.ts';
import { HOLDS, DEFAULT_HOLD, guardParts, type Hold } from './holds.ts';
import { FILLERS, fillerGeometries, fillerMaterial } from './fillers.ts';

/** where the GRIP point of the weapon sits in view space (camera at the origin looking down -Z), plus recoil character */
interface FpPose {
  at: [number, number, number]; rot: [number, number, number]; scale: number;
  kickBack: number; kickUp: number; kickRot: number;
}
const POSES: Record<WeaponId, FpPose> = {
  a5:    { at: [0.18, -0.18, -0.33], rot: [0.01, 0.085, 0], scale: 0.92, kickBack: 0.04, kickUp: 0.02, kickRot: 0.05 },
  m9:    { at: [0.19, -0.18, -0.33], rot: [0.01, 0.085, 0], scale: 1.0, kickBack: 0.03, kickUp: 0.014, kickRot: 0.035 },
  t12:   { at: [0.19, -0.183, -0.34], rot: [0.01, 0.085, 0], scale: 0.88, kickBack: 0.07, kickUp: 0.035, kickRot: 0.085 },
  r7:    { at: [0.19, -0.188, -0.35], rot: [0.01, 0.085, 0], scale: 0.84, kickBack: 0.06, kickUp: 0.032, kickRot: 0.075 },
  p50:   { at: [0.105, -0.145, -0.36], rot: [0.07, 0.05, 0], scale: 1.2, kickBack: 0.04, kickUp: 0.03, kickRot: 0.1 },
  knife: { at: [0.15, -0.16, -0.36], rot: [0.55, 0.15, -0.5], scale: 1.2, kickBack: 0, kickUp: 0, kickRot: 0 },
};

export interface VmState {
  alive: boolean; weapon: WeaponId; speed: number; onGround: boolean; crouching: boolean;
  firedAt: number; reloadAt: number; reloading: boolean; reloadT: number; equipT: number; time: number;
  turnX: number; turnY: number; reduceMotion: boolean; dt: number;
  /** 0..1 aim-down-sights amount (eased by the caller) */
  aim: number;
}

interface Brass { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; }

// ---------------------------------------------------------------------------------------------------------------------------
//  gloved hands
// ---------------------------------------------------------------------------------------------------------------------------
type HandKind = 'fire' | 'cup' | 'pistolL' | 'knife';
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function seg(mat: THREE.Material, a: [number, number, number], b: [number, number, number], r: number): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 3, 7), mat);
  m.position.copy(va).lerp(vb, 0.5); m.quaternion.setFromUnitVectors(Y_AXIS, vb.sub(va).normalize()); m.frustumCulled = false; return m;
}
function block(mat: THREE.Material, w: number, h: number, d: number, at: [number, number, number], r = 0.011): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat); m.position.set(...at); m.frustumCulled = false; return m;
}

/** Built in the WEAPON frame (+X = gun's left, +Y up, +Z muzzle), real metres, origin = the hold point the hand is placed on. */
function buildHand(kind: HandKind, glove: THREE.Material): { group: THREE.Group; wrist: THREE.Vector3 } {
  const g = new THREE.Group(); const R = 0.0095;
  if (kind === 'fire') {
    // right hand round a vertical pistol grip: palm on the right-hand side, fingers across the front, thumb up the left, index along the frame
    g.add(block(glove, 0.030, 0.078, 0.080, [-0.032, 0.004, -0.004]));
    g.add(seg(glove, [-0.030, 0.034, 0.036], [-0.025, 0.036, 0.088], R));                      // index finger laid along the receiver
    for (const y of [0.011, -0.009, -0.027]) {
      g.add(seg(glove, [-0.030, y, 0.034], [-0.014, y, 0.045], y < -0.02 ? 0.0085 : R));
      g.add(seg(glove, [-0.014, y, 0.045], [0.012, y, 0.036], y < -0.02 ? 0.0085 : R));
    }
    g.add(seg(glove, [-0.006, 0.040, -0.028], [0.021, 0.043, 0.032], 0.0105));                // thumb
    return { group: g, wrist: new THREE.Vector3(-0.034, -0.012, -0.064) };
  }
  if (kind === 'cup') {
    // support hand cradling the forend from underneath, fingers up the left side, thumb on the right
    g.add(block(glove, 0.074, 0.026, 0.088, [0, -0.015, 0.0], 0.010));
    for (const z of [-0.030, -0.010, 0.010, 0.030]) {
      const r = z < -0.02 ? 0.0088 : R;
      g.add(seg(glove, [0.034, -0.012, z], [0.040, 0.020, z], r));
      g.add(seg(glove, [0.040, 0.020, z], [0.024, 0.046, z], r));
    }
    g.add(seg(glove, [-0.026, -0.012, -0.028], [-0.038, 0.018, 0.014], 0.0105));
    return { group: g, wrist: new THREE.Vector3(0.008, -0.020, -0.066) };
  }
  if (kind === 'pistolL') {
    // two-handed pistol grip: left palm over the right hand's fingers, wrapped from the left, thumb forward along the frame
    g.add(block(glove, 0.030, 0.070, 0.070, [0.034, -0.022, -0.004]));
    for (const y of [-0.004, -0.023, -0.042]) {
      g.add(seg(glove, [0.031, y, 0.034], [0.012, y, 0.047], R));
      g.add(seg(glove, [0.012, y, 0.047], [-0.014, y, 0.039], R));
    }
    g.add(seg(glove, [0.013, 0.010, -0.030], [0.030, 0.016, 0.052], 0.0105));
    return { group: g, wrist: new THREE.Vector3(0.036, -0.034, -0.060) };
  }
  // knife: a fist round the handle, knuckles up
  g.add(block(glove, 0.070, 0.026, 0.076, [0, 0.036, 0.0], 0.011));
  for (const x of [-0.024, -0.008, 0.008, 0.024]) {
    g.add(seg(glove, [x, 0.030, 0.034], [x, 0.012, 0.046], R));
    g.add(seg(glove, [x, 0.012, 0.046], [x, -0.012, 0.036], R));
    g.add(seg(glove, [x, -0.012, 0.036], [x, -0.026, 0.010], R));
  }
  g.add(seg(glove, [0.034, 0.028, -0.032], [0.022, 0.014, 0.030], 0.0105));
  return { group: g, wrist: new THREE.Vector3(0, 0.040, -0.066) };
}

class Hand {
  readonly root = new THREE.Group();                                  // world (view) placement of the hold point; local frame = weapon frame
  private variants = new Map<HandKind, { group: THREE.Group; wrist: THREE.Vector3 }>();
  readonly forearm: THREE.Mesh; readonly cuff: THREE.Mesh;
  private kind: HandKind = 'fire';
  readonly wristView = new THREE.Vector3();
  constructor(private glove: THREE.Material, private sleeve: THREE.MeshStandardMaterial, kinds: HandKind[]) {
    for (const k of kinds) { const v = buildHand(k, glove); v.group.visible = false; this.root.add(v.group); this.variants.set(k, v); }
    this.forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.036, 1, 14, 1, true), sleeve);
    this.cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.039, 1, 14, 1, false), glove);
    this.forearm.frustumCulled = this.cuff.frustumCulled = false;
  }
  addTo(scene: THREE.Scene) { scene.add(this.root, this.forearm, this.cuff); }
  setKind(k: HandKind | null) {
    this.kind = k ?? this.kind;
    for (const [kk, v] of this.variants) v.group.visible = k !== null && kk === k;
    this.root.visible = this.forearm.visible = this.cuff.visible = k !== null;
  }
  /** `elbow` is where the forearm comes from (view space); the wrist is the active variant's wrist point carried through the hand's transform */
  updateArm(elbow: THREE.Vector3) {
    const v = this.variants.get(this.kind); if (!v) return;
    this.root.updateMatrixWorld(true);
    this.wristView.copy(v.wrist).applyMatrix4(this.root.matrixWorld);
    const dir = new THREE.Vector3().subVectors(elbow, this.wristView); const len = dir.length(); dir.normalize();
    // forearm: wrist -> elbow (cylinder runs along local Y, +Y end is the wide elbow end)
    this.forearm.position.copy(this.wristView).addScaledVector(dir, len / 2); this.forearm.quaternion.setFromUnitVectors(Y_AXIS, dir); this.forearm.scale.set(1, len, 1);
    // glove cuff overlaps the first 7 cm of the sleeve so the join reads as a cuff, not a seam
    this.cuff.position.copy(this.wristView).addScaledVector(dir, 0.028); this.cuff.quaternion.copy(this.forearm.quaternion); this.cuff.scale.set(1, 0.07, 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------

export class Viewmodel {
  /** QA only: render the weapons exactly as the pack ships them (floating parts and all) for before/after captures */
  static skipFillers = false;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 5);
  private rig = new THREE.Group();
  private model = new THREE.Group();
  private src: THREE.Object3D;
  private current: THREE.Object3D | null = null;
  private magNode: THREE.Object3D | null = null;
  private magRest = new THREE.Vector3();
  private magGrab = new THREE.Vector3();
  private slideNode: THREE.Object3D | null = null; private slideRest = new THREE.Vector3();
  private pumpNode: THREE.Object3D | null = null; private pumpRest = new THREE.Vector3();
  private hold: Hold = DEFAULT_HOLD;
  private id: WeaponId = 'a5';
  private team: 0 | 1 = 0;
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x7d6c4a, roughness: 0.92 });
  private glove = new THREE.MeshStandardMaterial({ color: 0x4a4d53, roughness: 0.75 });
  private handR: Hand; private handL: Hand;
  private guardMeshes: THREE.Mesh[] = [];
  private fillerMeshes: THREE.Mesh[] = [];
  private flash: THREE.Group;
  private flashT = 0;
  private kick = 0; private lastFired = -9; private lastReload = -9;
  private equipDur = 0.5; private inspectT = -1; private knifeT = -1;
  private bobT = 0; private swayX = 0; private swayY = 0; private lmag = 0;
  private brass: Brass[] = [];
  private brassNext = 0;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpQ = new THREE.Quaternion();
  private baseFov = 62;
  /** viewmodel-space muzzle for tracers / smoke (updated each frame) */
  readonly muzzleVm = new THREE.Vector3();
  provisional = true;

  constructor(weapons: THREE.Object3D) {
    this.src = weapons;
    this.scene.add(this.rig); this.rig.add(this.model);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x9a8466, 1.7));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(-0.6, 1, 0.8); this.scene.add(sun);
    this.handR = new Hand(this.glove, this.sleeve, ['fire', 'knife']);
    this.handL = new Hand(this.glove, this.sleeve, ['cup', 'pistolL']);
    this.handR.addTo(this.scene); this.handL.addTo(this.scene);
    // muzzle flash: two crossed additive quads
    this.flash = new THREE.Group();
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), fm); q.rotation.z = i * Math.PI / 4; this.flash.add(q); }
    const core = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.035), new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.add(core);
    this.flash.visible = false; this.scene.add(this.flash);
    const bg = new THREE.BoxGeometry(0.012, 0.012, 0.03), bm = new THREE.MeshStandardMaterial({ color: 0xc79a3c, roughness: 0.4, metalness: 0.8 });
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(bg, bm); b.visible = false; this.scene.add(b); this.brass.push({ mesh: b, vel: new THREE.Vector3(), life: 0 }); }
  }

  setTeam(team: 0 | 1) {
    this.team = team;
    this.sleeve.color.setHex(team === 0 ? 0x7d6c4a : 0x4b5a40);
  }

  setWeapon(id: WeaponId, team: 0 | 1, fovBase: number) {
    this.team = team; this.setTeam(team);
    this.id = id; this.baseFov = WEAPONS[id].fov;
    void fovBase;
    if (this.current) this.model.remove(this.current);
    for (const m of this.guardMeshes) { m.removeFromParent(); m.geometry.dispose(); }
    for (const m of this.fillerMeshes) { m.removeFromParent(); m.geometry.dispose(); }
    this.guardMeshes = []; this.fillerMeshes = [];
    const def = WEAPONS[id];
    const name = team === 0 ? def.model3p.vanguard : def.model3p.garrison;
    const src = this.src.getObjectByName(name);
    if (!src) { this.current = null; return; }
    const w = src.clone(true);
    w.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; } });
    this.hold = HOLDS[name] ?? DEFAULT_HOLD;
    // the same procedural handguard the third-person model gets, so the support hand holds something
    if (this.hold.guard) for (const p of guardParts(this.hold.guard[0], this.hold.guard[1], this.hold.barrelY)) {
      const m = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color[0], p.color[1], p.color[2]), roughness: 0.55, metalness: 0.3 })); m.frustumCulled = false; w.add(m); this.guardMeshes.push(m);
    }
    // join the pieces the pack leaves floating (see fillers.ts); same colour as the neighbouring kit material
    this.fillerMeshes = [];
    if (FILLERS[name] && !Viewmodel.skipFillers) for (const { geo, ref } of fillerGeometries(name)) {
      const fm = fillerMaterial(w, ref); const m = new THREE.Mesh(geo, fm ?? new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.6 })); m.frustumCulled = false; w.add(m); this.fillerMeshes.push(m);
    }
    this.model.add(w); this.current = w;
    this.model.rotation.set(0, Math.PI, 0);   // model +Z (muzzle) -> view -Z
    // put the model's GRIP POINT at the rig origin: rig placement then positions the firing hand exactly
    const gr = this.hold.grip; this.model.position.set(gr[0], -gr[1], gr[2]);
    this.magNode = w.getObjectByName('magazine') ?? w.getObjectByName('magazine-compact') ?? null;
    this.magRest.copy(this.magNode ? this.magNode.position : this.tmpA.set(0, 0, 0));
    this.slideNode = w.getObjectByName('slide') ?? null; if (this.slideNode) this.slideRest.copy(this.slideNode.position);
    this.pumpNode = w.getObjectByName('pump') ?? null; if (this.pumpNode) this.pumpRest.copy(this.pumpNode.position);
    // where the support hand grabs the magazine: low on the magazine body, taken from its real bounds
    this.magGrab.set(0, gr[1] - 0.02, gr[2] + 0.12);
    if (this.magNode) {
      w.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(this.magNode); const root = new THREE.Matrix4().copy(w.matrixWorld).invert(); bb.applyMatrix4(root);
      this.magGrab.set((bb.min.x + bb.max.x) / 2, bb.min.y + 0.045, (bb.min.z + bb.max.z) / 2);
    }
    this.equipDur = Math.max(0.3, def.equipTime);
    this.kick = 0; this.inspectT = -1; this.knifeT = -1; this.lmag = 0;
    this.equipStart = this.t; this.useEquip = true;
    // hand variants for this weapon
    this.handR.setKind(id === 'knife' ? 'knife' : 'fire');
    this.handL.setKind(id === 'knife' ? null : this.hold.fore ? 'cup' : 'pistolL');
  }
  private t = 0; private equipStart = -9; private useEquip = false;

  inspect() { if (this.inspectT < 0) this.inspectT = 0; }

  /** the viewmodel has its own fixed FOV, so changing the world FOV (or zooming) never resizes the gun */
  resize(aspect: number, fov: number) { void fov; this.camera.aspect = aspect; this.camera.fov = 60 + (this.baseFov - 70) * 0.25; this.camera.updateProjectionMatrix(); }

  private ejectBrass() {
    const b = this.brass[this.brassNext++ % this.brass.length]!;
    b.mesh.position.copy(this.model.localToWorld(this.tmpA.set(-0.03, this.hold.barrelY + 0.03, this.hold.grip[2] + 0.18)));
    b.mesh.visible = true; b.life = 0.7;
    b.vel.set(1.1 + Math.random() * 0.6, 1.1 + Math.random() * 0.6, 0.3 + Math.random() * 0.6);
    b.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }

  update(dt: number, s: VmState) {
    this.t += dt;
    const p = POSES[s.weapon]; const def = WEAPONS[s.weapon];
    // ---- events
    if (s.firedAt > this.lastFired) {
      this.lastFired = s.firedAt;
      if (s.time - s.firedAt < 0.25) {
        if (s.weapon === 'knife') this.knifeT = 0;
        else { this.kick = Math.min(1.6, this.kick + 1); this.flashT = 0.05; this.flash.rotation.z = Math.random() * 6; if (s.weapon !== 't12') this.ejectBrass(); this.pumpT = s.weapon === 't12' ? 0 : -1; }
      }
    }
    if (s.reloadAt > this.lastReload) { this.lastReload = s.reloadAt; }

    // ---- pose composition
    const move = Math.min(1, s.speed / 5.2) * (s.onGround ? 1 : 0.15);
    this.bobT += dt * (3 + move * 7.5);
    const bobAmp = s.reduceMotion ? 0 : move * (1 - 0.7 * s.aim);        // steadier while aiming
    const bobX = Math.sin(this.bobT) * 0.012 * bobAmp, bobY = Math.abs(Math.cos(this.bobT)) * 0.014 * bobAmp - 0.004 * bobAmp;
    this.swayX += (-s.turnX * 0.9 - this.swayX) * Math.min(1, dt * 9); this.swayY += (-s.turnY * 0.9 - this.swayY) * Math.min(1, dt * 9);
    const sx = THREE.MathUtils.clamp(this.swayX, -0.04, 0.04), sy = THREE.MathUtils.clamp(this.swayY, -0.03, 0.03);
    const idle = s.reduceMotion ? 0 : 1;
    const breathe = Math.sin(this.t * 1.7) * 0.0018 * idle;

    this.kick = Math.max(0, this.kick - dt * (def.rpm > 400 ? 9 : 6) * (0.6 + this.kick));
    const kick = this.kick;

    let px = p.at[0] + bobX + sx, py = p.at[1] + bobY + sy + breathe, pz = p.at[2] + p.kickBack * kick;
    let rx = p.rot[0] + p.kickRot * kick - bobY * 2.0, ry = p.rot[1] + bobX * 1.5, rz = p.rot[2] + bobX * 2;
    py += p.kickUp * kick;
    if (s.crouching) py += 0.012;
    if (!s.onGround) { py += 0.01; rx += 0.03; }

    // equip: rise from below
    const eqT = (this.t - this.equipStart) / this.equipDur;
    if (this.useEquip && eqT < 1) { const e = 1 - Math.pow(Math.max(0, eqT), 0.6); py -= 0.32 * e; rx -= 0.7 * e; ry += 0.3 * e; } else this.useEquip = false;

    // inspect: lift and roll
    if (this.inspectT >= 0) {
      this.inspectT += dt; const k = this.inspectT / 2.4;
      if (k >= 1) this.inspectT = -1; else { const e = Math.sin(Math.PI * Math.min(1, k * 1.05)); px -= 0.06 * e; py += 0.045 * e; pz += 0.08 * e; ry += (Math.sin(k * Math.PI * 2) * 0.9) * e; rz += 0.9 * e * Math.sin(k * Math.PI * 1.5); rx += 0.25 * e; }
    }
    // knife swipe
    if (this.knifeT >= 0) {
      this.knifeT += dt; const k = this.knifeT / 0.38;
      if (k >= 1) this.knifeT = -1; else { const e = Math.sin(k * Math.PI); px -= 0.2 * e; pz -= 0.1 * e; py += 0.04 * e; ry += 1.2 * e; rx -= 0.8 * e; rz += 0.9 * e; }
    }
    // reload staged pose
    let leftToMag = 0, magOff = 0, magHidden = false;
    if (s.reloading && s.weapon !== 'knife') {
      const total = Math.max(0.6, def.reloadTime); const k = THREE.MathUtils.clamp(1 - s.reloadT / total, 0, 1);
      const phase = (a: number, b: number) => THREE.MathUtils.clamp((k - a) / (b - a), 0, 1);
      const down = Math.sin(Math.PI * phase(0, 0.2)) * (k < 0.5 ? 1 : 0) + (k >= 0.2 ? 1 - phase(0.82, 1) : 0);
      py += 0.075 * down; rz += 0.30 * down; rx += 0.14 * down; px -= 0.05 * down;     // lift and cant the gun toward the player so the magazine change happens in view
      leftToMag = k >= 0.1 && k < 0.78 ? 1 : 0;
      if (k < 0.3) { magOff = phase(0.12, 0.3); }        // mag drops away
      else if (k < 0.5) { magHidden = true; }             // swapped out of view
      else if (k < 0.7) { magOff = 1 - phase(0.5, 0.7); } // fresh mag slides in
      if (k >= 0.7 && k < 0.8) pz += 0.02 * Math.sin(Math.PI * phase(0.7, 0.8)); // slap
      if (k >= 0.78 && k < 0.92 && s.weapon !== 'p50') { pz += 0.03 * Math.sin(Math.PI * phase(0.78, 0.92)); } // charge
    }
    this.lmag += (leftToMag - this.lmag) * Math.min(1, dt * 14);

    // aim down sights: bring the rear and front sight tips onto the camera axis (slightly below it so the target stays visible above the front post)
    const sights = this.hold.sights;
    if (s.aim > 0.001 && sights && s.weapon !== 'knife') {
      const k = s.aim * s.aim * (3 - 2 * s.aim);
      const sc = p.scale, gr = this.hold.grip, r = sights.rear, f = sights.front;
      const slope = Math.atan2(f[1] - r[1], f[2] - r[2]);               // sight line rises toward the muzzle by this much: tilt the gun down by it
      const c = Math.cos(-slope), sn = Math.sin(-slope);
      const qx = gr[0] - r[0], qy = r[1] - gr[1], qz = gr[2] - r[2];       // rig-local position of the rear sight tip (model is turned 180 deg about Y and shifted so the grip is the origin)
      const depth = s.weapon === 'p50' ? 0.30 : 0.27;
      const ax = -qx * sc, ay = -(qy * c - qz * sn) * sc - 0.012, az = -(qy * sn + qz * c) * sc - depth;
      px = THREE.MathUtils.lerp(px, ax, k); py = THREE.MathUtils.lerp(py, ay, k); pz = THREE.MathUtils.lerp(pz, az + p.kickBack * kick * 0.5, k);
      rx = THREE.MathUtils.lerp(rx, -slope + p.kickRot * kick * 0.5, k); ry = THREE.MathUtils.lerp(ry, 0, k); rz = THREE.MathUtils.lerp(rz, 0, k);
    }
    this.rig.position.set(px, py, pz); this.rig.rotation.set(rx, ry, rz); this.rig.scale.setScalar(p.scale);
    // moving parts of the weapon itself
    if (this.magNode) {
      this.magNode.visible = !magHidden;
      this.magNode.position.set(this.magRest.x, this.magRest.y - magOff * 0.3 / p.scale, this.magRest.z);
    }
    if (this.slideNode) this.slideNode.position.set(this.slideRest.x, this.slideRest.y, this.slideRest.z - 0.04 * Math.min(1, kick));          // pistol slide cycles back with each shot
    if (this.pumpNode) {                                                                                                                       // shotgun pump racks after the shot
      if (this.pumpT >= 0) { this.pumpT += dt; const k = this.pumpT / 0.55; if (k >= 1) this.pumpT = -1; else this.pumpNode.position.z = this.pumpRest.z - 0.1 * Math.sin(Math.PI * Math.min(1, Math.max(0, (k - 0.2) / 0.8))); } else this.pumpNode.position.z = this.pumpRest.z;
    }
    this.rig.updateMatrixWorld(true);

    // ---- hands: placed on the weapon's own hold points, so they ride every animation of the rig
    this.model.getWorldQuaternion(this.tmpQ);
    const hr = this.handR.root; hr.quaternion.copy(this.tmpQ);
    const gripPt = this.tmpA.set(this.hold.grip[0], this.hold.grip[1], this.hold.grip[2]); hr.position.copy(this.model.localToWorld(gripPt));
    if (this.id === 'knife') { this.handL.setKind(null); }
    else {
      const hl = this.handL.root; hl.quaternion.copy(this.tmpQ);
      const fore = this.hold.fore;
      const base = fore ? this.tmpB.set(fore[0], fore[1], fore[2]) : this.tmpB.set(this.hold.grip[0], this.hold.grip[1], this.hold.grip[2]);
      const pt = this.tmpA.copy(base);
      if (this.lmag > 0.001) {
        // reaching for / carrying the magazine: from the forend (or grip) down to the magazine, following it as it drops
        pt.lerp(this.magGrab, this.lmag); pt.y -= magOff * 0.3 / p.scale * this.lmag;
        if (!fore) pt.x += 0.0;
      }
      hl.position.copy(this.model.localToWorld(pt));
    }
    // forearms come from below and behind the camera
    this.handR.updateArm(this.tmpB.set(0.30, -0.50, -0.02));
    if (this.id !== 'knife') this.handL.updateArm(this.tmpB.set(this.id === 'p50' ? 0.0 : -0.16, -0.50, -0.10));

    // muzzle flash
    this.muzzleVm.copy(this.model.localToWorld(this.tmpA.set(0, this.hold.barrelY, this.hold.muzzleZ + 0.02)));
    if (this.flashT > 0 && s.weapon !== 'knife') { this.flashT -= dt; this.flash.visible = true; this.flash.position.copy(this.muzzleVm); this.flash.scale.setScalar(0.7 + Math.random() * 0.6); this.flash.lookAt(this.camera.position); }
    else this.flash.visible = false;

    // brass
    for (const b of this.brass) {
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.life -= dt; b.vel.y -= 5.5 * dt; b.mesh.position.addScaledVector(b.vel, dt); b.mesh.rotation.x += dt * 14;
    }
    const vis = s.alive && !(def.scoped && s.aim > 0.92);        // looking through the scope: the gun itself is not drawn
    this.rig.visible = vis;
    this.handR.root.visible = this.handR.forearm.visible = this.handR.cuff.visible = vis;
    if (this.id !== 'knife') this.handL.root.visible = this.handL.forearm.visible = this.handL.cuff.visible = vis;
  }
  private pumpT = -1;

  get object() { return this.rig; }
}
