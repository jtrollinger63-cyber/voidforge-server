import { describe, it, expect } from 'vitest';
import { GameSim, RULES } from '../src/gameplay/sim.ts';
import { fillWithBots } from '../src/gameplay/bots.ts';

const DT = 1 / 60;

function match(difficulty: 'easy' | 'normal' | 'hard', mode: 'objective' | 'elimination', seed: number) {
  const sim = new GameSim({ mode, seed, skipWarmup: true });
  fillWithBots(sim, 5, difficulty);
  sim.round = 0; (sim as any).beginRound();
  return sim;
}

describe('bots', () => {
  it('leave their spawn and make contact: every bot moves >10 m in the first 25 s of a live round', () => {
    const sim = match('normal', 'objective', 3);
    while (sim.phase === 'freeze') sim.step(DT);
    const start = new Map([...sim.players.values()].map((p) => [p.id, [p.m.x, p.m.z] as const]));
    let maxD = new Map<number, number>();
    for (let t = 0; t < 25 && sim.phase === 'live'; t += DT) {
      sim.step(DT);
      for (const p of sim.players.values()) { const s = start.get(p.id)!; maxD.set(p.id, Math.max(maxD.get(p.id) ?? 0, Math.hypot(p.m.x - s[0], p.m.z - s[1]))); }
    }
    const lazy = [...sim.players.values()].filter((p) => (maxD.get(p.id) ?? 0) < 10 && p.alive);
    expect(lazy.map((p) => p.name)).toEqual([]);
  });

  it.each(['easy', 'normal', 'hard'] as const)('%s bots finish whole rounds with kills and a winner (objective)', (d) => {
    const sim = match(d, 'objective', 11);
    let kills = 0, ends = 0, ticks = 0;
    while (ends < 3 && ticks++ < 60 * 60 * 15) {
      sim.step(DT);
      for (const e of sim.drainEvents()) { if (e.t === 'kill') kills++; if (e.t === 'roundEnd') ends++; }
    }
    expect(ends).toBe(3);
    expect(kills).toBeGreaterThan(3);
  });

  it('a full practice match ends (first to 8) and bots never get stuck in an endless round', () => {
    const sim = match('normal', 'objective', 5);
    let ticks = 0;
    while (sim.phase !== 'matchEnd' && ticks++ < 60 * 60 * 60) sim.step(DT);
    expect(sim.phase).toBe('matchEnd');
    expect(Math.max(...sim.score)).toBe(RULES.roundsToWin);
    // wall-clock-ish sanity: rounds cannot last longer than the timer + planted device + round end
    expect(ticks / 60).toBeLessThan((RULES.freezeTime + RULES.roundTime + RULES.deviceTimer + RULES.roundEndTime) * 15 + 60);
  });

  it('elimination mode also resolves', () => {
    const sim = match('hard', 'elimination', 21);
    let ends = 0, ticks = 0;
    while (ends < 2 && ticks++ < 60 * 60 * 10) { sim.step(DT); for (const e of sim.drainEvents()) if (e.t === 'roundEnd') ends++; }
    expect(ends).toBe(2);
  });
});
