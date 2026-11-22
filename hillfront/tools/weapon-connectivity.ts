/**
 * Is a weapon one connected object?  Triangles are welded by position into pieces; two pieces are "joined" when the closest
 * vertex<->triangle distance between them is below `tol`. Returns the connected groups (largest first).
 * Used by tests/weapons.test.ts and for investigating the CC0 pack's floating parts (see src/weapons/fillers.ts).
 */
export type V3 = [number, number, number];
export interface Tri { a: V3; b: V3; c: V3 }
export interface Piece { tris: Tri[]; min: V3; max: V3 }

const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** distance from point p to triangle t (Ericson, Real-Time Collision Detection) */
export function pointTriangle(p: V3, t: Tri): number {
  const { a, b, c } = t;
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a); const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: V3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b); const d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
      else {
        const cp = sub(p, c); const d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
            else { const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function weldPieces(tris: Tri[]): Piece[] {
  const key = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const parent = tris.map((_, i) => i); const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  tris.forEach((t, i) => { for (const p of [t.a, t.b, t.c]) { const k = key(p); const o = owner.get(k); if (o === undefined) owner.set(k, i); else parent[find(i)] = find(o); } });
  const by = new Map<number, Tri[]>(); tris.forEach((t, i) => { const r = find(i); (by.get(r) ?? by.set(r, []).get(r)!).push(t); });
  return [...by.values()].map((ts) => {
    const min: V3 = [9, 9, 9], max: V3 = [-9, -9, -9];
    for (const t of ts) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
    return { tris: ts, min, max };
  });
}

function pieceDistance(A: Piece, B: Piece): number {
  let best = Infinity;
  for (const [X, Y] of [[A, B], [B, A]] as [Piece, Piece][]) for (const t of X.tris) for (const p of [t.a, t.b, t.c]) for (const u of Y.tris) { const d = pointTriangle(p, u); if (d < best) best = d; }
  return best;
}

/** connected groups of pieces (indices into `pieces`), largest (by triangle count) first */
export function connectedGroups(pieces: Piece[], tol: number): number[][] {
  const n = pieces.length; const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = pieces[i]!, b = pieces[j]!; let gap = 0; for (let k = 0; k < 3; k++) gap = Math.max(gap, a.min[k]! - b.max[k]!, b.min[k]! - a.max[k]!);
    if (gap >= tol) continue;                                 // bounding boxes already further apart than the tolerance
    if (pieceDistance(a, b) < tol) { adj[i]!.push(j); adj[j]!.push(i); }
  }
  const seen = Array(n).fill(false); const groups: number[][] = [];
  for (let i = 0; i < n; i++) if (!seen[i]) { const g: number[] = []; const st = [i]; seen[i] = true; while (st.length) { const u = st.pop()!; g.push(u); for (const v of adj[u]!) if (!seen[v]) { seen[v] = true; st.push(v); } } groups.push(g); }
  const size = (g: number[]) => g.reduce((s, i) => s + pieces[i]!.tris.length, 0);
  return groups.sort((x, y) => size(y) - size(x));
}
