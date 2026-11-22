/**
 * Static collision world shared by client prediction, offline bots and the authoritative server.
 * Pure TypeScript: no DOM, no three.js.
 *
 * Model: a flat floor plane + axis-aligned boxes + walkable ramps (stairs). Players are AABBs
 * (feet-centred). Visual meshes are never used for collision.
 */

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; tag?: string; }

/** A walkable slope. Height interpolates from y0 to y1 along `dir` across the rectangle. */
export interface Ramp {
  x0: number; x1: number; z0: number; z1: number;
  y0: number; y1: number;
  /** direction of ascent: 0=+x 1=-x 2=+z 3=-z */
  dir: 0 | 1 | 2 | 3;
}

export interface RayHit { t: number; nx: number; ny: number; nz: number; kind: 'box' | 'ramp' | 'floor'; index: number; }

export const STEP_HEIGHT = 0.52;
const EPS = 1e-4;

export function rampHeightAt(r: Ramp, x: number, z: number): number {
  let t: number;
  switch (r.dir) {
    case 0: t = (x - r.x0) / (r.x1 - r.x0); break;
    case 1: t = (r.x1 - x) / (r.x1 - r.x0); break;
    case 2: t = (z - r.z0) / (r.z1 - r.z0); break;
    default: t = (r.z1 - z) / (r.z1 - r.z0); break;
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return r.y0 + (r.y1 - r.y0) * t;
}

export class World {
  boxes: AABB[] = [];
  ramps: Ramp[] = [];
  floorY = 0.1;
  /** playable area; outside it everything is solid. */
  bounds = { minX: -30, maxX: 30, minZ: -26, maxZ: 26 };

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tag?: string): AABB {
    const b = { minX, minY, minZ, maxX, maxY, maxZ, tag };
    this.boxes.push(b);
    return b;
  }

  /** Does an AABB (feet-centred at x,y,z, half-width r, height h) overlap any solid box? */
  collides(x: number, y: number, z: number, r: number, h: number): boolean {
    const b = this.bounds;
    if (x - r < b.minX || x + r > b.maxX || z - r < b.minZ || z + r > b.maxZ) return true;
    for (let i = 0; i < this.boxes.length; i++) {
      const bx = this.boxes[i]!;
      if (x + r > bx.minX + EPS && x - r < bx.maxX - EPS &&
          z + r > bx.minZ + EPS && z - r < bx.maxZ - EPS &&
          y + h > bx.minY + EPS && y < bx.maxY - EPS) return true;
    }
    return false;
  }

  /**
   * Highest walkable surface under the footprint that is not above `feetY + maxRise`.
   * (box tops use full footprint overlap; ramps sample the footprint centre.)
   */
  groundAt(x: number, z: number, feetY: number, r: number, maxRise: number): number {
    let g = this.floorY;
    const limit = feetY + maxRise;
    for (let i = 0; i < this.boxes.length; i++) {
      const bx = this.boxes[i]!;
      if (bx.maxY <= g || bx.maxY > limit) continue;
      if (x + r > bx.minX + EPS && x - r < bx.maxX - EPS && z + r > bx.minZ + EPS && z - r < bx.maxZ - EPS) g = bx.maxY;
    }
    for (let i = 0; i < this.ramps.length; i++) {
      const rp = this.ramps[i]!;
      if (x < rp.x0 || x > rp.x1 || z < rp.z0 || z > rp.z1) continue;
      const h = rampHeightAt(rp, x, z);
      if (h > g && h <= limit) g = h;
    }
    return g;
  }

  /** Distance along a ray to the first static hit, or null. Ramps count as one-sided slope planes. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    const consider = (t: number, nx: number, ny: number, nz: number, kind: RayHit['kind'], index: number) => {
      if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, nx, ny, nz, kind, index };
    };
    // floor
    if (dy < -1e-9) consider((this.floorY - oy) / dy, 0, 1, 0, 'floor', -1);
    // boxes (slab method)
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i]!;
      let tmin = 0, tmax = maxT, nx = 0, ny = 0, nz = 0;
      let ok = true;
      // x
      if (Math.abs(dx) < 1e-12) { if (ox < b.minX || ox > b.maxX) ok = false; }
      else {
        let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx; let s = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
        if (t1 > tmin) { tmin = t1; nx = s; ny = 0; nz = 0; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) ok = false;
      }
      if (ok) {
        if (Math.abs(dy) < 1e-12) { if (oy < b.minY || oy > b.maxY) ok = false; }
        else {
          let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy; let s = -1;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
          if (t1 > tmin) { tmin = t1; nx = 0; ny = s; nz = 0; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      if (ok) {
        if (Math.abs(dz) < 1e-12) { if (oz < b.minZ || oz > b.maxZ) ok = false; }
        else {
          let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz; let s = -1;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
          if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      if (ok && tmax >= 0) consider(tmin, nx, ny, nz, 'box', i);
    }
    // ramps: intersect the slope plane
    for (let i = 0; i < this.ramps.length; i++) {
      const rp = this.ramps[i]!;
      // plane: y = y0 + k * s, where s is the coordinate along dir
      const run = (rp.dir <= 1) ? (rp.x1 - rp.x0) : (rp.z1 - rp.z0);
      const k = (rp.y1 - rp.y0) / run;
      let nx = 0, nz = 0; const ny = 1;
      let denom: number, num: number;
      switch (rp.dir) {
        case 0: nx = -k; denom = dy - k * dx; num = (rp.y0 + k * (ox - rp.x0)) - oy; break;
        case 1: nx = k; denom = dy + k * dx; num = (rp.y0 + k * (rp.x1 - ox)) - oy; break;
        case 2: nz = -k; denom = dy - k * dz; num = (rp.y0 + k * (oz - rp.z0)) - oy; break;
        default: nz = k; denom = dy + k * dz; num = (rp.y0 + k * (rp.z1 - oz)) - oy; break;
      }
      if (Math.abs(denom) < 1e-9) continue;
      const t = num / denom;
      if (t < 0 || t > maxT) continue;
      const hx = ox + dx * t, hz = oz + dz * t;
      if (hx < rp.x0 || hx > rp.x1 || hz < rp.z0 || hz > rp.z1) continue;
      const len = Math.hypot(nx, ny, nz);
      consider(t, nx / len, ny / len, nz / len, 'ramp', i);
    }
    return best;
  }

  /** Line-of-sight test between two points (true = clear). */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.02) === null;
  }
}
