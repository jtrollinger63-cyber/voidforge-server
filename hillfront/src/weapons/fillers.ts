/**
 * Filler blocks that join the pieces of the CC0 weapon models that the pack leaves floating.
 *
 * The Hill Town weapons are kit-bashed from separate chunky pieces and ship WITHOUT their lower receiver: the pistol grip, the trigger
 * guard and the magazine hang 3-6 cm below the upper receiver, the front sight post floats 2.5 cm above the barrel, and the knife's pommel
 * rings sit behind the end of the handle core. (Measured with tools/scratch/detached2.ts on both the shipped GLB and the untouched
 * original download — it is how the asset is, not something our optimiser broke.) tests/weapons.test.ts proves every weapon is one
 * connected object once these blocks are added.
 *
 * Boxes are in WEAPON MODEL space (+Z muzzle, +Y up), [x0,y0,z0, x1,y1,z1]; each overlaps its neighbours by ~3 mm so no seam shows.
 */
import * as THREE from 'three';

type Ref = 'black' | 'timber' | 'handle' | 'iron';
/** [x0,y0,z0,x1,y1,z1, material?] */
export type Block = [number, number, number, number, number, number, Ref?];
export interface FillerSet { /** name of the kit material the blocks borrow their colour from (unless a block names its own) */ ref: Ref; blocks: Block[] }

/** pistol-grip neck, lower receiver + magwell, front-sight base — same recipe for every long gun, shifted along z */
const longGun = (ref: FillerSet['ref'], gz0: number, gz1: number, mz1: number, sightZ: [number, number] | null, rear?: [number, number]): FillerSet => ({
  ref,
  blocks: [
    [-0.018, 0.117, gz0 + 0.001, 0.018, 0.194, gz1 + 0.002],                               // grip neck: grip top -> lower receiver
    [-0.019, 0.189, gz0 + 0.001, 0.019, 0.227, mz1 + 0.002],                               // lower receiver / magwell under the upper receiver
    ...(rear ? [[-0.0245, 0.189, rear[0], 0.0245, 0.271, rear[1]] as Block] : []),         // SMG: the pack has no rear receiver at all
    ...(sightZ ? [[-0.0035, 0.268, sightZ[0], 0.0035, 0.299, sightZ[1], 'iron'] as Block] : []), // front sight base (barrel metal)
  ],
});

export const FILLERS: Record<string, FillerSet> = {
  'attacker-rifle':   longGun('black', -0.227, -0.136, -0.031, [0.2525, 0.2595]),
  'defender-carbine': longGun('black', -0.200, -0.109, -0.021, [0.2125, 0.2205]),
  'full-smg':         { ref: 'black', blocks: [[-0.0245, 0.189, -0.172, 0.0245, 0.271, -0.012], [-0.0035, 0.268, 0.1675, 0.0035, 0.299, 0.1765, 'iron']] },
  'pump-shotgun':     longGun('timber', -0.242, -0.151, -0.086, [0.2735, 0.2815]),
  'marksman-rifle':   (() => { const f = longGun('black', -0.255, -0.164, -0.040, null); f.blocks.push([-0.012, 0.266, -0.125, 0.012, 0.288, -0.095], [-0.012, 0.266, 0.095, 0.012, 0.288, 0.125]); return f; })(),   // scope mounts
  'combat-knife':     { ref: 'handle', blocks: [[-0.016, 0.004, -0.177, 0.016, 0.036, -0.119]] },   // handle core runs through the pommel rings
};

/** the kit material (colour) the blocks should copy, found by name in the loaded weapon */
export function fillerMaterial(root: THREE.Object3D, ref: Ref): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || found) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (ref === 'handle' ? /combat-knife_2$/.test(m.name) : mat.name === ref) found = mat;
  });
  return found;
}

/** one BoxGeometry per block, in weapon model space, with the kit material it should look like */
export function fillerGeometries(name: string): { geo: THREE.BufferGeometry; ref: Ref }[] {
  const set = FILLERS[name]; if (!set) return [];
  return set.blocks.map(([x0, y0, z0, x1, y1, z1, ref]) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return { geo: g, ref: ref ?? set.ref }; });
}
