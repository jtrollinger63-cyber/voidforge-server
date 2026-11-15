// Car physics (arcade, grip-based) and the low-poly car model.
import * as THREE from 'three';

export const PHYS = {
  topSpeed: 68,        // m/s  (~245 km/h)
  accel: 10.8,         // m/s^2 at standstill
  brake: 34,
  reverseMax: 13,
  reverseAccel: 7,
  latAcc: 23,          // max cornering acceleration m/s^2 (~2.3 g, arcade)
  baseGrip: 8.5,       // lateral velocity damping rate (1/s)
  coast: 1.6,          // engine braking m/s^2
  radius: 1.0,         // collision circle radius
  circleOffset: 1.25,  // front/back collision circle offset
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const lerp = (a, b, t) => a + (b - a) * t;

export class CarBody {
  constructor(id, perf = {}) {
    this.id = id;
    this.perf = { topSpeed: PHYS.topSpeed, accel: PHYS.accel, gripMul: 1, ...perf };
    this.x = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.yawRate = 0; this.steer = 0;
    this.vf = 0; this.vl = 0; this.speed = 0;
    this.slipAngle = 0; this.skid = 0; this.drifting = false;
    this.boost = 0.35; this.boosting = false;
    this.onRoad = true; this.lat = 0; this.hint = -1; this.q = null;
    this.impact = 0; this.contact = false;
    this.accelLong = 0; this.accelLat = 0;
    this.throttle = 0; this.brakeIn = 0;
  }

  place(track, idx, lat, extraHeading = 0) {
    const i = ((idx % track.N) + track.N) % track.N;
    this.x = track.px[i] + track.rx[i] * lat;
    this.z = track.pz[i] + track.rz[i] * lat;
    this.heading = track.heading[i] + extraHeading;
    this.vx = this.vz = this.yawRate = this.steer = 0;
    this.vf = this.vl = this.speed = 0;
    this.hint = i; this.onRoad = true;
    this.q = track.nearest(this.x, this.z, i);
    this.lat = this.q.lat;
    this.boosting = false;
  }

  /** Put the car back on the centre line, facing forward (used by the R key). */
  resetToTrack(track) {
    const q = track.nearest(this.x, this.z, -1);
    this.place(track, q.idx, clamp(q.lat, -track.half * 0.4, track.half * 0.4) * 0.3);
  }

  step(dt, inp, track) {
    const P = this.perf;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx; // right vector
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const vf0 = vf;

    const road = this.onRoad;
    const topMul = road ? 1 : 0.6;
    const gripMul = (road ? 1 : 0.62) * P.gripMul;
    const hb = inp.handbrake ? 1 : 0;
    const thr = inp.throttle, brk = inp.brake;
    this.throttle = thr; this.brakeIn = brk;

    // ---- boost ----
    const wantBoost = !!inp.boost && this.boost > 0.01 && vf > 4 && thr > 0.1;
    this.boosting = wantBoost;
    const vmax = P.topSpeed * topMul * (wantBoost ? 1.16 : 1);
    const acc = P.accel * (wantBoost ? 1.75 : 1) * (road ? 1 : 0.8);

    // ---- longitudinal ----
    let a = 0;
    if (thr > 0) {
      if (vf < -0.5) a += PHYS.brake;
      else { const r = Math.max(vf, 0) / vmax; a += acc * thr * Math.max(0, 1 - r * r); }
    }
    if (brk > 0) {
      if (vf > 0.5) a -= PHYS.brake * brk;
      else { const r = Math.max(-vf, 0) / PHYS.reverseMax; a -= PHYS.reverseAccel * brk * Math.max(0, 1 - r * r); }
    }
    if (thr === 0 && brk === 0) a -= Math.sign(vf) * Math.min(PHYS.coast, Math.abs(vf) / dt);
    a -= Math.sign(vf) * 0.00025 * vf * vf;                // aero drag
    if (vf > vmax) a -= (vf - vmax) * (road ? 0.9 : 2.4);   // bleed off overspeed (boost end / grass)
    if (hb) a -= Math.sign(vf) * 5;
    a -= Math.sign(vf) * Math.abs(vl) * 0.22;               // sliding scrubs speed
    vf += a * dt;
    if ((vf0 > 0 && vf < 0) || (vf0 < 0 && vf > 0)) vf = 0; // friction/brakes never flip direction
    this.accelLong = a;

    // ---- steering (smoothed input -> yaw rate, limited by tyre grip) ----
    const spd = Math.abs(vf);
    const target = clamp(inp.steer, -1, 1);
    let rate;
    if (Math.abs(target) < 0.01) rate = 7.5;
    else if (this.steer !== 0 && Math.sign(target) !== Math.sign(this.steer)) rate = 11;
    else rate = 5 - 2 * clamp(spd / 55, 0, 1);
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const yawMax = Math.min(2.4 * clamp(spd / 5, 0, 1), (PHYS.latAcc * gripMul) / Math.max(spd, 6));
    let yawT = -this.steer * yawMax * (vf >= -0.1 ? 1 : -1);
    if (hb) yawT *= 1.35;
    this.yawRate += (yawT - this.yawRate) * Math.min(1, 10 * dt);

    // ---- lateral grip: damp sideways velocity, keep most of the speed ----
    let grip = PHYS.baseGrip * gripMul;
    if (hb) grip *= 0.14;
    const avl = Math.abs(vl);
    if (avl > 5) grip *= clamp(1 - (avl - 5) * 0.035, 0.45, 1);
    const sp0 = Math.hypot(vf, vl);
    const vlBefore = vl;
    vl *= Math.exp(-grip * dt);
    const sp1 = Math.hypot(vf, vl);
    vf += Math.sign(vf || 1) * (sp0 - sp1) * 0.55;
    this.accelLat = (vlBefore - vl) / dt;

    // ---- integrate (convert back with the OLD basis; heading rotates afterwards) ----
    this.vx = vf * fx + vl * rx;
    this.vz = vf * fz + vl * rz;
    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vf = vf; this.vl = vl; this.speed = Math.hypot(vf, vl);

    // ---- slip / drift state ----
    this.slipAngle = Math.atan2(Math.abs(vl), Math.max(Math.abs(vf), 1));
    this.drifting = road && this.slipAngle > 0.2 && this.speed > 14;
    let skid = clamp((this.slipAngle - 0.14) * 3.2, 0, 1) * (this.speed > 8 ? 1 : 0);
    if (brk > 0.9 && vf > 22) skid = Math.max(skid, 0.45);
    this.skid = road ? skid : 0;

    // ---- boost meter ----
    if (wantBoost) this.boost -= 0.38 * dt;
    else if (this.drifting) this.boost += 0.2 * dt;
    else this.boost += 0.012 * dt;
    this.boost = clamp(this.boost, 0, 1);

    // ---- track query + walls ----
    const q = track.nearest(this.x, this.z, this.hint);
    this.q = q; this.hint = q.idx; this.lat = q.lat;
    this.onRoad = Math.abs(q.lat) <= track.half + 1.4;
    const wallLat = track.half + track.runoff - 1.1;
    this.contact = false;
    if (Math.abs(q.lat) > wallLat) {
      const side = Math.sign(q.lat), over = Math.abs(q.lat) - wallLat;
      this.x -= side * q.rx * over; this.z -= side * q.rz * over;
      const nx = -side * q.rx, nz = -side * q.rz; // inward normal
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const imp = -vn;
        this.vx -= 1.3 * vn * nx; this.vz -= 1.3 * vn * nz;
        const keep = 1 - Math.min(0.4, imp * 0.035);
        this.vx *= keep; this.vz *= keep;
        this.impact = Math.max(this.impact, imp);
      }
      this.contact = true;
      // ease the nose along the wall so the car never gets pinned head-on
      const dh = wrapAngle(track.heading[q.idx] - this.heading);
      if (Math.abs(dh) < Math.PI / 2) this.heading += dh * Math.min(1, 3 * dt);
      else this.heading += wrapAngle(track.heading[q.idx] + Math.PI - this.heading) * Math.min(1, 3 * dt);
      // wall damages drift: kill sideways energy
    }
  }
}

/** Soft circle-vs-circle bumping between all cars (two circles per car). */
export function collideCars(cars) {
  const off = PHYS.circleOffset, R = PHYS.radius;
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const B = cars[j];
      const dx0 = B.x - A.x, dz0 = B.z - A.z;
      if (dx0 * dx0 + dz0 * dz0 > 36) continue;
      const afx = Math.sin(A.heading), afz = Math.cos(A.heading);
      const bfx = Math.sin(B.heading), bfz = Math.cos(B.heading);
      for (let ca = -1; ca <= 1; ca += 2) {
        for (let cb = -1; cb <= 1; cb += 2) {
          const ax = A.x + afx * off * ca, az = A.z + afz * off * ca;
          const bx = B.x + bfx * off * cb, bz = B.z + bfz * off * cb;
          let dx = bx - ax, dz = bz - az;
          const d2 = dx * dx + dz * dz;
          if (d2 >= 4 * R * R || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          const pen = 2 * R - d;
          A.x -= dx * pen * 0.5; A.z -= dz * pen * 0.5;
          B.x += dx * pen * 0.5; B.z += dz * pen * 0.5;
          const rv = (B.vx - A.vx) * dx + (B.vz - A.vz) * dz; // closing speed is negative
          if (rv < 0) {
            const j2 = -(1 + 0.25) * rv * 0.5;
            A.vx -= j2 * dx; A.vz -= j2 * dz;
            B.vx += j2 * dx; B.vz += j2 * dz;
            const imp = -rv;
            A.impact = Math.max(A.impact, imp * 0.7); B.impact = Math.max(B.impact, imp * 0.7);
            // small yaw kick so contact feels physical
            A.yawRate -= clamp(dx * afz - dz * afx, -1, 1) * imp * 0.02 * ca;
            B.yawRate += clamp(dx * bfz - dz * bfx, -1, 1) * imp * 0.02 * cb;
          }
        }
      }
    }
  }
}

// --------------------------------------------------------------------------------------------
// Visuals
// --------------------------------------------------------------------------------------------

function extrudeProfile(points, width, bevel = 0.05) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1,
  });
  // shape x -> car z (forward), shape y -> car y, extrusion -> car x (centred)
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

const tireMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 0.9, roughness: 0.25 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1018, metalness: 0.2, roughness: 0.08, clearcoat: 1 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.6, metalness: 0.3 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const flameMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });

let sharedGeo = null;
function geo() {
  if (sharedGeo) return sharedGeo;
  const W = 1.9;
  sharedGeo = {
    lower: extrudeProfile([[-2.2, 0.3], [2.1, 0.3], [2.28, 0.46], [2.28, 0.72], [1.6, 0.86], [1.0, 0.94], [-1.6, 0.97], [-2.2, 0.9]], W),
    glass: extrudeProfile([[-1.5, 0.93], [-0.9, 1.36], [0.4, 1.36], [1.1, 0.93]], 1.7, 0.03),
    roof: new THREE.BoxGeometry(1.5, 0.05, 1.15),
    tire: (() => { const g = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 18); g.rotateZ(Math.PI / 2); return g; })(),
    rim: (() => { const g = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 10); g.rotateZ(Math.PI / 2); return g; })(),
    lamp: new THREE.BoxGeometry(0.42, 0.13, 0.06),
    tail: new THREE.BoxGeometry(1.5, 0.12, 0.05),
    stripe: new THREE.BoxGeometry(0.34, 0.012, 3.4),
    wingBlade: new THREE.BoxGeometry(1.75, 0.05, 0.42),
    wingPost: new THREE.BoxGeometry(0.06, 0.28, 0.1),
    flame: (() => { const g = new THREE.ConeGeometry(0.16, 1.4, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.7); return g; })(),
  };
  return sharedGeo;
}

/**
 * Builds a car model. Returns { root, body, frontWheels, wheels, flames, setBrake }.
 * root is yawed/positioned by the game; body takes roll & pitch.
 */
export function buildCarModel(color, opts = {}) {
  const g = geo();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const lower = new THREE.Mesh(g.lower, paint); lower.castShadow = true; body.add(lower);
  const glass = new THREE.Mesh(g.glass, glassMat); glass.castShadow = true; body.add(glass);
  const roof = new THREE.Mesh(g.roof, paint); roof.position.set(0, 1.385, -0.22); body.add(roof);

  if (opts.stripe !== false) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: opts.stripe || 0xf4f4f4, roughness: 0.4 });
    const s1 = new THREE.Mesh(g.stripe, stripeMat); s1.position.set(0, 0.985, -0.1); s1.scale.set(1, 1, 1); body.add(s1);
  }
  // lights
  for (const sx of [-0.62, 0.62]) {
    const l = new THREE.Mesh(g.lamp, headMat); l.position.set(sx, 0.6, 2.29); body.add(l);
  }
  const tail = new THREE.Mesh(g.tail, tailMat); tail.position.set(0, 0.74, -2.21); body.add(tail);
  // spoiler
  if (opts.wing !== false) {
    const wing = new THREE.Mesh(g.wingBlade, darkMat); wing.position.set(0, 1.28, -2.02); wing.castShadow = true; body.add(wing);
    for (const sx of [-0.55, 0.55]) { const p = new THREE.Mesh(g.wingPost, darkMat); p.position.set(sx, 1.1, -2.0); body.add(p); }
  }
  // boost flames
  const flames = [];
  for (const sx of [-0.5, 0.5]) {
    const f = new THREE.Mesh(g.flame, flameMat); f.position.set(sx, 0.42, -2.25); f.visible = false;
    const c = new THREE.Mesh(g.flame, flameCoreMat); c.scale.set(0.5, 0.5, 0.7); f.add(c);
    body.add(f); flames.push(f);
  }

  // wheels (front pivots steer; inner spin groups roll)
  const wheels = [], frontPivots = [];
  const wp = [[-0.96, 1.4, true], [0.96, 1.4, true], [-0.96, -1.38, false], [0.96, -1.38, false]];
  for (const [x, z, front] of wp) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.37, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(g.tire, tireMat); tire.castShadow = true;
    const rim = new THREE.Mesh(g.rim, rimMat);
    spin.add(tire, rim); pivot.add(spin); root.add(pivot);
    wheels.push(spin); if (front) frontPivots.push(pivot);
  }

  return { root, body, wheels, frontPivots, flames, paint, tailMat };
}
