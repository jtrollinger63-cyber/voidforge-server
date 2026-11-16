// Vehicle dynamics: single-track (bicycle) model with axle tyre forces, longitudinal weight transfer,
// friction ellipse, RPM/gearbox/turbo, aero, surfaces, wall + car collisions and suspension state.
// Body frame: +u forward, +v LEFT, +r yaw rate (positive = turning left = heading increases).
// World: forward = (sin h, cos h), left = (cos h, -sin h).
import { torqueShape } from './cars.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const G = 9.81;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const SURFACES = {
  asphalt: { mu: 1.0, resist: 0, rumble: 0, kind: 'asphalt' },
  wet: { mu: 0.8, resist: 0, rumble: 0, kind: 'wet' },
  curb: { mu: 0.9, resist: 0.01, rumble: 1.0, kind: 'curb' },
  gravel: { mu: 0.72, resist: 0.06, rumble: 0.35, kind: 'gravel' },
  grass: { mu: 0.58, resist: 0.16, rumble: 0.3, kind: 'grass' },
  sand: { mu: 0.52, resist: 0.24, rumble: 0.25, kind: 'sand' },
  dirt: { mu: 0.62, resist: 0.12, rumble: 0.4, kind: 'dirt' },
};

export class Vehicle {
  constructor(spec, id = 0) {
    this.spec = spec; this.id = id;
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0;
    this.u = 0; this.v = 0; this.r = 0;            // body velocities
    this.vx = 0; this.vz = 0; this.speed = 0;      // world speed
    this.steerWheel = 0; this.delta = 0;
    this.throttle = 0; this.brakeIn = 0; this.handbrake = false;
    this.gear = 1; this.rpm = spec.idle; this.shiftT = 0; this.shiftDir = 0; this.reverse = false;
    this.turbo = 0; this.blowoff = 0; this.backfire = 0;
    this.nitro = 0.4; this.boosting = false; this.nitroCap = spec.nitroCap || 1;
    this.axL = 0; this.ayL = 0; this.ax = 0; this.ay = 0;
    this.alphaF = 0; this.alphaR = 0; this.beta = 0; this.drifting = false; this.driftAngle = 0;
    this.slipF = 0; this.slipR = 0; this.spinR = 0; this.skid = 0;
    this.FzF = 0; this.FzR = 0;
    this.q = {}; this.hint = -1; this.lat = 0; this.surface = SURFACES.asphalt; this.onRoad = true;
    this.gradX = 0; this.gradZ = 0;
    this.impact = 0; this.contact = false; this.hits = [];
    this.roll = 0; this.rollV = 0; this.pitch = 0; this.pitchV = 0; this.heave = 0; this.heaveV = 0;
    this.wheelAngle = [0, 0, 0, 0]; this.rumble = 0;
    this.cq = {};
    this.assist = 0.5;
  }

  place(td, idx, lat, heading0 = 0) {
    const N = td.N, i = ((idx % N) + N) % N;
    this.x = td.px[i] + td.rx[i] * lat; this.z = td.pz[i] + td.rz[i] * lat;
    this.heading = td.heading[i] + heading0;
    this.u = this.v = this.r = this.vx = this.vz = this.speed = 0; this.steerWheel = 0; this.delta = 0;
    this.gear = 1; this.rpm = this.spec.idle; this.turbo = 0; this.boosting = false; this.reverse = false;
    this.roll = this.pitch = this.heave = this.rollV = this.pitchV = this.heaveV = 0;
    this.axL = this.ayL = 0; this.hint = i; this.hits.length = 0;
    td.nearest(this.x, this.z, i, 18, this.q);
    this.lat = this.q.lat; this.y = td.roadY(this.q, this.lat);
  }

  /** world-space helpers */
  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }
  setWorldVelocity(vx, vz) {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    this.u = vx * s + vz * c; this.v = vx * c - vz * s; this.vx = vx; this.vz = vz;
  }

  /** ground height + surface + slope at the centre of gravity */
  sampleGround(world) {
    const { td, terrain, env } = world;
    const q = td.nearest(this.x, this.z, this.hint, 18, this.q);
    this.hint = q.idx; this.lat = q.lat;
    const a = Math.abs(q.lat), half = td.half;
    const wet = env && env.wet;
    let surf, y;
    if (a <= half) { surf = wet ? SURFACES.wet : SURFACES.asphalt; }
    else if (a <= half + 1.5) surf = SURFACES.curb;
    else if (a <= half + td.shoulder) surf = SURFACES.gravel;
    else surf = (env && env.offSurface && SURFACES[env.offSurface]) || SURFACES.grass;
    this.surface = surf; this.onRoad = a <= half + 1.5;
    if (a <= half + td.shoulder + 0.5) {
      y = td.roadY(q, q.lat);
      const gx = q.slope * td.tx[q.idx] + q.bank * q.rx, gz = q.slope * td.tz[q.idx] + q.bank * q.rz;
      this.gradX = gx; this.gradZ = gz;
    } else {
      y = terrain ? terrain.height(this.x, this.z) : 0;
      if (terrain) {
        const e = 1.5;
        this.gradX = (terrain.height(this.x + e, this.z) - y) / e;
        this.gradZ = (terrain.height(this.x, this.z + e) - y) / e;
      }
    }
    this.y = y;
    return q;
  }

  step(dt, inp, world) {
    const s = this.spec, td = world.td;
    const L = s.wheelbase, a = s.a, b = s.b, m = s.mass, W = m * G;
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    this.impact = 0; this.contact = false;
    this.sampleGround(world);
    if (this.held) { // on the grid: engine revs with the pedal, the car stays put
      const thr0 = clamp(inp && inp.throttle ? inp.throttle : this.throttle || 0, 0, 1);
      const tgt = s.idle + thr0 * (s.redline * 0.62 - s.idle);
      this.rpm += (tgt - this.rpm) * Math.min(1, 9 * dt); this.u = this.v = this.r = 0; this.vx = this.vz = this.speed = 0; this.throttle = thr0; this.brakeIn = 0;
      this.steerWheel *= 0.9; this.delta = 0; this.gear = 1; this.stepSuspension(dt, thr0); this.rumble = 0; this.skid = 0; this.boosting = false; return;
    }
    const surf = this.surface;
    const loose = s.loose && surf.mu < 0.8 ? s.loose : 1;
    const muSurf = surf.mu * (loose > 1 ? 1 + (loose - 1) * (1 - surf.mu) * 2 : 1);

    // ---------------- driver inputs ----------------
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const u = this.u, v = this.v, r = this.r;
    const speedAbs = Math.abs(u);
    // reverse logic: hold brake while (almost) stopped to engage reverse; throttle while rolling back brakes
    let driveCmd = thr, brakeCmd = brk, reverse = this.reverse;
    if (!reverse && brk > 0.1 && u < 1.0 && thr < 0.1) reverse = true;
    if (reverse && (thr > 0.1 || u > 1.5)) reverse = false;
    this.reverse = reverse;
    if (reverse) { driveCmd = brk; brakeCmd = thr; }
    this.throttle = thr; this.brakeIn = brk; this.handbrake = !!inp.handbrake;

    // steering: smoothed wheel + speed-sensitive lock + counter-steer assist
    const target = clamp(inp.steer, -1, 1);
    let rate;
    if (Math.abs(target) < 0.02) rate = 6.5;
    else if (this.steerWheel * target < 0) rate = 9.5;
    else rate = 4.6 - 1.6 * clamp(speedAbs / 60, 0, 1);
    this.steerWheel += clamp(target - this.steerWheel, -rate * dt, rate * dt);
    const lock = s.lock / (1 + Math.pow(speedAbs / s.steerSpeed, 2));
    let delta = -this.steerWheel * lock;
    const beta = Math.atan2(v, Math.max(speedAbs, 1));
    if (this.assist > 0 && speedAbs > 6 && u > 0) {
      // stability assist: steer into the slide, and back off steering that is making the slide worse
      const sp = sstep(6, 16, speedAbs);
      if (delta * beta < 0) delta *= 1 - this.assist * 0.9 * sstep(0.08, 0.4, Math.abs(beta)) * sp;
      delta += clamp(beta * 1.5 * this.assist, -0.45, 0.45) * sp * sstep(0.05, 0.2, Math.abs(beta));
    }
    this.delta = delta; this.beta = beta;

    // ---------------- engine & gearbox ----------------
    const ratioGear = reverse ? s.reverseRatio : s.ratios[this.gear - 1];
    const wheelSpd = speedAbs * (1 + this.spinR * 0.45);
    const rpmWheel = (wheelSpd / s.rw) * ratioGear * 30 / Math.PI;
    let rpmTarget = rpmWheel;
    const launch = (this.gear === 1 || reverse) ? 1 - sstep(0, 9, speedAbs) : 0;
    rpmTarget = Math.max(rpmWheel, s.idle + driveCmd * (s.redline * 0.52 - s.idle) * launch, s.idle + driveCmd * 600);
    this.rpm += (Math.min(rpmTarget, s.redline * 1.04) - this.rpm) * Math.min(1, 16 * dt);
    if (this.shiftT > 0) this.shiftT -= dt;
    if (!reverse) {
      if (this.shiftT <= 0) {
        if (this.rpm > s.redline * (0.9 + 0.04 * driveCmd) && this.gear < s.gears) { this.gear++; this.shiftT = 0.2; this.shiftDir = 1; this.rpm *= 0.78; this.backfire = s.engine.bark > 0.6 && driveCmd > 0.7 ? 1 : this.backfire; }
        else if (this.gear > 1 && this.rpm < s.redline * (brakeCmd > 0.2 ? 0.5 : driveCmd > 0.8 ? 0.58 : 0.42)) { this.gear--; this.shiftT = 0.16; this.shiftDir = -1; this.rpm = Math.min(s.redline * 0.9, this.rpm * 1.25); }
      }
    } else this.gear = 1;
    // turbo spool
    if (s.turbo > 0) {
      const tgt = driveCmd * sstep(0.28, 0.7, this.rpm / s.redline);
      const prev = this.turbo;
      this.turbo += (tgt - this.turbo) * Math.min(1, (tgt > this.turbo ? 2.6 : 5) * dt);
      if (prev > 0.55 && driveCmd < 0.2 && this.turbo < prev - 0.002) this.blowoff = 1;
    }
    this.blowoff = Math.max(0, this.blowoff - dt * 3);
    this.backfire = Math.max(0, this.backfire - dt * 4);

    // nitro
    const wantNitro = !!inp.boost && this.nitro > 0.01 && driveCmd > 0.3 && !reverse;
    this.boosting = wantNitro;
    if (wantNitro) this.nitro -= (1 / (3.2 * this.nitroCap)) * dt; this.nitro = clamp(this.nitro, 0, this.nitroCap);
    // torque
    let torque = 0;
    const x = this.rpm / s.redline;
    if (x < 1.0) torque = s.torquePeak * torqueShape(x) * driveCmd * (1 + s.turbo * 0.9 * this.turbo) * (wantNitro ? 1 + s.nitroForce : 1); // rev limiter above redline
    if (this.shiftT > 0) torque *= 0.15;
    let Fdrive = (torque * ratioGear * s.eta) / s.rw * (reverse ? -1 : 1);

    // ---------------- axle loads ----------------
    const dfTot = s.downK * u * u;
    const FzFstat = W * (b / L), FzRstat = W * (a / L);
    let FzF = FzFstat - (m * this.axL * s.cgH) / L + dfTot * 0.44;
    let FzR = FzRstat + (m * this.axL * s.cgH) / L + dfTot * 0.56;
    FzF = Math.max(FzF, W * 0.12); FzR = Math.max(FzR, W * 0.12);
    this.FzF = FzF; this.FzR = FzR;
    // lateral weight transfer reduces axle grip (stiffer axle loses more)
    const lt = Math.min(1.4, Math.abs(this.ayL) * s.cgH / (s.trackW * G));
    const ltK = 0.65 * lt * lt;
    const fF = 1 - ltK * 2 * s.rollF, fR = 1 - ltK * 2 * (1 - s.rollF);
    const sens = (Fz, mu, f) => mu * muSurf * f * Math.pow(Fz, 0.9) * Math.pow(W / 2, 0.1);
    let DF = sens(FzF, s.muF, fF), DR = sens(FzR, s.muR, fR);
    if (this.handbrake) DR *= 0.62;

    // ---------------- longitudinal axle forces ----------------
    const dirSign = clamp(u / 0.6, -1, 1);
    const Fbrake = brakeCmd * s.brakeG * W * dirSign;
    let FxF = 0, FxR = 0;
    if (s.drive === 'RWD') FxR += Fdrive; else if (s.drive === 'FWD') FxF += Fdrive; else { FxF += Fdrive * 0.38; FxR += Fdrive * 0.62; }
    // electronic brake-force distribution: split the braking by the *current* axle loads so neither axle locks first
    const biasF = clamp(FzF / (FzF + FzR) + 0.03, 0.5, 0.88);
    FxF -= Fbrake * biasF; FxR -= Fbrake * (1 - biasF);
    if (this.handbrake) FxR -= dirSign * W * 0.3;
    const capF = DF * 0.98, capR = DR * 0.98;
    const overR = Math.abs(FxR) > capR ? (Math.abs(FxR) - capR) / Math.max(capR, 1) : 0;
    this.spinR += (clamp(overR * (Fdrive !== 0 ? 1 : 0), 0, 1) - this.spinR) * Math.min(1, 14 * dt);
    this.lockR = this.handbrake ? 1 : 0;
    FxF = clamp(FxF, -capF, capF); FxR = clamp(FxR, -capR, capR);

    // ---------------- lateral axle forces ----------------
    let FyF = 0, FyR = 0;
    const kin = reverse || u < 0.5;
    const uu = Math.max(Math.abs(u), 2.5);
    const alphaF = Math.atan2(v + a * r, uu) - delta;
    const alphaR = Math.atan2(v - b * r, uu);
    this.alphaF = alphaF; this.alphaR = alphaR;
    if (!kin) {
      const Bf = s.B * 1.04, Br = s.B * (s.drive === 'RWD' ? 0.96 : 1.0);
      const ellF = Math.max(0.5, Math.sqrt(Math.max(0, 1 - Math.pow(FxF / Math.max(DF, 1), 2))));
      const ellR = Math.max(0.5, Math.sqrt(Math.max(0, 1 - Math.pow(FxR / Math.max(DR, 1), 2))));
      const lowFade = sstep(1.0, 4.0, Math.abs(u));
      FyF = -DF * Math.sin(1.5 * Math.atan(Bf * alphaF)) * ellF * lowFade;
      FyR = -DR * Math.sin(1.5 * Math.atan(Br * alphaR)) * ellR * lowFade;
    }
    this.slipF = Math.abs(alphaF); this.slipR = Math.abs(alphaR);

    // ---------------- resistive forces ----------------
    let Fres = s.dragK * u * Math.abs(u) + s.crr * W * clamp(u / 0.5, -1, 1);
    Fres += surf.resist * W * clamp(u / 1.0, -1, 1) * (surf.kind === 'asphalt' ? 0 : 1);
    if (this.speed < 0.3 && driveCmd === 0 && brakeCmd === 0) Fres += 0; // parked

    // ---------------- equations of motion ----------------
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const FxB = FxF * cd - FyF * sd + FxR - Fres;
    const FyB = FxF * sd + FyF * cd + FyR;
    let Mz = a * (FxF * sd + FyF * cd) - b * FyR;
    Mz -= s.Iz * 1.5 * r * sstep(3, 12, speedAbs);  // yaw damping (stability)
    // drift stabiliser: the further the car points from its direction of travel, the harder the nose is pulled back,
    // so slides settle into controllable 20-50 degree drifts instead of spinning out
    if (u > 0) Mz += s.Iz * 7.5 * Math.sign(beta) * sstep(0.4, 0.95, Math.abs(beta)) * (0.35 + 0.65 * this.assist) * sstep(5, 13, speedAbs);
    const slopeX = -G * (this.gradX * sinH + this.gradZ * cosH);
    const slopeY = -G * (this.gradX * cosH - this.gradZ * sinH);
    let du = FxB / m + r * v + slopeX;
    let dv = FyB / m - r * u + slopeY;
    let dr = Mz / s.Iz;
    this.ax = FxB / m; this.ay = (FyB / m);
    this.axL += (this.ax - this.axL) * Math.min(1, 7 * dt);
    this.ayL += (this.ay - this.ayL) * Math.min(1, 7 * dt);
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;

    // low-speed / reverse: kinematic steering, lateral damping
    const kb = kin ? 1 : clamp(1 - speedAbs / 5, 0, 1);
    if (kb > 0) {
      const rk = (this.u * Math.tan(delta)) / L;
      this.r += (rk - this.r) * Math.min(1, 10 * dt) * kb;
      this.v *= Math.exp(-kb * 9 * dt);
    }
    // parking brake: stop dead when nothing is pressed at walking pace
    if (driveCmd < 0.02 && brakeCmd < 0.02 && Math.abs(this.u) < 0.35 && Math.abs(this.v) < 0.35) { this.u *= Math.exp(-6 * dt); this.v *= Math.exp(-6 * dt); }

    // ---------------- integrate position ----------------
    const s2 = Math.sin(this.heading), c2 = Math.cos(this.heading);
    this.vx = this.u * s2 + this.v * c2; this.vz = this.u * c2 - this.v * s2;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.heading += this.r * dt;
    this.speed = Math.hypot(this.vx, this.vz);

    // ---------------- drift state / skid amount ----------------
    this.driftAngle = Math.abs(Math.atan2(this.v, Math.max(Math.abs(this.u), 1)));
    this.drifting = this.driftAngle > 0.2 && this.speed > 10 && this.onRoad && u > 0;
    const slipSkid = clamp((Math.max(this.slipR, this.slipF) - 0.16) * 3.5, 0, 1);
    const brakeSkid = brk > 0.85 && this.u > 18 ? 0.4 : 0;
    const spinSkid = clamp(this.spinR * 1.2, 0, 1) * (this.speed < 30 ? 1 : 0.5);
    this.skid = this.surface.kind === 'asphalt' || this.surface.kind === 'wet' || this.surface.kind === 'curb'
      ? Math.max(slipSkid * (this.speed > 6 ? 1 : 0), brakeSkid, spinSkid) : 0;

    // nitro recharge: drifting & clean driving charge it
    if (!wantNitro) {
      if (this.drifting) this.nitro += 0.14 * dt;
      else this.nitro += 0.006 * dt;
      this.nitro = clamp(this.nitro, 0, this.nitroCap);
    }

    // ---------------- walls ----------------
    this.collideWalls(world, dt);

    // ---------------- suspension (cosmetic dynamics) ----------------
    this.stepSuspension(dt, thr);
  }

  stepSuspension(dt, thr) {
    const s = this.spec, g = 1 / G;
    const rollT = s.rollK * this.ayL * g;               // + = right side down (leaning outward in a left turn)
    const pitchT = -s.pitchK * this.axL * g;            // accel -> nose up
    const w = 11.5, z = 0.48;
    this.rollV += (w * w * (rollT - this.roll) - 2 * z * w * this.rollV) * dt; this.roll += this.rollV * dt;
    this.pitchV += (w * w * (pitchT - this.pitch) - 2 * z * w * this.pitchV) * dt; this.pitch += this.pitchV * dt;
    // surface rumble kicks the heave spring
    const rum = this.surface.rumble * clamp(this.speed / 40, 0, 1);
    this.rumble = rum;
    if (rum > 0) this.heaveV += (Math.random() - 0.5) * 3.2 * rum * (dt * 120) * 0.12;
    const wh = 15;
    this.heaveV += (wh * wh * (-this.heave) - 2 * 0.38 * wh * this.heaveV) * dt; this.heave += this.heaveV * dt;
    this.heave = clamp(this.heave, -0.12, 0.12);
    // wheel spin angles (visual): front/rear, left/right
    const rot = (this.u * dt) / s.rw;
    this.wheelAngle[0] += rot; this.wheelAngle[1] += rot;
    this.wheelAngle[2] += rot * (1 + this.spinR * 3 * (this.u >= 0 ? 1 : 0)); this.wheelAngle[3] += rot * (1 + this.spinR * 3 * (this.u >= 0 ? 1 : 0));
  }

  /** barrier collision with the four body corners (impulse with rotation) */
  collideWalls(world, dt) {
    const td = world.td, s = this.spec;
    const wallLat = td.half + td.runoff;
    const sH = Math.sin(this.heading), cH = Math.cos(this.heading);
    const hl = s.length / 2 - 0.15, hw = s.width / 2 - 0.05;
    const pts = [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [hw, 0], [-hw, 0]];
    let guard = 0;
    for (const [xl, zl] of pts) {
      const cx = this.x + xl * cH + zl * sH, cz = this.z - xl * sH + zl * cH;
      const q = td.nearest(cx, cz, this.hint, 14, this.cq);
      const pen = Math.abs(q.lat) - wallLat;
      if (pen <= 0) continue;
      const side = Math.sign(q.lat);
      const nx = -side * q.rx, nz = -side * q.rz;                // inward normal
      this.x += nx * pen; this.z += nz * pen;                    // positional correction
      const px = cx - this.x, pz = cz - this.z;
      const vcx = this.vx + this.r * pz, vcz = this.vz - this.r * px;
      const vn = vcx * nx + vcz * nz;
      this.contact = true;
      if (vn < 0) {
        const cN = nx * pz - nz * px;
        const j = (-(1 + 0.22) * vn) / (1 / s.mass + (cN * cN) / s.Iz);
        let nvx = this.vx + (j * nx) / s.mass, nvz = this.vz + (j * nz) / s.mass;
        let nr = this.r + (j * nx * pz - j * nz * px) / s.Iz;
        // friction along the wall
        const tx = -nz, tz = nx, vt = vcx * tx + vcz * tz;
        const cT = tx * pz - tz * px;
        let jt = -vt / (1 / s.mass + (cT * cT) / s.Iz);
        jt = clamp(jt, -0.35 * j, 0.35 * j);
        nvx += (jt * tx) / s.mass; nvz += (jt * tz) / s.mass; nr += (jt * tx * pz - jt * tz * px) / s.Iz;
        this.setWorldVelocity(nvx, nvz); this.r = nr;
        const imp = -vn;
        if (imp > this.impact) { this.impact = imp; this.hitLocal = [xl, zl]; }
        if (imp > 3 && this.hits.length < 6) this.hits.push({ x: xl, z: zl, s: Math.min(1, imp / 22), nx, nz });
      }
      if (++guard > 6) break;
    }
    if (this.contact) this.speed = Math.hypot(this.vx, this.vz);
  }
}

/** Vehicle-vs-vehicle contact: three circles per car, impulses with rotation. Returns nothing; sets impact/hits. */
export function collideVehicles(list) {
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const B = list[j];
      const ddx = B.x - A.x, ddz = B.z - A.z;
      const reach = (A.spec.length + B.spec.length) * 0.5 + 0.5;
      if (ddx * ddx + ddz * ddz > reach * reach) continue;
      const aS = Math.sin(A.heading), aC = Math.cos(A.heading), bS = Math.sin(B.heading), bC = Math.cos(B.heading);
      const rA = A.spec.width * 0.54, rB = B.spec.width * 0.54;
      for (const oa of [-0.3, 0, 0.3]) {
        for (const ob of [-0.3, 0, 0.3]) {
          const ax = A.x + aS * oa * A.spec.length, az = A.z + aC * oa * A.spec.length;
          const bx = B.x + bS * ob * B.spec.length, bz = B.z + bC * ob * B.spec.length;
          let dx = bx - ax, dz = bz - az;
          const d2 = dx * dx + dz * dz, rr = rA + rB;
          if (d2 >= rr * rr || d2 < 1e-8) continue;
          const d = Math.sqrt(d2); dx /= d; dz /= d;
          const pen = rr - d;
          const mA = A.spec.mass, mB = B.spec.mass, tot = mA + mB;
          A.x -= dx * pen * (mB / tot); A.z -= dz * pen * (mB / tot);
          B.x += dx * pen * (mA / tot); B.z += dz * pen * (mA / tot);
          const pax = ax - A.x + dx * rA * 0.0, paz = az - A.z, pbx = bx - B.x, pbz = bz - B.z;
          const vAx = A.vx + A.r * paz, vAz = A.vz - A.r * pax, vBx = B.vx + B.r * pbz, vBz = B.vz - B.r * pbx;
          const rv = (vBx - vAx) * dx + (vBz - vAz) * dz;
          if (rv >= 0) continue;
          const cA = dx * paz - dz * pax, cB = dx * pbz - dz * pbx;
          const jn = (-(1 + 0.18) * rv) / (1 / mA + 1 / mB + (cA * cA) / A.spec.Iz + (cB * cB) / B.spec.Iz);
          A.setWorldVelocity(A.vx - (jn * dx) / mA, A.vz - (jn * dz) / mA); A.r -= (jn * dx * paz - jn * dz * pax) / A.spec.Iz;
          B.setWorldVelocity(B.vx + (jn * dx) / mB, B.vz + (jn * dz) / mB); B.r += (jn * dx * pbz - jn * dz * pbx) / B.spec.Iz;
          const imp = -rv;
          A.impact = Math.max(A.impact, imp * (mB / tot) * 1.4); B.impact = Math.max(B.impact, imp * (mA / tot) * 1.4);
          A.contact = B.contact = true;
          if (imp > 2.5) {
            // local impact point for dents
            const lxA = (bx - A.x) * aC - (bz - A.z) * aS, lzA = (bx - A.x) * aS + (bz - A.z) * aC;
            const lxB = (ax - B.x) * bC - (az - B.z) * bS, lzB = (ax - B.x) * bS + (az - B.z) * bC;
            if (A.hits.length < 6) A.hits.push({ x: Math.sign(lxA) * A.spec.width / 2, z: clamp(lzA, -A.spec.length / 2, A.spec.length / 2), s: Math.min(1, imp / 22), nx: dx, nz: dz });
            if (B.hits.length < 6) B.hits.push({ x: Math.sign(lxB) * B.spec.width / 2, z: clamp(lzB, -B.spec.length / 2, B.spec.length / 2), s: Math.min(1, imp / 22), nx: -dx, nz: -dz });
          }
        }
      }
    }
  }
}
