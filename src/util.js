import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, { repeat = false, anisotropy = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/** Soft radial glow used for smoke, lamp halos, moon, etc. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { anisotropy: 1 });
}

export const fmtTime = (t) => {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

// ---------------------------------------------------------------------------------------------
// seeded 2D gradient noise (fast enough for terrain generation and runtime height queries)
// ---------------------------------------------------------------------------------------------
export function makeNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise2(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const X = xi & 255, Z = zi & 255;
    const g00 = perm[X + perm[Z]], g10 = perm[X + 1 + perm[Z]], g01 = perm[X + perm[Z + 1]], g11 = perm[X + 1 + perm[Z + 1]];
    const n00 = gx[g00] * xf + gz[g00] * zf, n10 = gx[g10] * (xf - 1) + gz[g10] * zf;
    const n01 = gx[g01] * xf + gz[g01] * (zf - 1), n11 = gx[g11] * (xf - 1) + gz[g11] * (zf - 1);
    const u = fade(xf), v = fade(zf);
    return (n00 + (n10 - n00) * u) + ((n01 + (n11 - n01) * u) - (n00 + (n10 - n00) * u)) * v; // ~[-0.7, 0.7]
  }
  function fbm(x, z, oct = 4) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += noise2(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; } return s / n * 1.45; }
  function ridged(x, z, oct = 4) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += (1 - Math.abs(noise2(x * f, z * f) * 1.8)) * a; n += a; a *= 0.5; f *= 2.1; } return s / n; }
  return { noise2, fbm, ridged };
}
