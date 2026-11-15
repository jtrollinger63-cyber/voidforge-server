// Checks every track for sane corner radii and self-clearance, and writes an SVG preview.
import fs from 'node:fs';
import path from 'node:path';
import { TRACKS } from '../src/tracks.js';
import { buildTrackData, analyzeTrack } from '../src/trackmath.js';

const outDir = process.argv[2];
let bad = 0;
for (const def of TRACKS) {
  const td = buildTrackData(def);
  const a = analyzeTrack(td);
  const okR = a.minRadius >= 38, okS = a.minSeparation >= a.needSeparation;
  console.log(`${def.id.padEnd(10)} length=${a.length.toFixed(0)}m  minRadius=${a.minRadius.toFixed(0)}m@${a.minRadiusAt} ${okR ? 'ok' : 'TOO TIGHT'}  ` +
    `minSep=${a.minSeparation.toFixed(0)}m (need ${a.needSeparation}) ${okS ? 'ok' : 'TOO CLOSE'}`);
  if (!okR || !okS) bad++;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < td.N; i++) { minx = Math.min(minx, td.px[i]); maxx = Math.max(maxx, td.px[i]); minz = Math.min(minz, td.pz[i]); maxz = Math.max(maxz, td.pz[i]); }
    const pad = 40, W = maxx - minx + pad * 2, H = maxz - minz + pad * 2;
    let d = '';
    for (let i = 0; i < td.N; i++) d += `${i ? 'L' : 'M'}${(td.px[i] - minx + pad).toFixed(1)},${(maxz - td.pz[i] + pad).toFixed(1)}`;
    const mark = (i, c) => `<circle cx="${(td.px[i] - minx + pad).toFixed(1)}" cy="${(maxz - td.pz[i] + pad).toFixed(1)}" r="10" fill="${c}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#223"/>` +
      `<path d="${d}Z" fill="none" stroke="#999" stroke-width="${td.width + 2 * td.runoff}" stroke-linejoin="round"/>` +
      `<path d="${d}Z" fill="none" stroke="#444" stroke-width="${td.width}" stroke-linejoin="round"/>` +
      mark(0, '#0f0') + mark(a.minRadiusAt, '#f80') + `</svg>`;
    fs.writeFileSync(path.join(outDir, def.id + '.svg'), svg);
  }
}
process.exit(bad ? 1 : 0);
