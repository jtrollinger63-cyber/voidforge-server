// Camera rig: spring chase / close chase / hood / cockpit / cinematic (TV style) + fly-over for race intros.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export const CAM_MODES = ['Chase', 'Close', 'Hood', 'Cockpit', 'Cinematic'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera; this.world = world; // world: { td, terrain }
    this.mode = 0; this.yaw = 0; this.rel = new THREE.Vector3(0, 3, -7); this.look = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this.fov = 62; this.shakeAmt = 0; this.settings = { shake: 1, fov: 1, motion: 1 };
    this.cine = { t: 0, idx: 0, pos: new THREE.Vector3(), kind: 0, until: 0 };
    this.roll = 0; this.q = {}; this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.manualOrbit = 0;
    this.intro = null;
    this.look.set(0, 0, 0);
  }

  setWorld(world) { this.world = world; }
  setMode(m) { this.mode = ((m % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length; this.cine.until = 0; }
  next() { this.setMode(this.mode + 1); return CAM_MODES[this.mode]; }
  kick(amount) { this.shakeAmt = Math.min(1.4, this.shakeAmt + amount); }

  /** Immediately place the camera where it should be for this vehicle (no easing). */
  snap(veh, model) { this.yaw = veh.heading; this.rel.set(-Math.sin(veh.heading) * 7, 2.8, -Math.cos(veh.heading) * 7); this.update(0.016, veh, model, { snap: true, steer: 0 }); }

  update(dt, veh, model, ctx = {}) {
    const cam = this.camera;
    const speedN = clamp(veh.speed / 75, 0, 1.2);
    const boost = veh.boosting ? 1 : 0;
    if (this.mode === 4) return this.updateCine(dt, veh, model, ctx);
    if (this.mode >= 2) this.updateInside(dt, veh, model, ctx, speedN);
    else {
      // --- spring chase ---
      const close = this.mode === 1;
      const slip = clamp(veh.beta || 0, -0.8, 0.8);
      const steer = ctx.steer || 0;
      const recenter = Math.abs(steer) < 0.1 ? 1.6 : 1;
      const target = veh.heading + slip * 0.55;                       // swing round a little while drifting
      const yawRate = lerp(3.0, 6.2, speedN) * recenter;              // lag: camera trails the car's rotation
      this.yaw += wrap(target - this.yaw) * (ctx.snap ? 1 : damp(yawRate, dt));
      const dist = (close ? 4.9 : 7.1) + speedN * (close ? 1.0 : 1.9) + clamp((veh.ax || 0) * 0.04, -0.6, 1.0) - boost * 0.0;
      const height = (close ? 1.75 : 2.55) + speedN * 0.35;
      const sx = Math.sin(this.yaw), cz = Math.cos(this.yaw);
      this.tmp.set(-sx * dist, height, -cz * dist);
      // lateral push-out in corners so you see the apex
      this.tmp.x += cz * clamp(-veh.r * 0.6, -1.2, 1.2) * 0.6; this.tmp.z += -sx * clamp(-veh.r * 0.6, -1.2, 1.2) * 0.6;
      this.rel.lerp(this.tmp, ctx.snap ? 1 : damp(11, dt));
      this.pos.set(veh.x + this.rel.x, veh.y + this.rel.y, veh.z + this.rel.z);
      this.avoid(this.pos, veh);
      // look ahead of the car
      const la = close ? 6 : 9;
      this.tmp.set(veh.x + Math.sin(this.yaw) * la, veh.y + (close ? 1.15 : 1.4), veh.z + Math.cos(this.yaw) * la);
      this.look.lerp(this.tmp, ctx.snap ? 1 : damp(14, dt));
      cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
      this.roll += (clamp(-veh.r * 0.045 - slip * 0.07, -0.08, 0.08) * this.settings.motion - this.roll) * damp(4, dt);
      cam.rotateZ(this.roll);
    }
    // --- FOV + shake ---
    const baseFov = this.mode >= 2 ? 72 : this.mode === 1 ? 66 : 60;
    const fovT = (baseFov + speedN * (this.mode >= 2 ? 12 : 20) + boost * 8) * this.settings.fov;
    this.fov += (fovT - this.fov) * (ctx.snap ? 1 : damp(5, dt));
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.applyShake(dt, veh, speedN, boost);
  }

  applyShake(dt, veh, speedN, boost) {
    const k = this.settings.shake;
    const a = (this.shakeAmt * 0.35 + veh.rumble * 0.035 + speedN * speedN * 0.008 + boost * 0.018) * k;
    if (a > 0.0005) {
      const cam = this.camera;
      cam.position.x += (Math.random() - 0.5) * a; cam.position.y += (Math.random() - 0.5) * a; cam.position.z += (Math.random() - 0.5) * a;
      cam.rotateZ((Math.random() - 0.5) * a * 0.15);
    }
    this.shakeAmt *= Math.exp(-5.5 * dt);
  }

  /** keep the camera out of terrain and tunnel walls */
  avoid(p, veh) {
    const { td, terrain } = this.world;
    if (!td) return;
    td.nearest(p.x, p.z, -1, 18, this.q);
    const q = this.q;
    const tf = td.tunnelF[q.idx];
    let floor;
    if (tf > 0.2) {                       // inside a tunnel the floor is the road, never the mountain above it
      floor = td.roadY(q, clamp(q.lat, -td.half, td.half));
      const tw = td.half + 1.0;
      if (Math.abs(q.lat) > tw - 0.9) { const s = Math.sign(q.lat); p.x -= s * q.rx * (Math.abs(q.lat) - (tw - 0.9)); p.z -= s * q.rz * (Math.abs(q.lat) - (tw - 0.9)); }
      p.y = Math.min(p.y, q.cy + 6.9);
    } else {
      floor = terrain ? terrain.height(p.x, p.z) : 0;
      if (Math.abs(q.lat) < td.half + td.shoulder) floor = Math.max(floor, td.roadY(q, q.lat));
    }
    if (p.y < floor + 0.7) p.y = floor + 0.7;
  }

  updateInside(dt, veh, model, ctx, speedN) {
    const cam = this.camera;
    const body = model.body;
    model.root.updateMatrixWorld(true);
    const p = this.mode === 2 ? model.hoodPoint : model.eyePoint;
    this.tmp.set(p.x, p.y, p.z); body.localToWorld(this.tmp);
    cam.position.copy(this.tmp);
    // orientation: car heading + (scaled) body pitch/roll so the horizon stays comfortable
    const e = new THREE.Euler(model.root.rotation.x + body.rotation.x * 0.7, veh.heading + (veh.beta || 0) * 0.12 * 0 + 0, model.root.rotation.z * 0.5 + body.rotation.z * 0.45, 'YXZ');
    this.quat.setFromEuler(e); this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    // camera looks along its -z; model forward is +z, so rotate by PI around y
    cam.quaternion.copy(this.quat);
    cam.rotateX(-0.015);
    if (this.mode === 3 && ctx.steer) cam.rotateY(-ctx.steer * 0.05); // slight head turn into the corner
  }

  updateCine(dt, veh, model, ctx) {
    const { td } = this.world, cam = this.camera, c = this.cine;
    c.t += dt;
    if (c.until <= c.t || ctx.snap) {
      // pick a new shot
      c.kind = (c.kind + 1 + ((Math.random() * 2) | 0)) % 4;
      c.until = c.t + 3.6 + Math.random() * 2.4;
      const q = td.nearest(veh.x, veh.z, veh.hint, 18, this.q);
      const ahead = Math.round((60 + Math.random() * 120) / 3), i = (q.idx + ahead) % td.N;
      const side = Math.random() > 0.5 ? 1 : -1, off = td.half + td.runoff + 6 + Math.random() * 14;
      if (c.kind === 0) { c.pos.set(td.px[i] + td.rx[i] * side * off, td.py[i] + 1.4 + Math.random() * 1.2, td.pz[i] + td.rz[i] * side * off); }
      else if (c.kind === 1) { c.pos.set(td.px[i] + td.rx[i] * side * (off + 20), td.py[i] + 14 + Math.random() * 14, td.pz[i] + td.rz[i] * side * (off + 20)); }
      else if (c.kind === 2) { c.pos.set(0, 0, 0); } // on-board / nose-ish chase, handled below
      else { const j = (q.idx + Math.round(25 / 3)) % td.N; c.pos.set(td.px[j] + td.rx[j] * side * (td.half + 3), td.py[j] + 0.5, td.pz[j] + td.rz[j] * side * (td.half + 3)); }
    }
    let targetFov = 40;
    if (c.kind === 2) {   // low rear 3/4 chase
      const a = veh.heading + 2.5, d = 6.2;
      this.tmp.set(veh.x + Math.sin(a) * d, veh.y + 1.1, veh.z + Math.cos(a) * d); cam.position.lerp(this.tmp, damp(8, dt)); targetFov = 62;
    } else cam.position.lerp(c.pos, c.t < 0.05 || ctx.snap ? 1 : 1);
    if (c.kind === 1) { /* helicopter drifts slowly */ cam.position.y += dt * 0.6; targetFov = 34; }
    this.avoid(cam.position, veh);
    this.tmp2.set(veh.x + veh.vx * 0.15, veh.y + 0.7, veh.z + veh.vz * 0.15);
    this.look.lerp(this.tmp2, ctx.snap ? 1 : damp(9, dt));
    cam.up.set(0, 1, 0); cam.lookAt(this.look);
    const dist = cam.position.distanceTo(this.tmp2);
    const fovT = c.kind === 2 ? 62 : clamp(1800 / Math.max(dist, 20) * 0.9, 16, 52);
    this.fov += (fovT - this.fov) * damp(6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** Cinematic fly-over for race intros: glide along the track and settle behind the grid car. progress 0..1 */
  flyover(td, progress, startIdx, target) {
    const cam = this.camera, N = td.N;
    const p = clamp(progress, 0, 1), e = p * p * (3 - 2 * p);
    const span = Math.round(((p < 0.999 ? 1 : 0) * 520 + 40) / 3);
    const i = (startIdx - Math.round((1 - e) * span * 2.6) + N * 4) % N;
    const j = (i + 14) % N;
    const alt = (1 - e) * 22 + 3.4, side = Math.sin(p * 2.2) * (1 - e) * 16;
    cam.position.set(td.px[i] + td.rx[i] * side, td.py[i] + alt, td.pz[i] + td.rz[i] * side);
    this.look.set(td.px[j], td.py[j] + 1.5 * e, td.pz[j]);
    if (target && e > 0.55) { const w = (e - 0.55) / 0.45; this.look.lerp(this.tmp2.set(target.x, target.y + 1.0, target.z), w * w); }
    cam.up.set(0, 1, 0); cam.lookAt(this.look);
    const f = lerp(52, 60, e); if (Math.abs(cam.fov - f) > 0.05) { cam.fov = f; cam.updateProjectionMatrix(); }
    this.fov = cam.fov;
  }
}
