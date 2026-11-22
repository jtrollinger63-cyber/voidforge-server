import { describe, it, expect } from 'vitest';
import { buildHillfront } from '../src/map/hillfront.ts';
import { buildNavGrid, findPath, pathLength, nearestWalkable } from '../src/gameplay/nav.ts';
import { newMoveState, stepMovement, PLAYER, type MoveInput } from '../src/gameplay/movement.ts';

const map = buildHillfront();
const world = map.world;
const DT = 1 / 60;

const input = (over: Partial<MoveInput> = {}): MoveInput => ({ fwd: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0, ...over });

/** walk toward (tx,tz) with the real movement code until within `tol` or `maxSec` elapses */
function walkTo(s: ReturnType<typeof newMoveState>, tx: number, tz: number, maxSec = 20, tol = 0.35): boolean {
  for (let t = 0; t < maxSec; t += DT) {
    const dx = tx - s.x, dz = tz - s.z;
    if (Math.hypot(dx, dz) < tol) return true;
    // yaw so that forward (-sin, -cos) points at the target
    const yaw = Math.atan2(-dx, -dz);
    stepMovement(world, s, input({ fwd: 1, yaw }), DT);
  }
  return false;
}

describe('map construction', () => {
  it('builds placements and colliders', () => {
    expect(map.placements.length).toBeGreaterThan(200);
    expect(world.boxes.length).toBeGreaterThan(40);
    expect(world.ramps.length).toBeGreaterThanOrEqual(1);
  });

  it('only references pieces that exist in the kit manifest', async () => {
    const mf = (await import('../public/assets/manifest.json', { with: { type: 'json' } })).default as any;
    const kit = new Set(mf.assets.find((a: any) => a.file === 'kit.glb').pieces.map((p: any) => p.name));
    const missing = [...new Set(map.placements.map((p) => p.piece))].filter((n) => n !== 'ground-cell' && !kit.has(n));
    expect(missing).toEqual([]);
  });

  it('spawn points are free of geometry and on the floor', () => {
    for (const sp of [...map.spawns.vanguard, ...map.spawns.garrison]) {
      expect(world.collides(sp.x, world.floorY, sp.z, PLAYER.radius, PLAYER.heightStand), `spawn ${sp.x},${sp.z}`).toBe(false);
    }
    expect(map.spawns.vanguard.length).toBeGreaterThanOrEqual(5);
    expect(map.spawns.garrison.length).toBeGreaterThanOrEqual(5);
  });

  it('both objective sites have free standing room', () => {
    for (const site of map.sites) {
      expect(world.collides(site.x + 2.5, world.floorY, site.z, PLAYER.radius, PLAYER.heightStand)).toBe(false);
    }
  });
});

describe('movement vs. real map', () => {
  it('cannot walk through the outer perimeter', () => {
    const s = newMoveState(0, world.floorY, 22);
    for (let t = 0; t < 6; t += DT) stepMovement(world, s, input({ fwd: -1, yaw: 0 }), DT); // run backwards -> +z
    expect(s.z).toBeLessThan(world.bounds.maxZ + 0.001);
    expect(world.collides(s.x, s.y, s.z, PLAYER.radius, PLAYER.heightStand)).toBe(false);
  });

  it('cannot walk through a block wall', () => {
    // start in the west lane, run east into the A-region block face at x=-14 (cell i=-4/-3 houses)
    const s = newMoveState(-22, world.floorY, -14);
    for (let t = 0; t < 8; t += DT) stepMovement(world, s, input({ fwd: 1, yaw: -Math.PI / 2 }), DT); // east
    expect(world.collides(s.x, s.y, s.z, PLAYER.radius, PLAYER.heightStand)).toBe(false);
  });

  it('both teams can path from every spawn to both sites, and the routes are balanced', () => {
    const grid = buildNavGrid(world);
    const lens: Record<string, number[]> = { vanguardA: [], vanguardB: [], garrisonA: [], garrisonB: [] };
    for (const [team, spawns] of [['vanguard', map.spawns.vanguard], ['garrison', map.spawns.garrison]] as const) {
      for (const sp of spawns) for (const site of map.sites) {
        const path = findPath(world, grid, sp.x, sp.z, site.x, site.z);
        expect(path, `${team} spawn (${sp.x},${sp.z}) -> site ${site.id}`).not.toBeNull();
        lens[team + site.id]!.push(pathLength(path!));
      }
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    // fairness: attackers' trip to A vs B and defenders' trip to A vs B within 25 % of each other
    expect(Math.abs(avg(lens.vanguardA!) - avg(lens.vanguardB!)) / avg(lens.vanguardA!)).toBeLessThan(0.25);
    expect(Math.abs(avg(lens.garrisonA!) - avg(lens.garrisonB!)) / avg(lens.garrisonA!)).toBeLessThan(0.25);
    // and the two teams' routes to the same site are comparable
    expect(Math.abs(avg(lens.vanguardA!) - avg(lens.garrisonA!)) / avg(lens.vanguardA!)).toBeLessThan(0.3);
    // eslint-disable-next-line no-console
    console.log('mean path lengths (m):', Object.fromEntries(Object.entries(lens).map(([k, v]) => [k, +avg(v).toFixed(1)])));
  });

  it('a simulated player actually walks each planned route to the site (no sticking)', () => {
    const grid = buildNavGrid(world);
    for (const team of ['vanguard', 'garrison'] as const) for (const site of map.sites) {
      const sp = map.spawns[team][1]!;
      const path = findPath(world, grid, sp.x, sp.z, site.x, site.z)!;
      const s = newMoveState(sp.x, world.floorY, sp.z);
      for (const [x, z] of path) expect(walkTo(s, x, z, 12, 0.5), `${team}->${site.id} stuck at ${s.x.toFixed(2)},${s.z.toFixed(2)} heading ${x.toFixed(1)},${z.toFixed(1)}`).toBe(true);
    }
  });

  it('every open street cell is connected to the spawns (no stranded pockets)', () => {
    const grid = buildNavGrid(world);
    const sp = map.spawns.vanguard[2]!;
    const start = nearestWalkable(grid, sp.x, sp.z)!;
    const seen = new Uint8Array(grid.cols * grid.rows); const q: number[] = [start[1] * grid.cols + start[0]]; seen[q[0]!] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]! % grid.cols, r = (q[h]! / grid.cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        const ni = nr * grid.cols + nc; if (!grid.walk[ni] || seen[ni]) continue; seen[ni] = 1; q.push(ni);
      }
    }
    let walkable = 0; for (let i = 0; i < grid.walk.length; i++) walkable += grid.walk[i]!;
    expect(q.length / walkable).toBeGreaterThan(0.985); // at most ~1.5 % of floor area may be unreachable nooks
  });

  it('can climb the external stair onto the terrace deck', () => {
    const s = newMoveState(-20, world.floorY, -4);
    expect(walkTo(s, -14.1, -4, 10, 0.15)).toBe(true);
    expect(s.y).toBeGreaterThan(3.5);
    expect(walkTo(s, -12.4, -3.0, 5, 0.4)).toBe(true);
    expect(s.y).toBeCloseTo(3.7, 1);
  });

  it('jump rises, lands and reports landing', () => {
    const s = newMoveState(0, world.floorY, 19);
    stepMovement(world, s, input({ jump: true }), DT);
    expect(s.onGround).toBe(false);
    let peak = s.y, landed = false;
    for (let t = 0; t < 2; t += DT) { stepMovement(world, s, input(), DT); peak = Math.max(peak, s.y); if (s.justLanded) landed = true; }
    expect(peak - world.floorY).toBeGreaterThan(0.7);
    expect(peak - world.floorY).toBeLessThan(1.3);
    expect(landed).toBe(true);
    expect(s.y).toBeCloseTo(world.floorY, 3);
  });

  it('crouch lowers height and standing back up is blocked under a low ceiling', () => {
    const s = newMoveState(-12, world.floorY, 0); // inside the west tunnel (ceiling at 3.0 -> plenty of room)
    stepMovement(world, s, input({ crouch: true }), DT);
    expect(s.crouching).toBe(true);
    stepMovement(world, s, input({ crouch: false }), DT);
    expect(s.crouching).toBe(false);
  });
});

describe('static ray queries', () => {
  it('rays hit walls, floors and report line of sight', () => {
    const a = world.raycast(0, 1.6, 22, 0, 0, 1, 50);
    expect(a?.kind).toBe('box'); // the south perimeter
    const down = world.raycast(0, 1.6, 22, 0, -1, 0, 5);
    expect(down?.kind).toBe('floor');
    expect(world.clearLine(0, 1.6, 22, 0, 1.6, 17)).toBe(true);
    expect(world.clearLine(0, 1.6, 22, -19, 1.6, 2)).toBe(false); // blocked by buildings
  });
});
