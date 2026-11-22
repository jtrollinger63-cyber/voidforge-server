/**
 * Ground-level navigation: A* on a uniform grid built from the *actual* collision World,
 * so props / walls / tunnels are respected automatically. Used by bots and by map QA tests.
 * (Terrace decks are intentionally not part of the bot grid; humans can still use them.)
 */
import { World } from '../map/world.ts';

export interface NavGrid {
  minX: number; minZ: number; cols: number; rows: number; cell: number;
  walk: Uint8Array; // 1 = walkable at ground level with clearance
}

/** Clearance radius used for nav (a little more than the movement radius, so paths do not scrape walls). */
export const NAV_RADIUS = 0.42;

export function buildNavGrid(world: World, cell = 0.5): NavGrid {
  const b = world.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / cell), rows = Math.ceil((b.maxZ - b.minZ) / cell);
  const walk = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = b.minX + (c + 0.5) * cell, z = b.minZ + (r + 0.5) * cell;
    walk[r * cols + c] = world.collides(x, world.floorY, z, NAV_RADIUS, 1.7) ? 0 : 1;
  }
  return { minX: b.minX, minZ: b.minZ, cols, rows, cell, walk };
}

const idx = (g: NavGrid, c: number, r: number) => r * g.cols + c;
export function toCell(g: NavGrid, x: number, z: number): [number, number] {
  return [Math.min(g.cols - 1, Math.max(0, Math.floor((x - g.minX) / g.cell))), Math.min(g.rows - 1, Math.max(0, Math.floor((z - g.minZ) / g.cell)))];
}
export const cellCenterXZ = (g: NavGrid, c: number, r: number): [number, number] => [g.minX + (c + 0.5) * g.cell, g.minZ + (r + 0.5) * g.cell];

/** nearest walkable cell to a point (spiral search) */
export function nearestWalkable(g: NavGrid, x: number, z: number): [number, number] | null {
  const [c0, r0] = toCell(g, x, z);
  if (g.walk[idx(g, c0, r0)]) return [c0, r0];
  for (let rad = 1; rad < 12; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
      if (g.walk[idx(g, c, r)]) return [c, r];
    }
  }
  return null;
}

// --- tiny binary heap ---
class Heap {
  keys: number[] = []; vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    let i = this.keys.length; this.keys.push(k); this.vals.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p]! <= k) break; this.keys[i] = this.keys[p]!; this.vals[i] = this.vals[p]!; i = p; }
    this.keys[i] = k; this.vals[i] = v;
  }
  pop(): number {
    const top = this.vals[0]!; const lk = this.keys.pop()!, lv = this.vals.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && this.keys[l + 1]! < this.keys[l]!) l++; if (this.keys[l]! >= lk) break; this.keys[i] = this.keys[l]!; this.vals[i] = this.vals[l]!; i = l; }
      this.keys[i] = lk; this.vals[i] = lv;
    }
    return top;
  }
}

/** A* over the grid (8-neighbour, no corner cutting). Returns world-space waypoints (smoothed) or null. */
export function findPath(world: World, g: NavGrid, ax: number, az: number, bx: number, bz: number): [number, number][] | null {
  const s = nearestWalkable(g, ax, az), e = nearestWalkable(g, bx, bz);
  if (!s || !e) return null;
  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const si = idx(g, s[0], s[1]), ei = idx(g, e[0], e[1]);
  const h = (c: number, r: number) => { const dx = Math.abs(c - e[0]), dz = Math.abs(r - e[1]); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
  gScore[si] = 0;
  const open = new Heap(); open.push(h(s[0], s[1]), si);
  const D: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue; closed[cur] = 1;
    if (cur === ei) break;
    const cc = cur % g.cols, cr = (cur / g.cols) | 0;
    for (const [dc, dr, cost] of D) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ni = idx(g, nc, nr);
      if (!g.walk[ni] || closed[ni]) continue;
      if (dc !== 0 && dr !== 0 && (!g.walk[idx(g, cc + dc, cr)] || !g.walk[idx(g, cc, cr + dr)])) continue;
      const t = gScore[cur]! + cost;
      if (t < gScore[ni]!) { gScore[ni] = t; came[ni] = cur; open.push(t + h(nc, nr), ni); }
    }
  }
  if (came[ei] === -1 && si !== ei) return null;
  const cells: number[] = []; for (let c = ei; c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  const pts: [number, number][] = cells.map((c) => cellCenterXZ(g, c % g.cols, (c / g.cols) | 0));
  return smoothPath(g, pts);
}

/** true when a straight walk between two points stays on walkable cells */
export function segmentWalkable(g: NavGrid, x0: number, z0: number, x1: number, z1: number): boolean {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [c, r] = toCell(g, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (!g.walk[idx(g, c, r)]) return false;
  }
  return true;
}

function smoothPath(g: NavGrid, pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]!];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!segmentWalkable(g, pts[anchor]![0], pts[anchor]![1], pts[i]![0], pts[i]![1])) { out.push(pts[i - 1]!); anchor = i - 1; }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export function pathLength(p: [number, number][]): number {
  let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]); return l;
}
