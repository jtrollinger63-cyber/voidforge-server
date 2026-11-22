/** Soldier texture-atlas layout: 8x8 grid of 64 px cells (512 px). Shared by the build tool (UVs) and the runtime painter. */
export type Kind =
  | 'jacket' | 'pants' | 'skin' | 'helmet' | 'vest' | 'webbing' | 'metal' | 'glove' | 'boot' | 'lens'
  | 'patchA' | 'patchB' | 'cloth2' | 'strapTan' | 'pad' | 'rubber';

/** [col, row, wCells, hCells] */
export const CELLS: Record<Kind, [number, number, number, number]> = {
  jacket: [0, 0, 2, 2], pants: [2, 0, 2, 2], skin: [4, 0, 1, 1], helmet: [5, 0, 1, 1], vest: [6, 0, 1, 1], webbing: [7, 0, 1, 1],
  metal: [4, 1, 1, 1], glove: [5, 1, 1, 1], boot: [6, 1, 1, 1], lens: [7, 1, 1, 1],
  patchA: [0, 2, 1, 1], patchB: [1, 2, 1, 1], cloth2: [2, 2, 1, 1], strapTan: [3, 2, 1, 1], pad: [4, 2, 1, 1], rubber: [5, 2, 1, 1],
};
export const ATLAS_SIZE = 512;
export const CELL_PX = 64;
