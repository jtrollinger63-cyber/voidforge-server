/**
 * Single source of truth for which CC0 pack assets the game uses, what we call them, and
 * how aggressively each is simplified. IDs come from https://3dassets.dev/api/v1/packs/tactical-shooter-hill-town
 */
export interface PieceSpec {
  id: number;
  name: string;
  /** Target triangle count after simplification (omit to keep the original). */
  tris?: number;
  /** meshopt simplification error cap, relative to mesh extent (default 0.02). Larger = more aggressive. */
  err?: number;
}

export const CDN = (id: number) => `https://cdn.3dassets.dev/assets/${id}/v1/model.glb`;

export const KIT_PIECES: PieceSpec[] = [
  { id: 27512, name: 'wall-plaster-bay' },
  { id: 27514, name: 'wall-ochre-bay' },
  { id: 27511, name: 'wall-shuttered-window', tris: 640, err: 0.04 },
  { id: 27513, name: 'wall-timber-door', tris: 700, err: 0.04 },
  { id: 27516, name: 'wall-arched-passage' },
  { id: 27517, name: 'balcony-bay', tris: 800, err: 0.04 },
  { id: 27515, name: 'corner-post', tris: 140, err: 0.08 },
  { id: 27525, name: 'floor-tile' },
  { id: 27518, name: 'roof-tile-slope' },
  { id: 27521, name: 'roof-ridge-cap', tris: 200 },
  { id: 27519, name: 'roof-gable-half' },
  { id: 27520, name: 'roof-parapet', tris: 150, err: 0.08 },
  { id: 27522, name: 'external-stair-run', tris: 1800 },
  { id: 27523, name: 'stone-step-block', tris: 400 },
  { id: 27524, name: 'freestanding-archway', tris: 700 },
  { id: 27527, name: 'low-garden-wall', tris: 380 },
  { id: 27528, name: 'octagonal-fountain', tris: 1300 },
  { id: 27529, name: 'market-awning-stall', tris: 1300 },
  { id: 27530, name: 'crate-stack', tris: 900, err: 0.05 },
  { id: 27531, name: 'wine-barrel', tris: 360, err: 0.06 },
  { id: 27532, name: 'sandbag-wall', tris: 1000, err: 0.06 },
  { id: 27533, name: 'jersey-barrier' },
  { id: 27534, name: 'oil-drum', tris: 300, err: 0.06 },
  { id: 27535, name: 'stone-bench', tris: 480 },
  { id: 27536, name: 'potted-olive-tree', tris: 800, err: 0.05 },
  { id: 27537, name: 'wall-lamp-bracket', tris: 360 },
  { id: 27538, name: 'timber-double-gate', tris: 1100 },
  { id: 27539, name: 'site-marker-board', tris: 500 },
  { id: 27540, name: 'barrier-tape-stand' },
  { id: 27560, name: 'objective-device', tris: 900 },
  { id: 27561, name: 'defuse-kit', tris: 400 },
];

export const WEAPON3P_PIECES: PieceSpec[] = [
  { id: 27550, name: 'attacker-rifle', tris: 1400 },
  { id: 27549, name: 'defender-carbine', tris: 1400 },
  { id: 27542, name: 'service-pistol', tris: 800 },
  { id: 27545, name: 'full-smg', tris: 1300 },
  { id: 27547, name: 'pump-shotgun', tris: 1400 },
  { id: 27551, name: 'marksman-rifle', tris: 1400 },
  { id: 27554, name: 'combat-knife', tris: 500 },
  { id: 27555, name: 'frag-grenade', tris: 500 },
  { id: 27556, name: 'flash-grenade', tris: 350 },
  { id: 27557, name: 'smoke-grenade', tris: 400 },
];
