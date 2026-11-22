/**
 * Team materials for the soldier: ONE material per team (shared by every soldier of that team => 1 draw call each).
 * Texture = procedural atlas (src/character/atlas.ts), shading = baked vertex-colour AO, rough fabric look (no plastic gloss).
 */
import * as THREE from 'three';
import { teamAtlas } from './atlas.ts';

export const TEAM_COLORS = {
  0: { name: 'Vanguard', primary: 0xb5683a, accent: 0xe0702b },
  1: { name: 'Garrison', primary: 0x3d6a8f, accent: 0x3f8fd8 },
} as const;

const cache = new Map<number, THREE.Material[]>();
export function teamMaterials(team: 0 | 1, _count = 1): THREE.Material[] {
  let m = cache.get(team);
  if (!m) {
    m = [new THREE.MeshStandardMaterial({ map: teamAtlas(team), vertexColors: true, roughness: 0.88, metalness: 0.03, envMapIntensity: 0.55 })];
    cache.set(team, m);
  }
  return m;
}
