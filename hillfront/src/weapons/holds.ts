/**
 * How each CC0 weapon model sits in a hand. ONE table shared by the third-person soldier and the first-person viewmodel so the two can never disagree.
 *
 * All points are in WEAPON MODEL space (+Z = muzzle, +Y = up, +X = the gun's left side) and were read off the baked geometry's side profile
 * (tools/scratch/weapon-profile.ts), not guessed:
 *  - `grip`  centre of the pistol grip / knife handle  -> lands on the firing hand's palm.
 *  - `fore`  where the support palm rests, just under the handguard / forend (null = one-handed in the third-person animations).
 *  - `guard` z-range of a procedural handguard added to the thin bare-barrel kit models so the support hand has something to hold.
 *  - `barrelY` height of the barrel axis; `muzzleZ` the muzzle plane.
 */
import * as THREE from 'three';

export interface Hold {
  grip: [number, number, number];
  fore: [number, number, number] | null;
  guard?: [number, number];
  barrelY: number;
  muzzleZ: number;
}

export const HOLDS: Record<string, Hold> = {
  'attacker-rifle':   { grip: [0, 0.095, -0.20], fore: [0, 0.186, 0.135], guard: [0.03, 0.25], barrelY: 0.236, muzzleZ: 0.436 },
  'defender-carbine': { grip: [0, 0.095, -0.17], fore: [0, 0.186, 0.105], guard: [0.02, 0.20], barrelY: 0.236, muzzleZ: 0.369 },
  'full-smg':         { grip: [0, 0.095, -0.13], fore: [0, 0.186, 0.085], guard: [0.02, 0.15], barrelY: 0.236, muzzleZ: 0.292 },
  'pump-shotgun':     { grip: [0, 0.095, -0.21], fore: [0, 0.176, 0.13], barrelY: 0.236, muzzleZ: 0.474 },       // already has a forend
  'marksman-rifle':   { grip: [0, 0.095, -0.23], fore: [0, 0.186, 0.13], guard: [0.02, 0.26], barrelY: 0.236, muzzleZ: 0.508 },   // scope sits on the barrel above the palm
  'service-pistol':   { grip: [0, 0.095, -0.07], fore: null, barrelY: 0.136, muzzleZ: 0.127 },
  'combat-knife':     { grip: [0, 0.02, -0.11], fore: null, barrelY: 0.02, muzzleZ: 0.176 },
};
export const DEFAULT_HOLD: Hold = { grip: [0, 0.095, -0.12], fore: null, barrelY: 0.236, muzzleZ: 0.3 };

/** the procedural handguard: a faceted tube round the bare barrel + a thin top rail (indexed geometry, colours are flat per part) */
export function guardParts(z0: number, z1: number, barrelY = 0.236): { geo: THREE.BufferGeometry; color: [number, number, number] }[] {
  const len = z1 - z0, mid = (z0 + z1) / 2;
  const tube = new THREE.CylinderGeometry(0.031, 0.031, len, 10, 1, false); tube.rotateX(Math.PI / 2); tube.translate(0, barrelY, mid);
  const rail = new THREE.BoxGeometry(0.018, 0.012, len * 0.96); rail.translate(0, barrelY + 0.034, mid);
  return [{ geo: tube, color: [0.16, 0.17, 0.18] }, { geo: rail, color: [0.24, 0.25, 0.26] }];
}
