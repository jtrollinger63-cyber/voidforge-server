// Silhouette data for the six bodies. t runs 0 (tail) -> 1 (nose); heights in metres above the ground.
// Each *K array is a list of [t, value] keyframes interpolated with a smooth cubic.
export const SHAPES = {
  coupe: {
    hw: [[0, 0.8], [0.04, 0.93], [0.12, 0.985], [0.25, 1], [0.5, 1], [0.75, 1], [0.9, 0.965], [0.97, 0.87], [1, 0.7]],
    deck: [[0, 0.8], [0.05, 0.94], [0.2, 0.975], [0.34, 0.96], [0.62, 0.93], [0.72, 0.9], [0.86, 0.8], [0.96, 0.64], [1, 0.5]],
    bot: [[0, 0.36], [0.04, 0.26], [0.15, 0.17], [0.85, 0.15], [0.96, 0.2], [1, 0.3]],
    cab: { t0: 0.34, t1: 0.46, t2: 0.66, t3: 0.78, roofY: 1.28, belt: 0.9, roofHW: 0.7, crown: 0.025, pillars: [[0.0, 0.05], [0.9, 1.0]], rake: 1.0 },
    wing: 'duck', scoop: 'none', grille: 'wide', head: 'sleek', tail: 'bar', exhaust: { n: 2, x: 0.5, y: 0.3, style: 'round' },
    splitter: 0.5, diffuser: 0.4, skirts: 0.35, cage: false, doors: [0.43, 0.6], hoodLine: 0.69, fuel: 0.2,
  },
  muscle: {
    hw: [[0, 0.84], [0.04, 0.95], [0.12, 0.99], [0.25, 1], [0.5, 1], [0.78, 1], [0.92, 0.975], [0.98, 0.9], [1, 0.8]],
    deck: [[0, 0.98], [0.06, 1.04], [0.2, 1.06], [0.4, 1.04], [0.62, 1.04], [0.7, 1.08], [0.86, 1.06], [0.97, 0.96], [1, 0.84]],
    bot: [[0, 0.38], [0.04, 0.3], [0.15, 0.2], [0.85, 0.19], [0.96, 0.24], [1, 0.34]],
    cab: { t0: 0.34, t1: 0.46, t2: 0.62, t3: 0.72, roofY: 1.42, belt: 1.02, roofHW: 0.72, crown: 0.03, pillars: [[0.0, 0.05], [0.47, 0.53], [0.93, 1.0]], rake: 0.8 },
    wing: 'lip', scoop: 'hood', grille: 'muscle', head: 'round', tail: 'blocks', exhaust: { n: 2, x: 0.55, y: 0.32, style: 'fat' },
    splitter: 0.3, diffuser: 0, skirts: 0.2, cage: false, doors: [0.4, 0.62], hoodLine: 0.7, fuel: 0.16,
  },
  super: {
    hw: [[0, 0.88], [0.05, 0.97], [0.14, 1], [0.3, 1], [0.5, 0.98], [0.7, 0.99], [0.88, 0.975], [0.96, 0.9], [1, 0.74]],
    deck: [[0, 0.86], [0.06, 0.98], [0.16, 1.02], [0.3, 0.98], [0.5, 0.88], [0.66, 0.84], [0.82, 0.74], [0.95, 0.62], [1, 0.5]],
    bot: [[0, 0.36], [0.04, 0.26], [0.15, 0.14], [0.85, 0.13], [0.96, 0.17], [1, 0.26]],
    cab: { t0: 0.4, t1: 0.52, t2: 0.7, t3: 0.84, roofY: 1.14, belt: 0.82, roofHW: 0.6, crown: 0.02, pillars: [[0.0, 0.07], [0.94, 1.0]], rake: 1.15 },
    wing: 'wing', scoop: 'vents', grille: 'low', head: 'sleek', tail: 'bar', exhaust: { n: 4, x: 0.22, y: 0.42, style: 'quad' },
    splitter: 0.9, diffuser: 0.9, skirts: 0.7, cage: false, doors: [0.5, 0.68], hoodLine: 0.78, fuel: 0.32, sideIntake: true,
  },
  rally: {
    hw: [[0, 0.9], [0.05, 0.97], [0.12, 0.99], [0.25, 1], [0.5, 1], [0.78, 1], [0.92, 0.97], [0.98, 0.9], [1, 0.8]],
    deck: [[0, 1.1], [0.04, 1.14], [0.14, 1.12], [0.34, 1.0], [0.62, 0.99], [0.74, 1.02], [0.88, 0.98], [0.97, 0.88], [1, 0.74]],
    bot: [[0, 0.42], [0.04, 0.34], [0.15, 0.26], [0.85, 0.25], [0.96, 0.3], [1, 0.4]],
    cab: { t0: 0.3, t1: 0.42, t2: 0.78, t3: 0.96, roofY: 1.46, belt: 1.04, roofHW: 0.76, crown: 0.03, pillars: [[0.0, 0.05], [0.5, 0.56], [0.93, 1.0]], rake: 0.9 },
    wing: 'rallywing', scoop: 'hood', grille: 'rally', head: 'rally', tail: 'small', exhaust: { n: 1, x: -0.42, y: 0.36, style: 'fat' },
    splitter: 0.25, diffuser: 0.2, skirts: 0.15, cage: true, doors: [0.44, 0.64], hoodLine: 0.68, fuel: 0.24, roofScoop: true,
  },
  track: {
    hw: [[0, 0.86], [0.05, 0.97], [0.14, 1], [0.3, 1], [0.5, 0.97], [0.72, 0.99], [0.9, 0.97], [0.97, 0.9], [1, 0.78]],
    deck: [[0, 0.82], [0.06, 0.95], [0.16, 0.98], [0.3, 0.93], [0.5, 0.88], [0.66, 0.84], [0.82, 0.76], [0.95, 0.64], [1, 0.52]],
    bot: [[0, 0.34], [0.04, 0.25], [0.15, 0.12], [0.85, 0.12], [0.96, 0.16], [1, 0.24]],
    cab: { t0: 0.4, t1: 0.52, t2: 0.68, t3: 0.82, roofY: 1.12, belt: 0.8, roofHW: 0.58, crown: 0.02, pillars: [[0.0, 0.07], [0.94, 1.0]], rake: 1.1 },
    wing: 'gtwing', scoop: 'roof', grille: 'low', head: 'sleek', tail: 'bar', exhaust: { n: 2, x: 0.18, y: 0.38, style: 'round' },
    splitter: 1.0, diffuser: 1.0, skirts: 1.0, cage: true, doors: [0.5, 0.68], hoodLine: 0.78, fuel: 0.3, roofScoop: true,
  },
  hyper: {
    hw: [[0, 0.9], [0.05, 0.98], [0.14, 1], [0.3, 1], [0.5, 0.97], [0.72, 1], [0.9, 0.98], [0.97, 0.9], [1, 0.74]],
    deck: [[0, 0.8], [0.06, 0.92], [0.16, 0.99], [0.3, 0.94], [0.5, 0.84], [0.66, 0.8], [0.82, 0.68], [0.95, 0.56], [1, 0.44]],
    bot: [[0, 0.36], [0.04, 0.24], [0.15, 0.1], [0.85, 0.1], [0.96, 0.14], [1, 0.22]],
    cab: { t0: 0.4, t1: 0.54, t2: 0.68, t3: 0.82, roofY: 1.06, belt: 0.76, roofHW: 0.55, crown: 0.02, pillars: [[0.0, 0.08], [0.92, 1.0]], rake: 1.25 },
    wing: 'active', scoop: 'vents', grille: 'low', head: 'hyper', tail: 'bar', exhaust: { n: 2, x: 0.16, y: 0.5, style: 'hex' },
    splitter: 1.0, diffuser: 1.0, skirts: 1.0, cage: false, doors: [0.5, 0.7], hoodLine: 0.8, fuel: 0.3, sideIntake: true,
  },
};

/** Smooth Catmull-Rom interpolation of [t, v] keyframes. */
export function interp(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
  const vm = i > 0 ? keys[i - 1][1] : v0, vp = i + 2 < n ? keys[i + 2][1] : v1;
  const tm = i > 0 ? keys[i - 1][0] : t0 - (t1 - t0), tp = i + 2 < n ? keys[i + 2][0] : t1 + (t1 - t0);
  const h = t1 - t0, u = (t - t0) / h;
  const m0 = ((v1 - vm) / (t1 - tm)) * h, m1 = ((vp - v0) / (tp - t0)) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}
