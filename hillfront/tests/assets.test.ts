import { describe, it, expect, beforeAll } from 'vitest';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { existsSync, readFileSync } from 'node:fs';
import { CELLS } from '../src/character/atlas-layout.ts';

/** The 53 action names listed by the Toolbench kit (read from the original figure.glb, verified at build time). */
const EXPECTED_CLIPS = ['aim', 'aim_bow', 'aim_heavy', 'aim_polearm', 'aim_rifle', 'crouch', 'crouch_blade', 'crouch_bow', 'crouch_heavy', 'crouch_polearm', 'crouch_rifle', 'crouch_sidearm', 'die', 'fire', 'fire_bow', 'fire_heavy', 'fire_rifle', 'hit', 'idle', 'idle_blade', 'idle_bow', 'idle_heavy', 'idle_polearm', 'idle_rifle', 'idle_sidearm', 'jump', 'jump_rifle', 'melee', 'melee_polearm', 'reload', 'reload_rifle', 'run', 'run_blade', 'run_bow', 'run_heavy', 'run_polearm', 'run_rifle', 'run_sidearm', 'throw', 'throw_blade', 'throw_bow', 'throw_heavy', 'throw_polearm', 'throw_rifle', 'throw_sidearm', 'walk', 'walk_blade', 'walk_bow', 'walk_heavy', 'walk_polearm', 'walk_rifle', 'walk_sidearm', 'work'];
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Shoulder_L', 'UpperArm_L', 'LowerArm_L', 'Hand_L', 'Shoulder_R', 'UpperArm_R', 'LowerArm_R', 'Hand_R', 'UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'Toe_L', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R', 'Toe_R'];

let io: NodeIO;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
});

describe('optimized soldier.glb (Toolbench rig + makeover)', () => {
  let doc: Document;
  beforeAll(async () => { doc = await io.read('public/assets/soldier.glb'); });

  it('keeps all 53 original animation actions, by name', () => {
    const names = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
    expect(EXPECTED_CLIPS.length).toBe(53);
    expect(names).toEqual([...EXPECTED_CLIPS].sort());
  });

  it('keeps every clip complete: 66 channels (22 bones x t/r/s) with non-zero duration', () => {
    for (const a of doc.getRoot().listAnimations()) {
      expect(a.listChannels().length, a.getName()).toBe(66);
      const dur = Math.max(...a.listSamplers().map((s) => { const arr = s.getInput()!.getArray()!; return arr[arr.length - 1]!; }));
      expect(dur, a.getName()).toBeGreaterThan(0.3);
    }
  });

  it('keeps the 22-bone skeleton and the four sockets with the original hierarchy', () => {
    const skin = doc.getRoot().listSkins()[0]!;
    expect(skin.listJoints().map((j) => j.getName()).sort()).toEqual([...JOINTS].sort());
    const parent = (n: string) => doc.getRoot().listNodes().find((x) => x.getName() === n)!.getParentNode()?.getName();
    expect(parent('Socket_Hand_R')).toBe('Hand_R'); expect(parent('Socket_Hand_L')).toBe('Hand_L');
    expect(parent('Socket_Back')).toBe('Chest'); expect(parent('Socket_Head')).toBe('Head');
    expect(parent('Hand_R')).toBe('LowerArm_R');
  });

  it('is a single skinned primitive (one draw call per soldier) with atlas UVs inside the used cells', () => {
    const meshes = doc.getRoot().listMeshes();
    expect(meshes.length).toBe(1);
    expect(meshes[0]!.listPrimitives().length).toBe(1);
    const p = meshes[0]!.listPrimitives()[0]!;
    for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) expect(p.getAttribute(s), s).not.toBeNull();
    const uv = p.getAttribute('TEXCOORD_0')!;
    const lim = Math.max(...Object.values(CELLS).map(([c, r, w, h]) => Math.max(c + w, r + h))) / 8;
    for (let i = 0; i < uv.getCount(); i++) { const [u, v] = uv.getElement(i, [0, 0]) as [number, number]; expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(lim + 0.01); }
  });

  it('skin weights are sane: every vertex is bound, weights sum to ~1, joints are valid indices', () => {
    const p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const j = p.getAttribute('JOINTS_0')!, w = p.getAttribute('WEIGHTS_0')!;
    let worst = 0;
    for (let i = 0; i < w.getCount(); i++) {
      const wi = w.getElement(i, [0, 0, 0, 0]), ji = j.getElement(i, [0, 0, 0, 0]);
      const sum = wi[0]! + wi[1]! + wi[2]! + wi[3]!;
      worst = Math.max(worst, Math.abs(sum - 1));
      for (let k = 0; k < 4; k++) if (wi[k]! > 0) expect(ji[k]!).toBeLessThan(22);
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('is meaningfully richer than the stock figure (3368 tris) without blowing the budget', () => {
    let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices()!.getCount() / 3;
    expect(tris).toBeGreaterThan(3368 + 600);
    expect(tris).toBeLessThan(6000);
  });

  it('file size stays within budget', () => { expect(readFileSync('public/assets/soldier.glb').length).toBeLessThan(900 * 1024); });
});

describe('map kit + weapons', () => {
  it('kit.glb and weapons3p.glb exist, parse, and contain the pieces the map uses', async () => {
    for (const f of ['kit.glb', 'weapons3p.glb']) expect(existsSync(`public/assets/${f}`)).toBe(true);
    const kit = await io.read('public/assets/kit.glb');
    const names = new Set(kit.getRoot().listNodes().map((n) => n.getName()));
    for (const n of ['wall-plaster-bay', 'wall-arched-passage', 'corner-post', 'external-stair-run', 'octagonal-fountain']) expect(names.has(n), n).toBe(true);
    const w = await io.read('public/assets/weapons3p.glb');
    const wn = new Set(w.getRoot().listNodes().map((n) => n.getName()));
    for (const n of ['attacker-rifle', 'defender-carbine', 'service-pistol', 'full-smg', 'pump-shotgun', 'marksman-rifle', 'combat-knife']) expect(wn.has(n), n).toBe(true);
  });

  it('total optimized model bytes stay under 2 MB', () => {
    const total = ['soldier.glb', 'kit.glb', 'weapons3p.glb'].reduce((s, f) => s + readFileSync(`public/assets/${f}`).length, 0);
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });
});
