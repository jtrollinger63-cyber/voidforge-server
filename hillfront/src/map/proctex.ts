/**
 * Procedural, tileable textures generated at load time on a 2D canvas.
 * Costs zero download bytes; replaces thousands of triangles of cobble relief with an albedo + normal map.
 */
import * as THREE from 'three';

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** jittered-grid "cobblestone" height field in [0,1], tileable */
function cobbleHeight(size: number, cells: number, seed: number): { height: Float32Array; tone: Float32Array } {
  const rnd = mulberry32(seed);
  const pts: { x: number; y: number; tone: number; s: number }[] = [];
  const step = size / cells;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts.push({ x: (i + 0.5 + (rnd() - 0.5) * 0.55) * step, y: (j + 0.5 + (rnd() - 0.5) * 0.55) * step, tone: rnd(), s: 0.85 + rnd() * 0.3 });
  }
  const height = new Float32Array(size * size), tone = new Float32Array(size * size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    // nearest + second-nearest feature point (with wrap) -> cell interior distance
    let d1 = 1e9, d2 = 1e9, t1 = 0, sc = 1;
    const ci = Math.floor(px / step), cj = Math.floor(py / step);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
      const p = pts[jj * cells + ii]!;
      let dx = Math.abs(px - p.x), dy = Math.abs(py - p.y);
      if (dx > size / 2) dx = size - dx; if (dy > size / 2) dy = size - dy;
      const d = Math.hypot(dx, dy) / p.s;
      if (d < d1) { d2 = d1; d1 = d; t1 = p.tone; sc = p.s; } else if (d < d2) d2 = d;
    }
    const edge = (d2 - d1) / step; // 0 at the grout line, grows toward the cell centre
    const h = Math.min(1, Math.max(0, edge * 2.6));
    height[py * size + px] = h * h * (3 - 2 * h);
    tone[py * size + px] = t1 + (sc - 1);
  }
  return { height, tone };
}

export interface TexturePair { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; }

export function makeCobbleTextures(size = 512, anisotropy = 4): TexturePair {
  const { height, tone } = cobbleHeight(size, 12, 1337);
  const albedo = document.createElement('canvas'); albedo.width = albedo.height = size;
  const nrm = document.createElement('canvas'); nrm.width = nrm.height = size;
  const actx = albedo.getContext('2d')!, nctx = nrm.getContext('2d')!;
  const ai = actx.createImageData(size, size), ni = nctx.createImageData(size, size);
  const rnd = mulberry32(99);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const h = height[i]!, t = tone[i]!;
    // warm limestone setts with grout in the cracks, slight grain
    const grain = (rnd() - 0.5) * 14;
    const base = 150 + t * 46 + grain;
    const k = 0.45 + 0.55 * h; // grout darkening
    ai.data[i * 4] = Math.min(255, (base + 12) * k);
    ai.data[i * 4 + 1] = Math.min(255, (base + 3) * k);
    ai.data[i * 4 + 2] = Math.min(255, (base - 18 - t * 6) * k);
    ai.data[i * 4 + 3] = 255;
    // normal from height (wrap)
    const hl = height[y * size + ((x - 1 + size) % size)]!, hr = height[y * size + ((x + 1) % size)]!;
    const hu = height[((y - 1 + size) % size) * size + x]!, hd = height[((y + 1) % size) * size + x]!;
    const nx = (hl - hr) * 2.2, ny = (hu - hd) * 2.2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    ni.data[i * 4] = (nx / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 3] = 255;
  }
  actx.putImageData(ai, 0, 0); nctx.putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(albedo), normalMap = new THREE.CanvasTexture(nrm);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}
