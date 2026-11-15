// AI driver: pure-pursuit steering toward a racing line, curvature-based braking, simple avoidance.
// It produces the same input struct as the player, so AI cars obey the exact same physics.
import { SPACING } from './trackmath.js';
import { PHYS, clamp, wrapAngle } from './car.js';

/** Precompute an approximate racing line (lateral offset per sample, + = right). */
export function buildRacingLine(track) {
  const { N, curv, half } = track;
  const smoothed = new Float32Array(N);
  const r = 14;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += curv[((i + k) % N + N) % N];
    smoothed[i] = s / (2 * r + 1);
  }
  const line = new Float32Array(N);
  const usable = half - 4.5;
  for (let i = 0; i < N; i++) {
    // left turn (curv > 0) -> hug the left (negative lat), right turn -> hug the right
    line[i] = clamp(-smoothed[i] * 110, -1, 1) * usable;
  }
  return { line, usable };
}

export function makeAIState(skill, personal) {
  return { skill, personal, avoid: 0, stuck: 0, boostAt: 0.6 + Math.random() * 0.4 };
}

/**
 * @param car      CarBody (with .ai state)
 * @param track    trackmath data
 * @param racing   result of buildRacingLine
 * @param others   other CarBody instances (for avoidance)
 * @param speedMul rubber-band multiplier
 */
export function aiDrive(car, track, racing, others, speedMul = 1, dt = 1 / 60) {
  const ai = car.ai;
  const { N, px, pz, curv, half } = track;
  const q = car.q;
  const speed = Math.max(car.vf, 0);

  // ---- avoidance: pick a lateral nudge away from cars just ahead ----
  let want = 0;
  for (const o of others) {
    if (o === car || !o.q) continue;
    let di = o.q.idx - q.idx; if (di > N / 2) di -= N; else if (di < -N / 2) di += N;
    const ahead = di * SPACING;
    if (ahead > -3 && ahead < 8 + speed * 0.7) {
      const dl = o.lat - car.lat;
      if (Math.abs(dl) < 3.6) {
        const room = dl > 0 ? (car.lat + half - 3) : (half - 3 - car.lat); // space on the far side
        want += (dl > 0 ? -1 : 1) * Math.min(3.6, 3.6 - Math.abs(dl) + 1.2) * (room > 2 ? 1 : 0.2);
      }
    }
  }
  ai.avoid += (clamp(want, -4, 4) - ai.avoid) * Math.min(1, 3 * dt);

  // ---- target point ----
  const look = clamp(9 + speed * 0.55, 11, 48);
  const iAhead = (q.idx + Math.round(look / SPACING)) % N;
  const lat = clamp(racing.line[iAhead] * ai.skill + ai.personal + ai.avoid, -(half - 3), half - 3);
  const tx = px[iAhead] + track.rx[iAhead] * lat;
  const tz = pz[iAhead] + track.rz[iAhead] * lat;
  const desired = Math.atan2(tx - car.x, tz - car.z);
  const err = wrapAngle(desired - car.heading); // + = target is to the left
  const dist = Math.hypot(tx - car.x, tz - car.z) || 1;
  const omegaNeeded = (Math.max(speed, 6) * 2 * Math.sin(err)) / dist; // pure pursuit, rad/s (left positive)
  const yawMax = Math.min(2.4, (PHYS.latAcc * car.perf.gripMul) / Math.max(speed, 6));
  let steer = clamp(-omegaNeeded / yawMax, -1, 1);
  if (Math.abs(err) > 1.2) steer = -Math.sign(err); // badly off line: full lock

  // ---- speed target from upcoming curvature (brake in time) ----
  const aLat = PHYS.latAcc * 0.8 * ai.skill * car.perf.gripMul;
  const aBrake = 21;
  let vTarget = car.perf.topSpeed * speedMul;
  const span = Math.min(110, Math.ceil((speed * speed) / (2 * aBrake) / SPACING) + 24);
  for (let k = 0; k < span; k += 2) {
    const i = (q.idx + k) % N;
    const c = Math.abs(curv[i]);
    if (c < 1e-4) continue;
    const vc = Math.sqrt(aLat / c);
    const v = Math.sqrt(vc * vc + 2 * aBrake * k * SPACING);
    if (v < vTarget) vTarget = v;
  }
  if (Math.abs(err) > 0.5) vTarget = Math.min(vTarget, 14); // recover from big heading errors slowly

  let throttle = 0, brake = 0;
  const dv = vTarget - car.vf;
  if (dv > 0) throttle = clamp(dv / 3, 0, 1);
  else brake = clamp(-dv / 5, 0, 1) > 0.15 ? clamp(-dv / 5, 0, 1) : 0;

  // ---- unstick: if barely moving for a while, back out ----
  if (car.speed < 1.5 && throttle > 0.5) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  let reverse = false;
  if (ai.stuck > 1.6) {
    reverse = true;
    if (ai.stuck > 3.2) ai.stuck = 0;
  }
  if (reverse) { throttle = 0; brake = 1; steer = -steer; }

  // use boost on straights when the meter is full-ish
  const boost = car.boost > ai.boostAt && Math.abs(curv[q.idx]) < 0.002 && Math.abs(err) < 0.1 && !reverse;
  return { throttle, brake, steer, handbrake: false, boost };
}
