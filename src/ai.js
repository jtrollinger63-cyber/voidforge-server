// AI driver for the new vehicle model: racing line, grip-aware braking, pure-pursuit steering,
// overtaking / defending, rubber-banding and crash recovery.
import { SPACING } from './trackmath.js';
import { clamp, wrapAngle, lerp } from './vehicle.js';

const G = 9.81;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function buildRacingLine(td) {
  const { N, curv, half } = td;
  const sm = new Float32Array(N), r = 16;
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -r; k <= r; k++) s += curv[((i + k) % N + N) % N]; sm[i] = s / (2 * r + 1); }
  const usable = half - 2.8, line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = clamp(-sm[i] * 150, -1, 1) * usable;   // hug the inside of the corner
  // smooth the lateral target so it never jerks
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -6; k <= 6; k++) s += line[((i + k) % N + N) % N]; out[i] = s / 13; }
  return { line: out, usable };
}

export function makeAI(diff, rnd = Math.random) {
  return {
    skill: diff.skill * (0.975 + rnd() * 0.05), aggr: clamp(diff.aggr + (rnd() - 0.5) * 0.3, 0.05, 1), mistakes: diff.mistakes,
    offset: (rnd() - 0.5) * 2.4, grip: 0.92, lane: 0, laneT: 0, stuck: 0, offT: 0, recoverT: 0, reversing: 0, mistakeT: 4 + rnd() * 12, slipT: 0, signal: 0, boostWait: rnd() * 2,
  };
}

/**
 * @returns input {throttle, brake, steer(+right), handbrake, boost}
 */
export function aiDrive(v, ai, td, line, others, ctx) {
  const { dt, speedMul = 1, wet = false, time } = ctx;
  const s = v.spec, q = v.q;
  const u = Math.max(v.u, 0);
  const half = td.half;

  // ----- traffic awareness: find cars just ahead and alongside
  let wantLane = 0, closing = 0, blocked = null;
  for (const o of others) {
    if (o === v || !o.q || !o.q.idx && o.q.idx !== 0) continue;
    let di = o.q.idx - q.idx; if (di > td.N / 2) di -= td.N; else if (di < -td.N / 2) di += td.N;
    const ahead = di * SPACING;
    if (ahead > 1 && ahead < 14 + u * 0.55) {
      const dl = o.lat - v.lat;
      if (Math.abs(dl) < 3.4) { const rel = u - Math.max(o.u, 0); if (!blocked || ahead < blocked.d) blocked = { d: ahead, o, dl, rel }; }
    } else if (Math.abs(ahead) < 5.5) {                 // side by side: leave room
      const dl = o.lat - v.lat; if (Math.abs(dl) < 3.2) wantLane += (dl > 0 ? -1 : 1) * (3.2 - Math.abs(dl)) * 0.9;
    }
  }
  if (blocked) {
    const room = (side) => (side > 0 ? half - 2.2 - v.lat : half - 2.2 + v.lat);
    const pass = blocked.dl > 0 ? -1 : 1;                      // pass on the side away from the blocker
    const side = room(pass) > 3.2 ? pass : -pass;
    if (blocked.rel > -1 || ai.aggr > 0.6) wantLane += side * (2.6 + ai.aggr * 1.8);
    closing = clamp((blocked.d - 5) / 25, 0, 1);               // lift off when very close behind someone
  }
  ai.lane += (clamp(wantLane, -5, 5) - ai.lane) * Math.min(1, 2.6 * dt);

  // ----- target point on the racing line
  const lim = half - 2.0;
  let look = clamp(14 + u * 0.62, 18, 80);
  let iA = (q.idx + Math.round(look / SPACING)) % td.N;
  let lat = clamp(line.line[iA] * 0.95 + ai.offset + ai.lane, -lim, lim);
  // far from the line (after a bump or a slide): aim closer so the car comes back quickly instead of scraping the barrier
  const offLine = Math.abs(v.lat - lat);
  if (offLine > 2.5) { look *= clamp(1.2 - offLine / 8, clamp(0.35 + u * 0.011, 0.35, 0.85), 1); iA = (q.idx + Math.round(look / SPACING)) % td.N; lat = clamp(line.line[iA] * 0.95 + ai.offset + ai.lane, -lim, lim); }
  const tx = td.px[iA] + td.rx[iA] * lat, tz = td.pz[iA] + td.rz[iA] * lat;
  const err = wrapAngle(Math.atan2(tx - v.x, tz - v.z) - v.heading);       // + = target is to the left
  const dist = Math.max(8, Math.hypot(tx - v.x, tz - v.z));
  const kappa = (2 * Math.sin(err)) / dist;                                  // left-positive curvature
  const dReq = Math.atan(s.wheelbase * kappa);                               // front wheel angle (left +)
  const lock = s.lock / (1 + Math.pow(Math.abs(v.u) / s.steerSpeed, 2));
  let steer = clamp(-dReq / Math.max(lock, 0.02), -1, 1);
  // damp yaw: compare the yaw rate we are producing with the one the path needs
  const rNeed = v.u * kappa;
  steer += clamp((v.r - rNeed) * 0.45, -0.5, 0.5) * (u > 10 ? 1 : 0) * sstep(10, 25, u);
  if (Math.abs(err) > 1.1) steer = -Math.sign(err);

  // ----- speed plan: cornering limit from curvature, braking limit from grip
  // online grip estimate: tyres near their slip peak -> assume less grip; comfortably inside -> creep back up
  const slipPeak = 1.73 / s.B;
  const pressed = Math.max(v.slipF / (slipPeak * 1.0), v.slipR / (slipPeak * 1.1));
  if (pressed > 0.55 && v.u > 12) ai.grip -= (pressed - 0.55) * 0.9 * dt * 4; else ai.grip += 0.04 * dt;
  ai.grip = clamp(ai.grip, 0.55, 0.98);
  const mu = ((s.muF + s.muR) / 2) * (wet ? 0.8 : 1) * ai.skill * ai.grip * speedMul * 0.94;
  const kdf = (s.df / (55.6 * 55.6)) * 0.8;
  const aBrake = s.brakeG * G * 0.66 * ai.skill;
  let vT = (s.topKmh / 3.6) * 0.995 * clamp(speedMul, 0.85, 1.12) * clamp(ai.skill + 0.02, 0.8, 1.02);
  const span = Math.min(160, Math.ceil((u * u) / (2 * aBrake) / SPACING) + 26);
  for (let k = 0; k < span; k += 2) {
    const i = (q.idx + k) % td.N, c = Math.abs(td.curv[i]) + 0.0005;
    const den = c - mu * G * kdf;
    const vc = den > 1e-5 ? Math.sqrt((mu * G) / den) : 400;
    const vk = Math.sqrt(vc * vc + 2 * aBrake * k * SPACING);
    if (vk < vT) vT = vk;
  }
  vT *= 1 - closing * 0.12;
  if (offLine > 3.5 || Math.abs(v.lat) > half + 0.8) vT = Math.min(vT, Math.max(16, 52 - offLine * 4));
  if (blocked && blocked.d < 9 && Math.abs(blocked.dl) < 2.2 && blocked.rel > 0) vT = Math.min(vT, Math.max(blocked.o.u - 2, 8));
  // occasional human-like mistakes
  ai.mistakeT -= dt;
  if (ai.mistakeT <= 0 && ai.mistakes > 0.02) { ai.mistakeT = 6 + Math.random() * 24 / (0.3 + ai.mistakes); if (Math.random() < ai.mistakes) ai.slipT = 0.8 + Math.random() * 0.8; }
  if (ai.slipT > 0) { ai.slipT -= dt; vT *= 1.12; steer += Math.sin(time * 9) * 0.2; }
  if (Math.abs(err) > 0.55) vT = Math.min(vT, 12);

  let throttle = 0, brake = 0;
  const dv = vT - v.u;
  if (dv > 0) throttle = clamp(dv / 3.5, 0, 1);
  else brake = clamp(-dv / 4.5, 0, 1) > 0.12 ? clamp(-dv / 4.5, 0, 1) : 0;
  // traction control: back off when the rear steps out or the tyres spin
  const slipR = Math.abs(v.alphaR);
  if (v.spinR > 0.12) throttle *= 0.55;
  if (slipR > 0.09 && v.u > 8) throttle *= clamp(1 - (slipR - 0.09) * 7, 0.1, 1);

  // ----- recovery: stuck / off track / facing the wrong way
  const offTrack = Math.abs(v.lat) > half + td.shoulder + 2;
  const wrongWay = Math.cos(wrapAngle(td.heading[q.idx] - v.heading)) < -0.3;
  if (v.speed < 2.5 && throttle > 0.4) { ai.stuck += dt; ai.stuckTotal = (ai.stuckTotal || 0) + dt; } else { ai.stuck = Math.max(0, ai.stuck - dt * 2); if (v.speed > 6) ai.stuckTotal = 0; }
  if (offTrack || wrongWay) ai.offT += dt; else ai.offT = Math.max(0, ai.offT - dt * 2);
  let respawn = false, reverse = false;
  if (ai.stuck > 1.2) { reverse = true; if (ai.stuck > 2.6) ai.stuck = 0; }
  if (ai.offT > 4.5 || (ai.stuckTotal || 0) > 4.5) { respawn = true; ai.stuckTotal = 0; }
  if (reverse) { throttle = 0; brake = 1; steer = -steer; }

  // nitro on straights
  ai.boostWait -= dt;
  const straight = Math.abs(td.curv[q.idx]) < 0.0015 && Math.abs(err) < 0.08 && vT > v.u + 6;
  const boost = straight && v.nitro > 0.45 + ai.aggr * 0.2 && ai.boostWait < 0 && !reverse;
  if (!straight) ai.boostWait = Math.max(ai.boostWait, 0);
  ai.signal = steer > 0.35 && u < 28 ? 1 : steer < -0.35 && u < 28 ? -1 : 0;
  return { throttle, brake, steer, handbrake: false, boost, respawn };
}
