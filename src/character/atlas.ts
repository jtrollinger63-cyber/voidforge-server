/**
 * Procedural soldier texture atlas, painted on a canvas at load (0 bytes shipped).
 * One atlas per team: SAME UV layout and geometry, different palette => shared-texture strategy with
 * clearly distinguishable teams (sand/terracotta Vanguard vs olive/steel-blue Garrison).
 */
import * as THREE from 'three';
import { CELLS, CELL_PX, ATLAS_SIZE, type Kind } from './atlas-layout.ts';

interface Palette {
  jacket: string[]; pants: string[]; helmet: string; vest: string; webbing: string; tan: string; boot: string; glove: string;
  patchA: string; patchB: string; cloth2: string; cloth2b: string; skin: string; metal: string; pad: string;
}

export const PALETTES: Record<0 | 1, Palette> = {
  // Vanguard: desert multi-tone, terracotta/orange accents
  0: { jacket: ['#b6a077', '#9a8359', '#cfbc93', '#7b6a47'], pants: ['#aa946b', '#917d57', '#c3ad85', '#7a6a47'], helmet: '#98835b', vest: '#6f5f43', webbing: '#3b3228', tan: '#a68e63', boot: '#3a2d24', glove: '#2e2924', patchA: '#e0702b', patchB: '#2b2623', cloth2: '#c2552d', cloth2b: '#7d3320', skin: '#c38e68', metal: '#33363a', pad: '#37312b' },
  // Garrison: olive/grey woodland, steel-blue accents
  1: { jacket: ['#617055', '#4a5640', '#7f8d69', '#38432f'], pants: ['#55614b', '#434e3a', '#6f7d5c', '#323b29'], helmet: '#4c5546', vest: '#30363a', webbing: '#1f2326', tan: '#6f6a52', boot: '#1c1e20', glove: '#1e2123', patchA: '#3f8fd8', patchB: '#1c2227', cloth2: '#26394a', cloth2b: '#16222d', skin: '#a9795a', metal: '#2b3035', pad: '#25292c' },
};

function rng(seed: number) { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }

function cellRect(k: Kind) { const [c, r, w, h] = CELLS[k]; return { x: c * CELL_PX, y: r * CELL_PX, w: w * CELL_PX, h: h * CELL_PX }; }

function noise(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amt: number, seed: number) {
  const img = ctx.getImageData(x, y, w, h); const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * amt * 255; img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n)); img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n)); img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n)); }
  ctx.putImageData(img, x, y);
}

function blobs(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], seed: number, count: number, size: number) {
  const r = rng(seed);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (const col of colors) {
    ctx.fillStyle = col;
    for (let i = 0; i < count; i++) {
      const cx = x + r() * w, cy = y + r() * h, rad = size * (0.5 + r()), rot = r() * Math.PI;
      ctx.beginPath(); ctx.ellipse(cx, cy, rad, rad * (0.4 + r() * 0.5), rot, 0, Math.PI * 2); ctx.fill();
      if (r() < 0.5) { ctx.beginPath(); ctx.ellipse(cx + rad * 0.6, cy + rad * 0.3, rad * 0.6, rad * 0.35, rot + 0.7, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.restore();
}

export function paintAtlas(canvas: HTMLCanvasElement, team: 0 | 1): void {
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const P = PALETTES[team];
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const fill = (k: Kind, color: string) => { const c = cellRect(k); ctx.fillStyle = color; ctx.fillRect(c.x, c.y, c.w, c.h); return c; };

  // camouflage fabrics
  for (const [k, cols, seed] of [['jacket', P.jacket, 11], ['pants', P.pants, 29]] as const) {
    const c = fill(k, cols[0]!);
    blobs(ctx, c.x, c.y, c.w, c.h, cols.slice(1), seed + team * 7, 10, 20);
    noise(ctx, c.x, c.y, c.w, c.h, 0.07, seed);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;                         // faint weave
    for (let i = 0; i < c.w; i += 3) { ctx.beginPath(); ctx.moveTo(c.x + i, c.y); ctx.lineTo(c.x + i, c.y + c.h); ctx.stroke(); }
  }
  // skin
  { const c = fill('skin', P.skin); const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.12)'); ctx.fillStyle = g; ctx.fillRect(c.x, c.y, c.w, c.h); noise(ctx, c.x, c.y, c.w, c.h, 0.03, 3); }
  // helmet shell: speckle + faint band
  { const c = fill('helmet', P.helmet); noise(ctx, c.x, c.y, c.w, c.h, 0.10, 5); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(c.x, c.y + c.h * 0.55, c.w, 3); }
  // vest: MOLLE webbing grid
  { const c = fill('vest', P.vest); noise(ctx, c.x, c.y, c.w, c.h, 0.07, 7); ctx.fillStyle = 'rgba(0,0,0,0.28)'; for (let yy = 4; yy < c.h; yy += 6) for (let xx = 2; xx < c.w; xx += 8) ctx.fillRect(c.x + xx, c.y + yy, 5, 2); ctx.fillStyle = 'rgba(255,255,255,0.07)'; for (let yy = 7; yy < c.h; yy += 6) ctx.fillRect(c.x, c.y + yy, c.w, 1); }
  // webbing / straps: dark with cross weave
  { const c = fill('webbing', P.webbing); noise(ctx, c.x, c.y, c.w, c.h, 0.07, 9); ctx.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < c.w; i += 4) ctx.fillRect(c.x + i, c.y, 1, c.h); }
  { const c = fill('strapTan', P.tan); noise(ctx, c.x, c.y, c.w, c.h, 0.07, 10); ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < c.h; i += 4) ctx.fillRect(c.x, c.y + i, c.w, 1); }
  // metal: gunmetal gradient and scratches
  { const c = fill('metal', P.metal); const g = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.2)'); ctx.fillStyle = g; ctx.fillRect(c.x, c.y, c.w, c.h); noise(ctx, c.x, c.y, c.w, c.h, 0.06, 12); }
  { const c = fill('glove', P.glove); noise(ctx, c.x, c.y, c.w, c.h, 0.06, 13); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.setLineDash([3, 3]); ctx.strokeRect(c.x + 8, c.y + 8, c.w - 16, c.h - 16); ctx.setLineDash([]); }
  { const c = fill('boot', P.boot); noise(ctx, c.x, c.y, c.w, c.h, 0.07, 14); const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(c.x, c.y, c.w, c.h); }
  { const c = fill('lens', '#0e1822'); const g = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h); g.addColorStop(0, 'rgba(110,170,220,0.45)'); g.addColorStop(0.35, 'rgba(110,170,220,0.0)'); ctx.fillStyle = g; ctx.fillRect(c.x, c.y, c.w, c.h); }
  // team patches
  { const c = fill('patchA', P.patchA); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillRect(c.x + 22, c.y + 14, 20, 36); ctx.fillRect(c.x + 14, c.y + 22, 36, 8); }
  { const c = fill('patchB', P.patchB); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(c.x + 8, c.y + 28, 48, 6); ctx.fillStyle = P.patchA; ctx.fillRect(c.x + 8, c.y + 40, 48, 4); }
  { const c = fill('cloth2', P.cloth2); ctx.fillStyle = P.cloth2b; for (let i = -c.h; i < c.w; i += 10) { ctx.beginPath(); ctx.moveTo(c.x + i, c.y + c.h); ctx.lineTo(c.x + i + 5, c.y + c.h); ctx.lineTo(c.x + i + c.h + 5, c.y); ctx.lineTo(c.x + i + c.h, c.y); ctx.fill(); } noise(ctx, c.x, c.y, c.w, c.h, 0.06, 15); }
  { const c = fill('pad', P.pad); noise(ctx, c.x, c.y, c.w, c.h, 0.05, 16); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12); }
  { const c = fill('rubber', '#1b1c1e'); noise(ctx, c.x, c.y, c.w, c.h, 0.05, 17); }
}

const cache = new Map<number, THREE.CanvasTexture>();
export function teamAtlas(team: 0 | 1, anisotropy = 4): THREE.CanvasTexture {
  let t = cache.get(team);
  if (!t) {
    const canvas = document.createElement('canvas');
    paintAtlas(canvas, team);
    t = new THREE.CanvasTexture(canvas);
    t.flipY = false;                       // glTF UV convention (v grows downward)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    cache.set(team, t);
  }
  return t;
}
