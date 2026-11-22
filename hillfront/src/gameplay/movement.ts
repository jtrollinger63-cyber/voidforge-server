/**
 * Deterministic player movement, shared by the offline sim, the server and client prediction.
 * Units: metres, seconds. yaw rotates about +Y; yaw=0 faces -Z.
 */
import { World, STEP_HEIGHT } from '../map/world.ts';

export const PLAYER = {
  radius: 0.3,
  heightStand: 1.8,
  heightCrouch: 1.4,
  eyeStand: 1.64,
  eyeCrouch: 1.26,
  runSpeed: 5.2,
  walkSpeed: 2.7,
  crouchSpeed: 2.1,
  groundAccel: 48,
  groundFriction: 9,
  airAccel: 7,
  jumpSpeed: 5.4,
  gravity: 16,
  stepDown: 0.55,
  /** a stricter radius for hit tests than for movement blocking is not needed: same AABB */
} as const;

export interface MoveInput {
  /** -1..1 forward (+) / back (-) */
  fwd: number;
  /** -1..1 right (+) / left (-) */
  strafe: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  yaw: number;
}

export interface MoveState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  crouching: boolean;
  jumpCooldown: number;
  /** set true on the tick the player lands (consumers reset it) */
  justLanded: boolean;
  /** peak downward speed at landing, for fall damage / sound */
  landSpeed: number;
}

export function newMoveState(x = 0, y = 0.1, z = 0): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouching: false, jumpCooldown: 0, justLanded: false, landSpeed: 0 };
}

export function playerHeight(s: MoveState): number { return s.crouching ? PLAYER.heightCrouch : PLAYER.heightStand; }
export function eyeHeight(s: MoveState): number { return s.crouching ? PLAYER.eyeCrouch : PLAYER.eyeStand; }

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** Advance one fixed step. `speedMul` carries weapon-dependent movement scaling (0.8..1). */
export function stepMovement(world: World, s: MoveState, inp: MoveInput, dt: number, speedMul = 1): void {
  const r = PLAYER.radius;
  s.justLanded = false;
  if (s.jumpCooldown > 0) s.jumpCooldown -= dt;

  // crouch: can always crouch; can only stand if there is headroom
  if (inp.crouch) s.crouching = true;
  else if (s.crouching && !world.collides(s.x, s.y, s.z, r, PLAYER.heightStand)) s.crouching = false;
  const h = playerHeight(s);

  // wish direction
  const sin = Math.sin(inp.yaw), cos = Math.cos(inp.yaw);
  const fx = -sin, fz = -cos;          // forward
  const rx = cos, rz = -sin;           // right
  let wx = fx * inp.fwd + rx * inp.strafe;
  let wz = fz * inp.fwd + rz * inp.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const base = s.crouching ? PLAYER.crouchSpeed : inp.walk ? PLAYER.walkSpeed : PLAYER.runSpeed;
  const target = base * speedMul;

  if (s.onGround) {
    // friction when no input, accel toward wish velocity otherwise
    const tvx = wx * target, tvz = wz * target;
    const a = (wl > 0.01 ? PLAYER.groundAccel : PLAYER.groundFriction * 6) * dt;
    s.vx = approach(s.vx, tvx, a);
    s.vz = approach(s.vz, tvz, a);
  } else {
    const a = PLAYER.airAccel * dt;
    s.vx = approach(s.vx, wx * target, a);
    s.vz = approach(s.vz, wz * target, a);
  }

  if (inp.jump && s.onGround && s.jumpCooldown <= 0 && !s.crouching) {
    s.vy = PLAYER.jumpSpeed;
    s.onGround = false;
    s.jumpCooldown = 0.3;
  }

  // ---- horizontal, in sub-steps small enough to never tunnel ----
  const mx = s.vx * dt, mz = s.vz * dt;
  const dist = Math.hypot(mx, mz);
  const n = Math.max(1, Math.ceil(dist / 0.12));
  const sx = mx / n, sz = mz / n;
  for (let i = 0; i < n; i++) {
    if (sx !== 0 && !tryMove(world, s, sx, 0, r, h)) s.vx = 0;
    if (sz !== 0 && !tryMove(world, s, 0, sz, r, h)) s.vz = 0;
  }

  // ---- vertical ----
  if (s.onGround && s.vy <= 0) {
    const g = world.groundAt(s.x, s.z, s.y, r, STEP_HEIGHT);
    if (s.y - g <= PLAYER.stepDown) { s.y = g; s.vy = 0; }
    else { s.onGround = false; }
  }
  if (!s.onGround) {
    s.vy -= PLAYER.gravity * dt;
    let ny = s.y + s.vy * dt;
    if (s.vy > 0) {
      if (world.collides(s.x, ny, s.z, r, h)) { ny = s.y; s.vy = 0; }
      s.y = ny;
    } else {
      const g = world.groundAt(s.x, s.z, s.y, r, 0.02);
      if (ny <= g) {
        s.landSpeed = -s.vy;
        s.y = g; s.vy = 0; s.onGround = true; s.justLanded = true;
      } else s.y = ny;
    }
  }
}

function tryMove(world: World, s: MoveState, dx: number, dz: number, r: number, h: number): boolean {
  const nx = s.x + dx, nz = s.z + dz;
  if (!world.collides(nx, s.y, nz, r, h)) { s.x = nx; s.z = nz; return true; }
  // step up (stairs / low ledges), only when supported
  if (s.onGround) {
    const g = world.groundAt(nx, nz, s.y, r, STEP_HEIGHT);
    if (g > s.y && g - s.y <= STEP_HEIGHT + 1e-6 && !world.collides(nx, g + 0.002, nz, r, h)) {
      s.x = nx; s.z = nz; s.y = g; return true;
    }
  }
  return false;
}
