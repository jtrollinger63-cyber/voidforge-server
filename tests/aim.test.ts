import { describe, it, expect } from 'vitest';
import { GameSim, RULES, AIM, emptyCmd, viewAngles, type Player } from '../src/gameplay/sim.ts';
import { syncFromSim, emptyView } from '../src/gameplay/view.ts';
import { eyeHeight } from '../src/gameplay/movement.ts';
import { WEAPONS } from '../src/gameplay/weapons.ts';
import { validCmd } from '../src/network/protocol.ts';

const DT = 1 / 60;

function live() {
  const sim = new GameSim({ mode: 'elimination', seed: 7, skipWarmup: true });
  const me = sim.addPlayer('Me', 0), foe = sim.addPlayer('Foe', 1);
  sim.round = 0; (sim as unknown as { beginRound(): void }).beginRound();
  for (let i = 0; i < Math.round((RULES.freezeTime + 0.2) / DT); i++) sim.step(DT);
  // park the foe far away so it never interferes, and give the shooter a clear south-courtyard lane
  foe.m.x = 0; foe.m.z = -30; foe.hp = 100;
  me.m.x = 0; me.m.z = 20; me.m.y = 0.1; me.m.vx = me.m.vz = 0;
  return { sim, me, foe };
}

/** fire `n` bursts of 8 and return the angular error (deg) of every shot vs where the crosshair pointed at the moment it fired */
function shotErrors(aim: boolean, n: number, yaw = 0.6, pitch = 0.05, crouch = false): { err: number[]; maxPunchY: number } {
  const { sim, me } = live();
  const err: number[] = []; let maxPunchY = 0;
  me.slots[0] = 'a5'; me.ammo.a5 = { mag: 9999, reserve: 9999 }; me.cur = 0; me.equipT = 0;
  const rec = Math.exp(-WEAPONS.a5.recover * DT);          // the sim recovers the view punch just before it fires
  const idle = { ...emptyCmd(), yaw, pitch, crouch, aim, fire: false };
  for (let k = 0; k < n; k++) {
    me.cmd = { ...idle }; for (let i = 0; i < 90; i++) sim.step(DT);                 // punch + spray recover between bursts
    for (let b = 0; b < 8; b++) {
      me.cmd = { ...idle, fire: true };
      let got: { dx: number; dy: number; dz: number } | null = null, va = { yaw: 0, pitch: 0 };
      for (let g = 0; g < 30 && !got; g++) {
        va = viewAngles(yaw, pitch, me.punchY * rec, me.punchP * rec);               // what the (smoothed) camera shows at this tick
        sim.step(DT);
        const ev = sim.drainEvents().find((e) => e.t === 'shot' && e.id === me.id);
        if (ev && ev.t === 'shot') got = ev;
      }
      if (!got) continue;
      const ex = -Math.sin(va.yaw) * Math.cos(va.pitch), ey = Math.sin(va.pitch), ez = -Math.cos(va.yaw) * Math.cos(va.pitch);
      err.push(Math.acos(Math.min(1, ex * got.dx + ey * got.dy + ez * got.dz)) * 180 / Math.PI);
      maxPunchY = Math.max(maxPunchY, Math.abs(me.punchY));
    }
    me.cmd = { ...idle };
  }
  return { err, maxPunchY };
}

describe('aiming', () => {
  it('bullets go where the crosshair points: the shot direction equals the camera direction (aim + view punch) within the weapon spread', () => {
    const { err, maxPunchY } = shotErrors(false, 2, 0.6, 0.05, true);
    expect(err.length).toBeGreaterThan(8);
    // the view punch really built up during the burst (so the old yaw-sign mismatch between camera and bullets would have shown)
    expect(maxPunchY).toBeGreaterThan(0.2);
    const w = WEAPONS.a5; const cone = (w.spreadBase * w.crouchMul) * (1 + 12 * 0.035) + 1e-3;
    for (const e of err) expect(e).toBeLessThanOrEqual(cone);
  });

  it('aiming down sights tightens the spread and slows movement', () => {
    const hip = shotErrors(false, 3).err, ads = shotErrors(true, 3).err;
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean(ads)).toBeLessThan(mean(hip) * 0.7);
    // movement: ADS walking speed is AIM.moveMul of the hip speed
    const run = (aim: boolean) => { const { sim, me } = live(); me.cmd = { ...emptyCmd(), fwd: 1, yaw: 0, aim }; for (let i = 0; i < 90; i++) sim.step(DT); return me.speed; };
    expect(run(true) / run(false)).toBeCloseTo(AIM.moveMul, 1);
  });

  it('viewAngles is the single definition: camera yaw = aim yaw + punchY (not minus)', () => {
    expect(viewAngles(1, 0.2, 0.5, 2).yaw).toBeGreaterThan(1);
    expect(viewAngles(1, 0.2, 0.5, 2).pitch).toBeGreaterThan(0.2);
  });
});

describe('aim over the wire', () => {
  it('the server accepts the aim flag, defaults it off, and ignores junk', () => {
    const base = { fwd: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0, fire: false, reload: false, use: false, slot: -1 };
    expect(validCmd({ ...base, aim: true })!.aim).toBe(true);
    expect(validCmd({ ...base, aim: false })!.aim).toBe(false);
    expect(validCmd(base)!.aim).toBe(false);
    expect(validCmd({ ...base, aim: 'yes' })!.aim).toBe(false);
    expect(validCmd({ ...base, aim: 1 })!.aim).toBe(false);
  });
  it('every weapon has a sane zoom, and only the marksman rifle is scoped', () => {
    for (const w of Object.values(WEAPONS)) { expect(w.zoom).toBeGreaterThanOrEqual(1); expect(w.zoom).toBeLessThan(4); }
    expect(WEAPONS.knife.zoom).toBe(1);
    expect(Object.values(WEAPONS).filter((w) => w.scoped).map((w) => w.id)).toEqual(['r7']);
  });
});

describe('smooth rendering: the view interpolates between 60 Hz sim ticks', () => {
  /** per-frame distance moved by the local player as the renderer would see it, at an awkward display rate */
  function frameSteps(displayHz: number, interpolate: boolean) {
    const { sim, me } = live();
    me.cmd = { ...emptyCmd(), fwd: 1, yaw: 0 };
    const v = emptyView(); const steps: number[] = []; let last: number | null = null;
    for (let f = 0; f < 120; f++) {
      sim.advance(1 / displayHz);
      syncFromSim(sim, v, me.id);
      const x = interpolate ? v.players.get(me.id)!.z : me.m.z;
      if (last !== null && f > 20) steps.push(Math.abs(x - last));
      last = x;
    }
    return steps;
  }
  it('without interpolation a 75 Hz display sees uneven steps (the judder that reads as shake); with it the steps are even', () => {
    const raw = frameSteps(75, false), smooth = frameSteps(75, true);
    const spread = (a: number[]) => (Math.max(...a) - Math.min(...a)) / (a.reduce((s, x) => s + x, 0) / a.length);
    expect(spread(raw)).toBeGreaterThan(0.6);       // frames alternate between 1 and 0/2 ticks of motion
    expect(spread(smooth)).toBeLessThan(0.12);
  });
  it('also smooth at 144 Hz and at 40 Hz', () => {
    for (const hz of [144, 40, 50]) {
      const s = frameSteps(hz, true); const mean = s.reduce((a, b) => a + b, 0) / s.length;
      expect((Math.max(...s) - Math.min(...s)) / mean, `${hz} Hz`).toBeLessThan(0.15);
    }
  });
  it('a respawn teleport snaps instead of sliding across the map', () => {
    const { sim, me } = live();
    const v = emptyView(); syncFromSim(sim, v, me.id);
    const z0 = v.players.get(me.id)!.z;
    me.prev.z = z0; me.m.z = z0 - 30;              // a 30 m jump inside one tick
    sim.advance(DT * 0.5); syncFromSim(sim, v, me.id);
    expect(Math.abs(v.players.get(me.id)!.z - me.m.z)).toBeLessThan(0.5);
  });
});

export type { Player };
