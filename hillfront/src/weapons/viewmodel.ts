/**
 * First-person viewmodel.
 *
 * *** PROVISIONAL ***  The licensed CuiGames animated viewmodels (A5 Carbine, P50, T12) were not obtainable from the
 * build sandbox (see assets/inbox/README.md). Until they are imported this class renders the CC0 Hill Town weapon models
 * at close range with procedurally animated arms/hands. The public surface (setWeapon / update / events / muzzle) is what a
 * GLB-clip-driven implementation will also provide, so the swap does not touch game code.
 *
 * Rendered in its own pass with a cleared depth buffer so the gun never clips into walls.
 */
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../gameplay/weapons.ts';

interface FpProfile {
  pos: [number, number, number]; rot: [number, number, number]; scale: number;
  rightGrip: [number, number, number]; leftGrip: [number, number, number] | null; magPos: [number, number, number];
  muzzle: [number, number, number]; eject: [number, number, number];
  kickBack: number; kickUp: number; kickRot: number;
}

/** model-local points (model +Z = muzzle, +Y = up) measured against the CC0 model bounds */
const PROFILES: Record<WeaponId, FpProfile> = {
  a5:    { pos: [0.17, -0.2, -0.58], rot: [0.0, 0.07, 0], scale: 0.78, rightGrip: [0, 0.075, -0.115], leftGrip: [0, 0.07, 0.15], magPos: [0, 0.07, -0.06], muzzle: [0, 0.225, 0.47], eject: [0.0, 0.22, -0.02], kickBack: 0.04, kickUp: 0.02, kickRot: 0.05 },
  m9:    { pos: [0.16, -0.19, -0.5], rot: [0.0, 0.07, 0], scale: 0.92, rightGrip: [0, 0.07, -0.08], leftGrip: [0, 0.075, 0.1], magPos: [0, 0.07, -0.04], muzzle: [0, 0.2, 0.31], eject: [0, 0.2, -0.02], kickBack: 0.03, kickUp: 0.014, kickRot: 0.035 },
  t12:   { pos: [0.17, -0.2, -0.62], rot: [0.0, 0.07, 0], scale: 0.74, rightGrip: [0, 0.08, -0.135], leftGrip: [0, 0.07, 0.17], magPos: [0, 0.07, -0.05], muzzle: [0, 0.2, 0.5], eject: [0, 0.2, -0.02], kickBack: 0.07, kickUp: 0.035, kickRot: 0.085 },
  r7:    { pos: [0.17, -0.21, -0.64], rot: [0.0, 0.07, 0], scale: 0.7, rightGrip: [0, 0.085, -0.15], leftGrip: [0, 0.075, 0.2], magPos: [0, 0.07, -0.06], muzzle: [0, 0.235, 0.53], eject: [0, 0.23, -0.02], kickBack: 0.06, kickUp: 0.032, kickRot: 0.075 },
  p50:   { pos: [0.12, -0.14, -0.46], rot: [0.0, 0.04, 0], scale: 1.05, rightGrip: [0, 0.06, -0.05], leftGrip: [0.0, 0.055, -0.03], magPos: [0, 0.04, -0.05], muzzle: [0, 0.155, 0.13], eject: [0, 0.16, 0.0], kickBack: 0.04, kickUp: 0.03, kickRot: 0.1 },
  knife: { pos: [0.14, -0.15, -0.42], rot: [0.5, 0.0, -0.5], scale: 1.5, rightGrip: [0, 0.005, -0.04], leftGrip: null, magPos: [0, 0, 0], muzzle: [0, 0, 0.2], eject: [0, 0, 0], kickBack: 0, kickUp: 0, kickRot: 0 },
};

export interface VmState {
  alive: boolean; weapon: WeaponId; speed: number; onGround: boolean; crouching: boolean;
  firedAt: number; reloadAt: number; reloading: boolean; reloadT: number; equipT: number; time: number;
  turnX: number; turnY: number; reduceMotion: boolean; dt: number;
}

interface Brass { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; }

function limb(color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.frustumCulled = false; return m;
}
function placeLimb(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thick: number) {
  m.position.copy(a).lerp(b, 0.5); m.lookAt(b);
  m.scale.set(thick, thick, a.distanceTo(b));
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 5);
  private rig = new THREE.Group();
  private model = new THREE.Group();
  private src: THREE.Object3D;
  private current: THREE.Object3D | null = null;
  private magNode: THREE.Object3D | null = null;
  private magRest = new THREE.Vector3();
  private id: WeaponId = 'a5';
  private team: 0 | 1 = 0;
  private armR = limb(0x6b5a3e); private armL = limb(0x6b5a3e);
  private gloveR = limb(0x26282b); private gloveL = limb(0x26282b);
  private sleeveCuffR = limb(0x1f2123); private sleeveCuffL = limb(0x1f2123);
  private flash: THREE.Group;
  private flashT = 0;
  private kick = 0; private lastFired = -9; private lastReload = -9;
  private equipDur = 0.5; private inspectT = -1; private knifeT = -1;
  private bobT = 0; private swayX = 0; private swayY = 0;
  private brass: Brass[] = [];
  private brassNext = 0;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpC = new THREE.Vector3();
  private baseFov = 62;
  /** viewmodel-space muzzle for tracers / smoke (updated each frame) */
  readonly muzzleVm = new THREE.Vector3();
  provisional = true;

  constructor(weapons: THREE.Object3D) {
    this.src = weapons;
    this.scene.add(this.rig); this.rig.add(this.model);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x9a8466, 1.7));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(-0.6, 1, 0.8); this.scene.add(sun);
    for (const m of [this.armR, this.armL, this.gloveR, this.gloveL, this.sleeveCuffR, this.sleeveCuffL]) this.scene.add(m);
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
    const sleeve = team === 0 ? 0x8d7650 : 0x4b5a40;
    (this.armR.material as THREE.MeshStandardMaterial).color.setHex(sleeve); (this.armL.material as THREE.MeshStandardMaterial).color.setHex(sleeve);
  }

  setWeapon(id: WeaponId, team: 0 | 1, fovBase: number) {
    this.team = team; this.setTeam(team);
    this.id = id; this.baseFov = WEAPONS[id].fov;
    void fovBase;
    if (this.current) this.model.remove(this.current);
    const def = WEAPONS[id];
    const name = team === 0 ? def.model3p.vanguard : def.model3p.garrison;
    const src = this.src.getObjectByName(name);
    if (!src) { this.current = null; return; }
    const w = src.clone(true);
    // pistols / knife keep their own pivots; centre the long axis so profile numbers stay consistent
    w.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; } });
    this.model.add(w); this.current = w;
    this.model.rotation.set(0, Math.PI, 0);   // model +Z (muzzle) -> view -Z
    this.magNode = w.getObjectByName('magazine') ?? w.getObjectByName('slide') ?? null;
    this.magRest.copy(this.magNode ? this.magNode.position : this.tmpA.set(0, 0, 0));
    this.equipDur = Math.max(0.3, def.equipTime);
    this.kick = 0; this.inspectT = -1; this.knifeT = -1;
    this.equipStart = this.t; this.useEquip = true;
  }
  private t = 0; private equipStart = -9; private useEquip = false;

  inspect() { if (this.inspectT < 0) this.inspectT = 0; }

  resize(aspect: number, fov: number) { this.camera.aspect = aspect; this.camera.fov = Math.min(80, fov * 0.78 + (this.baseFov - 70) * 0.25); this.camera.updateProjectionMatrix(); }

  private ejectBrass(p: FpProfile) {
    const b = this.brass[this.brassNext++ % this.brass.length]!;
    const e = this.tmpA.set(p.eject[0] * -1, p.eject[1], -p.eject[2]).multiplyScalar(this.rig.scale.x).applyMatrix4(this.rig.matrix);
    b.mesh.position.copy(e); b.mesh.visible = true; b.life = 0.7;
    b.vel.set(1.1 + Math.random() * 0.6, 1.1 + Math.random() * 0.6, 0.3 + Math.random() * 0.6);
    b.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }

  update(dt: number, s: VmState) {
    this.t += dt;
    const p = PROFILES[s.weapon]; const def = WEAPONS[s.weapon];
    if (s.weapon !== this.id) { /* caller swaps via setWeapon */ }
    // ---- events
    if (s.firedAt > this.lastFired) {
      this.lastFired = s.firedAt;
      if (s.time - s.firedAt < 0.25) {
        if (s.weapon === 'knife') this.knifeT = 0;
        else { this.kick = Math.min(1.6, this.kick + 1); this.flashT = 0.05; this.flash.rotation.z = Math.random() * 6; if (s.weapon !== 't12') this.ejectBrass(p); }
      }
    }
    if (s.reloadAt > this.lastReload) { this.lastReload = s.reloadAt; }
    if (!s.alive) { this.rig.visible = false; }

    // ---- pose composition
    const move = Math.min(1, s.speed / 5.2) * (s.onGround ? 1 : 0.15);
    this.bobT += dt * (3 + move * 7.5);
    const bobAmp = s.reduceMotion ? 0 : move;
    const bobX = Math.sin(this.bobT) * 0.012 * bobAmp, bobY = Math.abs(Math.cos(this.bobT)) * 0.014 * bobAmp - 0.004 * bobAmp;
    this.swayX += (-s.turnX * 0.9 - this.swayX) * Math.min(1, dt * 9); this.swayY += (-s.turnY * 0.9 - this.swayY) * Math.min(1, dt * 9);
    const sx = THREE.MathUtils.clamp(this.swayX, -0.04, 0.04), sy = THREE.MathUtils.clamp(this.swayY, -0.03, 0.03);
    const idle = s.reduceMotion ? 0 : 1;
    const breathe = Math.sin(this.t * 1.7) * 0.0018 * idle;

    this.kick = Math.max(0, this.kick - dt * (def.rpm > 400 ? 9 : 6) * (0.6 + this.kick));
    const kick = this.kick;

    let px = p.pos[0] + bobX + sx, py = p.pos[1] + bobY + sy + breathe, pz = p.pos[2] + p.kickBack * kick;
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
      const down = Math.sin(Math.PI * phase(0, 0.2)) * (k < 0.5 ? 1 : 0) + (k >= 0.2 && k < 0.85 ? 1 : 0) * 0 + (k >= 0.2 ? 1 - phase(0.82, 1) : 0);
      py -= 0.075 * down; rz += 0.38 * down; rx += 0.2 * down; px -= 0.02 * down;
      leftToMag = k >= 0.1 && k < 0.78 ? 1 : 0;
      if (k < 0.3) { magOff = phase(0.12, 0.3); }        // mag drops away
      else if (k < 0.5) { magHidden = true; }             // swapped out of view
      else if (k < 0.7) { magOff = 1 - phase(0.5, 0.7); } // fresh mag slides in
      if (k >= 0.7 && k < 0.8) pz += 0.02 * Math.sin(Math.PI * phase(0.7, 0.8)); // slap
      if (k >= 0.78 && k < 0.92 && s.weapon !== 'p50') { pz += 0.03 * Math.sin(Math.PI * phase(0.78, 0.92)); } // charge
    }

    this.rig.position.set(px, py, pz); this.rig.rotation.set(rx, ry, rz); this.rig.scale.setScalar(p.scale);
    this.rig.updateMatrix(); this.rig.updateMatrixWorld(true);
    if (this.magNode) {
      this.magNode.visible = !magHidden;
      this.magNode.position.set(this.magRest.x, this.magRest.y - magOff * 0.35 / p.scale, this.magRest.z);
    }

    // ---- hands & arms follow the (animated) weapon
    const toView = (pt: [number, number, number]) => this.tmpA.set(-pt[0], pt[1], -pt[2]).applyMatrix4(this.rig.matrixWorld).clone();
    const handR = toView(p.rightGrip);
    let handLPt: THREE.Vector3 | null = null;
    if (p.leftGrip) handLPt = leftToMag ? toView(p.magPos).add(this.tmpB.set(-0.02, -0.07 * leftToMag, 0.0)) : toView(p.leftGrip);
    const rightElbow = this.tmpB.set(0.30, -0.5, 0.18).clone();
    placeLimb(this.armR, rightElbow, handR, 0.062);
    placeLimb(this.gloveR, handR.clone().lerp(rightElbow, -0.0), handR.clone().add(this.tmpC.copy(handR).sub(rightElbow).normalize().multiplyScalar(0.05)), 0.078);
    placeLimb(this.sleeveCuffR, rightElbow.clone().lerp(handR, 0.82), rightElbow.clone().lerp(handR, 0.92), 0.075);
    if (handLPt) {
      const leftElbow = this.tmpB.set(-0.26, -0.5, 0.12).clone();
      placeLimb(this.armL, leftElbow, handLPt, 0.062);
      placeLimb(this.gloveL, handLPt.clone(), handLPt.clone().add(this.tmpC.copy(handLPt).sub(leftElbow).normalize().multiplyScalar(0.06)), 0.078);
      placeLimb(this.sleeveCuffL, leftElbow.clone().lerp(handLPt, 0.82), leftElbow.clone().lerp(handLPt, 0.92), 0.075);
      this.armL.visible = this.gloveL.visible = this.sleeveCuffL.visible = true;
    } else this.armL.visible = this.gloveL.visible = this.sleeveCuffL.visible = false;

    // muzzle flash
    this.muzzleVm.set(-p.muzzle[0], p.muzzle[1], -p.muzzle[2]).applyMatrix4(this.rig.matrixWorld);
    if (this.flashT > 0 && s.weapon !== 'knife') { this.flashT -= dt; this.flash.visible = true; this.flash.position.copy(this.muzzleVm); this.flash.scale.setScalar(0.7 + Math.random() * 0.6); this.flash.lookAt(this.camera.position); }
    else this.flash.visible = false;

    // brass
    for (const b of this.brass) {
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.life -= dt; b.vel.y -= 5.5 * dt; b.mesh.position.addScaledVector(b.vel, dt); b.mesh.rotation.x += dt * 14;
    }
    this.rig.visible = s.alive;
  }

  get object() { return this.rig; }
}
