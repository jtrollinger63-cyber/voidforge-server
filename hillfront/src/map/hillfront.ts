/**
 * "Hillfront" — the single competitive map, generated from an ASCII cell grid (4 m cells).
 * Pure TypeScript (no DOM / three.js): the server and the offline sim build the exact same World.
 *
 * Output:  visual placements of Hill Town kit pieces, a collision World (boxes + ramps),
 *          spawns, objective sites, bot-navigation hints and metadata.
 *
 * Grid legend:  . open ground      # solid 2-storey block (flat parapet roof)
 *               G gabled house     T terrace block (single storey, walkable flat roof, stair access)
 *               H enterable hall   a E-W tunnel cell     A N-S tunnel cell
 *
 * Pieces are modelled on a 4 m grid, origin bottom-centre, front face = local +Z (see docs/ASSETS.md).
 * yaw convention: three.js rotation.y; local +Z -> world (sin yaw, cos yaw).
 */
import { World } from './world.ts';
import bounds from './piece-bounds.json' with { type: 'json' };

/** piece === 'ground-cell' is a flat procedurally-textured 4x4 m quad (not a kit piece). */
export interface Placement { piece: string; x: number; y: number; z: number; yaw: number; scale?: number; }
export interface SpawnPoint { x: number; z: number; yaw: number; }
export interface Site { id: 'A' | 'B'; x: number; z: number; radius: number; }

export interface MapDef {
  name: string;
  placements: Placement[];
  world: World;
  spawns: { vanguard: SpawnPoint[]; garrison: SpawnPoint[] };
  sites: Site[];
  /** free-camera spots for menu backdrop / spectators */
  vistas: { name: string; pos: [number, number, number]; look: [number, number, number] }[];
  grid: string[];
  gridOrigin: { i0: number; j0: number };
  cell: number;
  /** prop-free decorative lamps (no collision) */
  lights: { x: number; y: number; z: number }[];
}

export const CELL = 4;
export const FLOOR_Y = 0.1;
export const STOREY = 3.5;
export const TERRACE_TOP = 3.7;
export const BLOCK_TOP = 7.1;

export const GRID: string[] = [
  //  i: -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7
  '#####.....#####', // j=-6   Garrison (north) courtyard
  '#...a.....a...#', // j=-5
  '#..GG.....GG..#', // j=-4
  '#..GG##A##GG..#', // j=-3
  '#...T.....#...#', // j=-2
  '#...T.....#...#', // j=-1
  '#...a.....a...#', // j= 0
  '#...#.....#HH.#', // j= 1    Cistern hall at i=4..5, j=1..2
  '#...#.....#HH.#', // j= 2
  '#..GG##A##GG..#', // j= 3
  '#..GG.....GG..#', // j= 4
  '#...a.....a...#', // j= 5
  '#####.....#####', // j= 6    Vanguard (south) courtyard
];

const I0 = -7, J0 = -6;
const cw = (i: number) => i * CELL;
const cwz = (j: number) => j * CELL;

type Cell = '#' | 'G' | 'T' | 'H' | 'a' | 'A' | '.';
const cellAt = (i: number, j: number): Cell => {
  const r = GRID[j - J0], c = i - I0;
  if (!r || c < 0 || c >= r.length) return '#';
  return r[c] as Cell;
};
const isSolidish = (c: Cell) => c === '#' || c === 'G' || c === 'T';

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type PB = { min: number[]; max: number[] };
const PB = bounds as unknown as Record<string, PB>;

/** direction vectors: 0=N(-z) 1=E(+x) 2=S(+z) 3=W(-x) */
const DIRS = [
  { di: 0, dj: -1, yaw: 180 },
  { di: 1, dj: 0, yaw: 90 },
  { di: 0, dj: 1, yaw: 0 },
  { di: -1, dj: 0, yaw: -90 },
];

export function buildHillfront(): MapDef {
  const rng = mulberry32(0x51a7e);
  const placements: Placement[] = [];
  const world = new World();
  world.floorY = FLOOR_Y;
  world.bounds = { minX: cw(I0) - 2, maxX: cw(I0 + GRID[0]!.length - 1) + 2, minZ: cwz(J0) - 2, maxZ: cwz(J0 + GRID.length - 1) + 2 };
  const lights: MapDef['lights'] = [];
  const place = (piece: string, x: number, y: number, z: number, yaw = 0, scale?: number) => { placements.push({ piece, x, y, z, yaw, scale }); };

  const W = GRID[0]!.length, H = GRID.length;
  const posts = new Set<string>();
  const addPost = (x: number, y: number, z: number) => {
    const k = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    if (posts.has(k)) return; posts.add(k); place('corner-post', x, y, z, 0);
  };

  const facadePick = (storey: number, idx: number): string => {
    const r = rng();
    if (storey === 1) return r < 0.26 ? 'wall-shuttered-window' : r < 0.63 ? 'wall-ochre-bay' : 'wall-plaster-bay';
    return r < 0.3 ? 'wall-shuttered-window' : r < 0.7 ? 'wall-plaster-bay' : 'wall-ochre-bay';
  };

  // ---------------- per-cell geometry ----------------
  for (let j = J0 - 1; j < J0 + H + 1; j++) {
    for (let i = I0 - 1; i < I0 + W + 1; i++) {
      const c = cellAt(i, j);
      const cx = cw(i), cz = cwz(j);
      // a solid cell with no open neighbour is unreachable and invisible: skip it entirely
      if (isSolidish(c) && c !== 'T' && !DIRS.some((d) => !isSolidish(cellAt(i + d.di, j + d.dj)))) {
        // unreachable & invisible interior cell: no facades, but still sealed so rays/bounds stay correct
        world.addBox(cx - 2, 0, cz - 2, cx + 2, BLOCK_TOP, cz + 2, 'block-core');
        continue;
      }
      if (c === '.' || c === 'a' || c === 'A') {
        // paved ground (top at FLOOR_Y)
        place('ground-cell', cx, FLOOR_Y, cz, 0);
      }
      if (c === 'H') place('floor-tile', cx, 0, cz, 0);

      const solidish = isSolidish(c);
      if (solidish) {
        const storeys = c === 'T' ? 1 : 2;
        const top = c === 'T' ? TERRACE_TOP : BLOCK_TOP;
        // collision: expanded by half a wall thickness on exposed sides
        let minX = cx - 2, maxX = cx + 2, minZ = cz - 2, maxZ = cz + 2;
        for (let d = 0; d < 4; d++) {
          const n = cellAt(i + DIRS[d]!.di, j + DIRS[d]!.dj);
          if (isSolidish(n)) continue;
          if (n === 'H') continue; // hall owns that wall
          const e = 0.18;
          if (d === 0) minZ -= e; else if (d === 2) maxZ += e; else if (d === 1) maxX += e; else minX -= e;
        }
        world.addBox(minX, 0, minZ, maxX, top, maxZ, c === 'T' ? 'terrace' : 'block');

        // facades on exposed faces
        for (let d = 0; d < 4; d++) {
          const { di, dj, yaw } = DIRS[d]!;
          const n = cellAt(i + di, j + dj);
          if (isSolidish(n) || n === 'H') continue;
          const fx = cx + di * 2, fz = cz + dj * 2;
          for (let s = 0; s < storeys; s++) {
            place(facadePick(s + 1, i * 31 + j * 17 + d), fx, FLOOR_Y + s * STOREY, fz, yaw);
          }
          // corner posts at both ends of this face (both storeys)
          const ex = dj !== 0 ? 2 : 0, ez = di !== 0 ? 2 : 0;
          for (let s = 0; s < storeys; s++) {
            addPost(fx - ex, FLOOR_Y + s * STOREY, fz - ez);
            addPost(fx + ex, FLOOR_Y + s * STOREY, fz + ez);
          }
          // parapet along the roof edge (left open where the roof stair lands: terrace cell (-3,-1), west face)
          const stairLanding = c === 'T' && i === -3 && j === -1 && d === 3;
          if ((c === 'T' || c === '#') && !stairLanding) {
            place('roof-parapet', fx, top, fz, yaw);
            // low parapet collider so cover on the terrace works (and nothing is walkable on blocks anyway)
            if (c === 'T') {
              const t = 0.17;
              if (d === 0) world.addBox(cx - 2, top, cz - 2 - 0.18 + 0.0, cx + 2, top + 0.74, cz - 2 + t, 'parapet');
              if (d === 2) world.addBox(cx - 2, top, cz + 2 - t, cx + 2, top + 0.74, cz + 2 + 0.18, 'parapet');
              if (d === 1) world.addBox(cx + 2 - t, top, cz - 2, cx + 2 + 0.18, top + 0.74, cz + 2, 'parapet');
              if (d === 3) world.addBox(cx - 2 - 0.18, top, cz - 2, cx - 2 + t, top + 0.74, cz + 2, 'parapet');
            }
          }
        }
        if (c === 'T') place('floor-tile', cx, TERRACE_TOP - 0.1, cz, 0); // roof deck
      }

      // ---------- tunnel cells ----------
      if (c === 'a' || c === 'A') {
        const axisDirs = c === 'a' ? [1, 3] : [0, 2];
        for (const d of axisDirs) {
          const { di, dj, yaw } = DIRS[d]!;
          const fx = cx + di * 2, fz = cz + dj * 2;
          place('wall-arched-passage', fx, FLOOR_Y, fz, yaw);
          place(facadePick(2, i + j + d), fx, FLOOR_Y + STOREY, fz, yaw);
          const ex = dj !== 0 ? 2 : 0, ez = di !== 0 ? 2 : 0;
          addPost(fx - ex, FLOOR_Y, fz - ez); addPost(fx + ex, FLOOR_Y, fz + ez);
          addPost(fx - ex, FLOOR_Y + STOREY, fz - ez); addPost(fx + ex, FLOOR_Y + STOREY, fz + ez);
          place('roof-parapet', fx, BLOCK_TOP, fz, yaw);
          // arch collision: two piers (opening ±1.15 m) + lintel above 2.7 m
          const half = 1.15, th = 0.19;
          if (di !== 0) { // wall plane normal to x
            world.addBox(fx - th, 0, cz - 2, fx + th, BLOCK_TOP, cz - half, 'arch-pier');
            world.addBox(fx - th, 0, cz + half, fx + th, BLOCK_TOP, cz + 2, 'arch-pier');
            world.addBox(fx - th, 2.7, cz - half, fx + th, BLOCK_TOP, cz + half, 'arch-lintel');
          } else {
            world.addBox(cx - 2, 0, fz - th, cx - half, BLOCK_TOP, fz + th, 'arch-pier');
            world.addBox(cx + half, 0, fz - th, cx + 2, BLOCK_TOP, fz + th, 'arch-pier');
            world.addBox(cx - half, 2.7, fz - th, cx + half, BLOCK_TOP, fz + th, 'arch-lintel');
          }
        }
        // ceiling slab (tunnel is a covered passage): visual + collision
        place('floor-tile', cx, STOREY + FLOOR_Y, cz, 0);
        world.addBox(cx - 2, 3.0, cz - 2, cx + 2, BLOCK_TOP, cz + 2, 'tunnel-ceiling');
      }
    }
  }

  // ---------------- gabled houses (2-deep groups of 'G') ----------------
  const seen = new Set<string>();
  for (let j = J0; j < J0 + H; j++) for (let i = I0; i < I0 + W; i++) {
    if (cellAt(i, j) !== 'G' || seen.has(`${i},${j}`)) continue;
    let i1 = i; while (cellAt(i1 + 1, j) === 'G') i1++;
    let j1 = j; while (cellAt(i, j1 + 1) === 'G') j1++;
    for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) seen.add(`${ii},${jj}`);
    const zN = cwz(j) - 2, zS = cwz(j1) + 2, xW = cw(i) - 2, xE = cw(i1) + 2;
    if (j1 - j === 1) { // ridge along x, depth 2 cells
      const zc = (zN + zS) / 2;
      for (let ii = i; ii <= i1; ii++) {
        place('roof-tile-slope', cw(ii), BLOCK_TOP, zN, 0);
        place('roof-tile-slope', cw(ii), BLOCK_TOP, zS, 180);
        place('roof-ridge-cap', cw(ii), BLOCK_TOP + 1.93, zc, 0);
      }
      for (const xe of [xW, xE]) {
        place('roof-gable-half', xe, BLOCK_TOP, cwz(j), -90);
        place('roof-gable-half', xe, BLOCK_TOP, cwz(j1), 90);
      }
    } else { // ridge along z, width 2 cells
      const xc = (xW + xE) / 2;
      for (let jj = j; jj <= j1; jj++) {
        place('roof-tile-slope', xW, BLOCK_TOP, cwz(jj), 90);
        place('roof-tile-slope', xE, BLOCK_TOP, cwz(jj), -90);
        place('roof-ridge-cap', xc, BLOCK_TOP + 1.93, cwz(jj), 90);
      }
      for (const ze of [zN, zS]) {
        place('roof-gable-half', cw(i), BLOCK_TOP, ze, 0);
        place('roof-gable-half', cw(i1), BLOCK_TOP, ze, 180);
      }
    }
  }
  // flat roofs on plain blocks get no deck (never visible from the ground / terraces)

  // ---------------- the Cistern hall (H cells) ----------------
  {
    const cells: [number, number][] = [];
    for (let j = J0; j < J0 + H; j++) for (let i = I0; i < I0 + W; i++) if (cellAt(i, j) === 'H') cells.push([i, j]);
    for (const [i, j] of cells) {
      const cx = cw(i), cz = cwz(j);
      // roof deck + parapet (decor only; no stairs lead up)
      place('floor-tile', cx, STOREY + FLOOR_Y - 0.1 + 0.1, cz, 0);
      for (let d = 0; d < 4; d++) {
        const { di, dj, yaw } = DIRS[d]!;
        const n = cellAt(i + di, j + dj);
        if (n === 'H') continue;
        const fx = cx + di * 2, fz = cz + dj * 2;
        let piece = facadePick(1, i + j + d);
        const op = hallOpenings(i, j, d);
        if (op === 'arch') piece = 'wall-arched-passage';
        else if (op === 'door') piece = 'wall-timber-door';
        place(piece, fx, FLOOR_Y, fz, yaw);
        place(facadePick(2, i + j + d), fx, FLOOR_Y + STOREY, fz, yaw);
        const ex = dj !== 0 ? 2 : 0, ez = di !== 0 ? 2 : 0;
        addPost(fx - ex, FLOOR_Y, fz - ez); addPost(fx + ex, FLOOR_Y, fz + ez);
        addPost(fx - ex, FLOOR_Y + STOREY, fz - ez); addPost(fx + ex, FLOOR_Y + STOREY, fz + ez);
        place('roof-parapet', fx, BLOCK_TOP, fz, yaw);
        // collision of this face
        const th = 0.19;
        if (op === 'arch') {
          const half = 1.15;
          if (di !== 0) {
            world.addBox(fx - th, 0, cz - 2, fx + th, BLOCK_TOP, cz - half, 'hall-pier');
            world.addBox(fx - th, 0, cz + half, fx + th, BLOCK_TOP, cz + 2, 'hall-pier');
            world.addBox(fx - th, 2.7, cz - half, fx + th, BLOCK_TOP, cz + half, 'hall-lintel');
          } else {
            world.addBox(cx - 2, 0, fz - th, cx - half, BLOCK_TOP, fz + th, 'hall-pier');
            world.addBox(cx + half, 0, fz - th, cx + 2, BLOCK_TOP, fz + th, 'hall-pier');
            world.addBox(cx - half, 2.7, fz - th, cx + half, BLOCK_TOP, fz + th, 'hall-lintel');
          }
        } else {
          if (di !== 0) world.addBox(fx - th, 0, cz - 2, fx + th, BLOCK_TOP, cz + 2, 'hall-wall');
          else world.addBox(cx - 2, 0, fz - th, cx + 2, BLOCK_TOP, fz + th, 'hall-wall');
        }
      }
      world.addBox(cx - 2, 3.0, cz - 2, cx + 2, BLOCK_TOP, cz + 2, 'hall-ceiling');
    }
  }
  function hallOpenings(i: number, j: number, d: number): 'arch' | 'door' | null {
    // north face (dir 0) of the northern row: arch at i=5, closed timber door at i=4; east face (dir 1) of the southern row: arch
    if (d === 0 && j === 1 && i === 5) return 'arch';
    if (d === 0 && j === 1 && i === 4) return 'door';
    if (d === 1 && j === 2 && i === 5) return 'arch';
    return null;
  }

  // ---------------- terrace stair (roof access to the western terrace, from site A) ----------------
  // Terrace T cells: i=-3, j=-2..-1  -> x in [-14,-10], z in [-10,-2]. Stair centred on cell j=-1 (z=-4), rising toward +x and topping out at the deck.
  {
    const topX = cw(-3) - 2;          // -14 (west face of the terrace)
    const len = 4.36, wid = 1.34;
    const zc = -4;
    place('external-stair-run', topX - len / 2, FLOOR_Y, zc, 90);
    world.ramps.push({ x0: topX - len, x1: topX, z0: zc - wid / 2 - 0.08, z1: zc + wid / 2 + 0.08, y0: FLOOR_Y + 0.28, y1: TERRACE_TOP + 0.02, dir: 0 });
    // side rails keep players on the flight (waist-high, visual rails come with the piece)
    world.addBox(topX - len, FLOOR_Y, zc - wid / 2 - 0.2, topX, TERRACE_TOP + 0.9, zc - wid / 2 - 0.08, 'stair-rail');
    world.addBox(topX - len, FLOOR_Y, zc + wid / 2 + 0.08, topX, TERRACE_TOP + 0.9, zc + wid / 2 + 0.2, 'stair-rail');
    // the rails above would block jumping down from the deck edge; limit them to the flight
  }

  // ---------------- props ----------------
  const prop = (piece: string, x: number, z: number, yaw = 0, opts: { y?: number; collide?: boolean; shrink?: number; height?: number } = {}) => {
    const y = opts.y ?? FLOOR_Y;
    place(piece, x, y, z, yaw);
    if (opts.collide === false) return;
    const b = PB[piece]; if (!b) return;
    const hx = (b.max[0]! - b.min[0]!) / 2, hz = (b.max[2]! - b.min[2]!) / 2;
    const cxo = (b.max[0]! + b.min[0]!) / 2, czo = (b.max[2]! + b.min[2]!) / 2;
    const s = Math.sin(yaw * Math.PI / 180), c = Math.cos(yaw * Math.PI / 180);
    // world-space extents of the rotated rectangle
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const ox = c * cxo + s * czo, oz = -s * cxo + c * czo;
    const k = opts.shrink ?? 0.92;
    const h = opts.height ?? b.max[1]!;
    world.addBox(x + ox - ex * k, y, z + oz - ez * k, x + ox + ex * k, y + h, z + oz + ez * k, piece);
  };
  const lamp = (x: number, z: number, d: number) => {
    const { di, dj, yaw } = DIRS[d]!;
    place('wall-lamp-bracket', x, 2.8, z, yaw);
    lights.push({ x: x + di * 0.5, y: 3.0, z: z + dj * 0.5 });
  };

  // Mid plaza (fountain square)
  prop('octagonal-fountain', 0, 0, 0, { shrink: 0.95 });
  prop('stone-bench', -4.2, -5.2, 90); prop('stone-bench', 4.2, 5.2, 90);
  prop('crate-stack', -6.3, 5.6, 25); prop('crate-stack', 6.4, -5.8, -15);
  prop('wine-barrel', -7.2, -6.6, 0); prop('wine-barrel', 7.3, 6.6, 0);
  prop('potted-olive-tree', -7.4, 7.2, 0, { shrink: 0.5 }); prop('potted-olive-tree', 7.4, -7.2, 0, { shrink: 0.5 });
  prop('low-garden-wall', -5.5, 2.4, 90, { height: 0.88 });
  prop('low-garden-wall', 5.5, -2.4, 90, { height: 0.88 });
  lamp(-2.0, -10 + 0.2, 2); lamp(2.0, 10 - 0.2, 0);

  // Site A (west) — market stalls
  prop('market-awning-stall', -19.5, -1.5, 16, { shrink: 0.9 });
  prop('crate-stack', -23.2, 3.4, 40); prop('crate-stack', -22.6, 4.8, -10);
  prop('wine-barrel', -16.2, 6.4, 0); prop('wine-barrel', -15.4, 7.4, 0);
  prop('sandbag-wall', -19.0, 6.6, 0); prop('jersey-barrier', -23.5, -0.5, 80);
  prop('oil-drum', -24.6, 7.8, 0); prop('stone-bench', -16.4, -2.4, 90);
  prop('potted-olive-tree', -24.2, -8.4, 0, { shrink: 0.5 }); prop('potted-olive-tree', -16.0, -8.6, 0, { shrink: 0.5 });
  prop('site-marker-board', -19.0, 2.0, 180, { collide: true });
  prop('barrier-tape-stand', -24.6, 9.2, 90, { collide: false });
  lamp(-26 + 0.2, 4, 1); lamp(-14.2, 6, 3);
  // Site B (east) — fortified sandbag position near the hall
  prop('sandbag-wall', 17.0, -7.2, 0); prop('sandbag-wall', 21.0, -7.4, 8);
  prop('crate-stack', 24.0, -5.0, 20); prop('crate-stack', 24.2, -3.4, -35);
  prop('jersey-barrier', 16.2, -2.2, 90); prop('jersey-barrier', 22.4, 0.2, 0);
  prop('wine-barrel', 15.4, -4.2, 0); prop('oil-drum', 24.8, 0.4, 0); prop('oil-drum', 25.2, -0.6, 0);
  prop('market-awning-stall', 19.5, -9.0, 180, { shrink: 0.85 });
  prop('site-marker-board', 20.0, -4.0, 0, { collide: true });
  prop('potted-olive-tree', 24.4, -8.6, 0, { shrink: 0.5 });
  lamp(26 - 0.2, -4, 3); lamp(14.2, -6, 1);
  // Lanes & courtyards
  prop('crate-stack', -23.5, -21.6, 30); prop('wine-barrel', -22.2, -22.0, 0);
  prop('crate-stack', 23.5, 21.6, 30 + 90); prop('wine-barrel', 22.2, 22.0, 0);
  prop('oil-drum', -21.0, 18.4, 0); prop('oil-drum', 21.0, -18.4, 0);
  prop('sandbag-wall', -6.0, -17.0, 0); prop('sandbag-wall', 6.0, -17.0, 0);   // Garrison forward cover
  prop('sandbag-wall', -6.0, 17.0, 180); prop('sandbag-wall', 6.0, 17.0, 180); // Vanguard forward cover
  prop('barrier-tape-stand', -8.4, -20.0, 90, { collide: false });
  prop('barrier-tape-stand', 8.4, -20.0, 90, { collide: false });
  prop('barrier-tape-stand', -8.4, 20.0, 90, { collide: false });
  prop('barrier-tape-stand', 8.4, 20.0, 90, { collide: false });
  prop('freestanding-archway', 0, -24.9, 0, { collide: false });
  prop('freestanding-archway', 0, 24.9, 180, { collide: false });
  prop('stone-bench', -3.0, -23.4, 0); prop('stone-bench', 3.0, 23.4, 180);
  prop('potted-olive-tree', -9.0, -24.2, 0, { shrink: 0.5 }); prop('potted-olive-tree', 9.0, 24.2, 0, { shrink: 0.5 });
  // Cistern interior cover
  prop('crate-stack', 16.6, 7.6, 10); prop('crate-stack', 19.6, 4.4, -20); prop('wine-barrel', 20.4, 8.4, 0); prop('wine-barrel', 15.6, 4.4, 0);
  // Terrace deck cover (rooftop above the A flank)
  prop('sandbag-wall', -11.2, -5.8, 90, { y: TERRACE_TOP });
  prop('crate-stack', -11.8, -8.6, 20, { y: TERRACE_TOP });

  // ---------------- spawns, sites ----------------
  const garrison: SpawnPoint[] = [], vanguard: SpawnPoint[] = [];
  for (const [x, z] of [[-6, -22], [-3, -21], [0, -22.5], [3, -21], [6, -22], [-4.5, -19.2], [4.5, -19.2], [0, -19.5]] as const) garrison.push({ x, z, yaw: 180 });
  for (const [x, z] of [[-6, 22], [-3, 21], [0, 22.5], [3, 21], [6, 22], [-4.5, 19.2], [4.5, 19.2], [0, 19.5]] as const) vanguard.push({ x, z, yaw: 0 });
  const sites: Site[] = [{ id: 'A', x: -19, z: 2.0, radius: 5.5 }, { id: 'B', x: 20, z: -4.0, radius: 5.5 }];

  const vistas: MapDef['vistas'] = [
    { name: 'Fountain Square', pos: [-3.2, 2.6, 8.6], look: [2.5, 1.4, -4] },
    { name: 'Site A market', pos: [-16.5, 3.0, 10], look: [-20.5, 1.2, -1] },
    { name: 'Site B sandbags', pos: [24.5, 3.0, 2.0], look: [19, 1.0, -5] },
    { name: 'Vanguard gate', pos: [0, 2.4, 15.6], look: [0, 1.8, 25] },
    { name: 'Garrison courtyard', pos: [0, 2.4, -15.6], look: [0, 1.8, -25] },
    { name: 'Roof stair', pos: [-22.5, 2.0, 2.5], look: [-14.5, 2.2, -4] },
    { name: 'West tunnel', pos: [-7.5, 1.7, 0.2], look: [-17, 1.7, 0] },
    { name: 'Cistern hall interior', pos: [15, 1.7, 9], look: [21, 1.4, 3] },
  ];

  return { name: 'Hillfront', placements, world, spawns: { vanguard, garrison }, sites, vistas, grid: GRID, gridOrigin: { i0: I0, j0: J0 }, cell: CELL, lights };
}

/** world coordinates of a grid cell centre */
export function cellCenter(i: number, j: number): [number, number] { return [cw(i), cwz(j)]; }
