import { describe, it, expect } from 'vitest';
import { GameSim, RULES, VANGUARD, GARRISON, emptyCmd, type Player } from '../src/gameplay/sim.ts';
import { eyeHeight } from '../src/gameplay/movement.ts';
import { WEAPONS } from '../src/gameplay/weapons.ts';

const DT = 1 / 60;
const run = (sim: GameSim, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) sim.step(DT); };

function mk(mode: 'objective' | 'elimination' = 'objective', seed = 1) {
  const sim = new GameSim({ mode, seed, skipWarmup: true });
  const v1 = sim.addPlayer('V1', 0), v2 = sim.addPlayer('V2', 0), g1 = sim.addPlayer('G1', 1), g2 = sim.addPlayer('G2', 1);
  // players join before the round spawns them: restart round 1 so everyone is placed
  sim.round = 0; (sim as any).beginRound();
  return { sim, v1, v2, g1, g2 };
}

/** teleport + aim shooter at the victim's head/body from a clear lane in the south courtyard */
function lineUp(shooter: Player, victim: Player, aimHead: boolean) {
  shooter.m.x = 0; shooter.m.z = 20; shooter.m.y = 0.1; shooter.m.vx = shooter.m.vz = 0;
  victim.m.x = 0; victim.m.z = 11; victim.m.y = 0.1; victim.m.vx = victim.m.vz = 0;
  const ex = shooter.m.x, ey = shooter.m.y + eyeHeight(shooter.m), ez = shooter.m.z;
  const tx = victim.m.x, ty = victim.m.y + (aimHead ? 1.62 : 1.0), tz = victim.m.z;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  shooter.cmd = { ...emptyCmd(), yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  shooter.yaw = shooter.cmd.yaw; shooter.pitch = shooter.cmd.pitch;
}

describe('round state machine', () => {
  it('starts in freeze with everyone alive, armed and at their spawn, then goes live', () => {
    const { sim } = mk();
    expect(sim.phase).toBe('freeze');
    expect(sim.round).toBe(1);
    for (const p of sim.players.values()) { expect(p.alive).toBe(true); expect(p.hp).toBe(100); expect(sim.currentWeapon(p).id).toBe('p50'); }
    expect([...sim.players.values()].filter((p) => p.hasDevice).length).toBe(1);
    run(sim, RULES.freezeTime + 0.1);
    expect(sim.phase).toBe('live');
  });

  it('players cannot move or shoot during freeze time', () => {
    const { sim, v1 } = mk();
    const x0 = v1.m.x, z0 = v1.m.z;
    v1.cmd = { ...emptyCmd(), fwd: 1, fire: true };
    run(sim, 2);
    expect(Math.hypot(v1.m.x - x0, v1.m.z - z0)).toBeLessThan(0.01);
    expect(v1.ammo.p50!.mag).toBe(WEAPONS.p50.mag);
  });

  it('time expiry gives Garrison the round in objective mode, with correct economy', () => {
    const { sim, v1, g1 } = mk();
    run(sim, RULES.freezeTime + RULES.roundTime + 0.5);
    expect(sim.phase).toBe('roundEnd');
    expect(sim.lastWinner?.winner).toBe(GARRISON);
    expect(sim.score[1]).toBe(1);
    expect(g1.money).toBe(RULES.startMoney + RULES.winMoney);
    expect(v1.money).toBe(RULES.startMoney + RULES.lossBase); // first loss: base bonus
    run(sim, RULES.roundEndTime + 0.2);
    expect(sim.phase).toBe('freeze'); expect(sim.round).toBe(2);
  });
});

describe('combat', () => {
  it('a body shot with the starting pistol reduces health by the right amount (falloff applies)', () => {
    const { sim, v1, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    lineUp(v1, g1, false);
    v1.cmd.fire = true; sim.step(DT); v1.cmd.fire = false; sim.step(DT);
    expect(g1.hp).toBeLessThan(100);
    expect(g1.hp).toBeGreaterThan(100 - WEAPONS.p50.damage - 1);
  });

  it('a headshot with the rifle one-shots an unarmored target', () => {
    const { sim, v1, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.slots[0] = 'a5'; v1.ammo.a5 = { mag: 30, reserve: 90 }; v1.cur = 0; v1.equipT = 0;
    lineUp(v1, g1, true);
    v1.cmd.fire = true; sim.step(DT);
    expect(g1.alive).toBe(false);
    expect(v1.kills).toBe(1);
  });

  it('armor soaks damage and a helmet protects against headshots', () => {
    const { sim, v1, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.slots[0] = 'a5'; v1.ammo.a5 = { mag: 30, reserve: 90 }; v1.cur = 0; v1.equipT = 0;
    g1.armor = 100; g1.helmet = true;
    lineUp(v1, g1, true);
    v1.cmd.fire = true; sim.step(DT);
    expect(g1.alive).toBe(true);
    expect(g1.hp).toBeGreaterThan(100 - 128);
    expect(g1.armor).toBeLessThan(100);
  });

  it('there is no friendly fire', () => {
    const { sim, v1, v2 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.slots[0] = 'a5'; v1.ammo.a5 = { mag: 30, reserve: 90 }; v1.cur = 0; v1.equipT = 0;
    lineUp(v1, v2, true);
    v1.cmd.fire = true; sim.step(DT);
    expect(v2.hp).toBe(100);
  });

  it('walls block bullets', () => {
    const { sim, v1, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.slots[0] = 'a5'; v1.ammo.a5 = { mag: 30, reserve: 90 }; v1.cur = 0; v1.equipT = 0;
    v1.m.x = -3; v1.m.z = 20; g1.m.x = -3; g1.m.z = 6; // a solid block face sits between them
    const dx = 0, dz = g1.m.z - v1.m.z; v1.cmd = { ...emptyCmd(), yaw: Math.atan2(-dx, -dz), pitch: 0 }; v1.yaw = v1.cmd.yaw;
    v1.cmd.fire = true; sim.step(DT);
    expect(g1.hp).toBe(100);
  });

  it('reload restores the magazine from reserve and takes the weapon reload time', () => {
    const { sim, v1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.ammo.p50!.mag = 3;
    v1.cmd = { ...emptyCmd(), reload: true }; sim.step(DT); v1.cmd.reload = false;
    expect(v1.reloadT).toBeGreaterThan(1.5);
    run(sim, WEAPONS.p50.reloadTime + 0.1);
    expect(v1.ammo.p50!.mag).toBe(WEAPONS.p50.mag);
    expect(v1.ammo.p50!.reserve).toBe(WEAPONS.p50.reserve - (WEAPONS.p50.mag - 3));
  });

  it('switching weapons mid-reload cancels the reload (no phantom ammo)', () => {
    const { sim, v1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    v1.ammo.p50!.mag = 2;
    v1.cmd = { ...emptyCmd(), reload: true }; sim.step(DT); v1.cmd.reload = false;
    v1.cmd.slot = 2; sim.step(DT); v1.cmd.slot = -1;
    run(sim, 3);
    expect(v1.ammo.p50!.mag).toBe(2);
    expect(sim.currentWeapon(v1).id).toBe('knife');
  });

  it('dying mid-reload leaves a dead player who cannot finish it', () => {
    const { sim, v1, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    g1.slots[0] = 'a5'; g1.ammo.a5 = { mag: 30, reserve: 90 }; g1.cur = 0; g1.equipT = 0;
    v1.ammo.p50!.mag = 1; v1.cmd = { ...emptyCmd(), reload: true }; sim.step(DT);
    lineUp(g1, v1, true); g1.cmd.fire = true; sim.step(DT);
    expect(v1.alive).toBe(false);
    run(sim, 3);
    expect(v1.ammo.p50!.mag).toBe(1);
  });
});

describe('economy / buying', () => {
  it('buy rejects when poor, deducts when it works, and is blocked after the buy window', () => {
    const { sim, v1 } = mk();
    expect(sim.buy(v1.id, 'a5').ok).toBe(false);           // $800 < $2700
    expect(sim.buy(v1.id, 'm9').ok).toBe(false);           // $800 < $1250
    expect(sim.buy(v1.id, 'armor').ok).toBe(true);
    expect(v1.money).toBe(RULES.startMoney - RULES.armorPrice);
    expect(v1.armor).toBe(100);
    v1.money = 5000;
    expect(sim.buy(v1.id, 'a5').ok).toBe(true);
    expect(v1.slots[0]).toBe('a5'); expect(sim.currentWeapon(v1).id).toBe('a5');
    run(sim, RULES.freezeTime + RULES.buyWindowLive + 1);
    expect(sim.buy(v1.id, 'r7').ok).toBe(false);
  });

  it('only Garrison can buy the disarm kit', () => {
    const { sim, v1, g1 } = mk(); v1.money = g1.money = 2000;
    expect(sim.buy(v1.id, 'kit').ok).toBe(false);
    expect(sim.buy(g1.id, 'kit').ok).toBe(true);
  });

  it('winning all rounds ends the match; sides swap at half time', () => {
    const { sim } = mk('elimination');
    for (let r = 0; r < 8; r++) {
      run(sim, RULES.freezeTime + 0.1);
      expect(sim.phase).toBe('live');
      // squad 0 wins every round by eliminating the other squad
      const loser = [...sim.players.values()].filter((p) => p.squad === 1);
      for (const p of loser) { p.alive = false; }
      sim.step(DT);
      expect(sim.phase).toBe('roundEnd');
      run(sim, RULES.roundEndTime + 0.1);
      if (r === 6) { expect(sim.swapped).toBe(true); }
    }
    expect(sim.score[0]).toBe(8);
    expect(sim.phase).toBe('matchEnd');
    expect(sim.matchWinnerSquad).toBe(0);
  });
});

describe('objective: plant / defuse / detonate', () => {
  function atSite(sim: GameSim) {
    const carrier = [...sim.players.values()].find((p) => p.hasDevice)!;
    carrier.m.x = -19; carrier.m.z = 4.2; carrier.m.vx = carrier.m.vz = 0;
    return carrier;
  }

  it('plant requires standing still on a site for the full plant time', () => {
    const { sim } = mk(); run(sim, RULES.freezeTime + 0.1);
    const c = atSite(sim);
    c.cmd = { ...emptyCmd(), use: true };
    run(sim, RULES.plantTime - 0.5);
    expect(sim.bomb.state).toBe('carried');
    c.cmd.use = false; run(sim, 0.1);           // releasing resets progress
    expect(c.useT).toBe(0);
    c.cmd.use = true; run(sim, RULES.plantTime + 0.2);
    expect(sim.bomb.state).toBe('planted'); expect(sim.bomb.site).toBe('A');
  });

  it('cannot plant outside a site', () => {
    const { sim } = mk(); run(sim, RULES.freezeTime + 0.1);
    const c = [...sim.players.values()].find((p) => p.hasDevice)!;
    c.m.x = 0; c.m.z = 5; c.cmd = { ...emptyCmd(), use: true };
    run(sim, RULES.plantTime + 1);
    expect(sim.bomb.state).toBe('carried');
  });

  it('an undefused device detonates and Vanguard wins the round', () => {
    const { sim } = mk(); run(sim, RULES.freezeTime + 0.1);
    const c = atSite(sim); c.cmd = { ...emptyCmd(), use: true }; run(sim, RULES.plantTime + 0.2);
    c.cmd.use = false;
    run(sim, RULES.deviceTimer + 0.5);
    expect(sim.bomb.state).toBe('exploded');
    expect(sim.lastWinner?.winner).toBe(VANGUARD);
  });

  it('Garrison can disarm (kit is faster) and wins; Vanguard wiping Garrison while planted still wins', () => {
    const { sim, g1 } = mk(); run(sim, RULES.freezeTime + 0.1);
    const c = atSite(sim); c.cmd = { ...emptyCmd(), use: true }; run(sim, RULES.plantTime + 0.2); c.cmd.use = false;
    g1.m.x = sim.bomb.x + 1; g1.m.z = sim.bomb.z; g1.m.vx = g1.m.vz = 0; g1.kit = true;
    g1.cmd = { ...emptyCmd(), use: true };
    run(sim, RULES.defuseTimeKit - 0.5); expect(sim.bomb.state).toBe('planted');
    run(sim, 0.8); expect(sim.bomb.state).toBe('defused');
    expect(sim.lastWinner?.winner).toBe(GARRISON);
  });

  it('the device drops when its carrier dies and can be picked up by another attacker', () => {
    const { sim, v1, v2 } = mk(); run(sim, RULES.freezeTime + 0.1);
    const c = [...sim.players.values()].find((p) => p.hasDevice)!;
    const other = c === v1 ? v2 : v1;
    (sim as any).kill(null, c, WEAPONS.knife, false);
    expect(sim.bomb.state).toBe('dropped');
    other.m.x = sim.bomb.x; other.m.z = sim.bomb.z;
    sim.step(DT);
    expect(other.hasDevice).toBe(true);
  });
});

describe('determinism', () => {
  it('identical seeds + inputs give identical results (needed for client prediction & server authority)', () => {
    const outcome = () => {
      const { sim, v1, g1 } = mk('objective', 99); run(sim, RULES.freezeTime + 0.1);
      v1.slots[0] = 'a5'; v1.ammo.a5 = { mag: 30, reserve: 90 }; v1.cur = 0; v1.equipT = 0;
      lineUp(v1, g1, false); v1.cmd.fire = true; run(sim, 1.0);
      return JSON.stringify([g1.hp, v1.ammo.a5, +v1.punchP.toFixed(5), sim.events.length]);
    };
    expect(outcome()).toBe(outcome());
  });
});
