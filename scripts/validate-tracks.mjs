// Checks every track (corner radius, clearance, gradient) and optionally writes SVG previews: node scripts/validate-tracks.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { TRACKS } from '../src/tracks.js';
import { buildTrackData, analyzeTrack } from '../src/trackmath.js';

const outDir = process.argv[2];
let bad = 0;
for (const def of TRACKS) {
  const td = buildTrackData(def);
  const a = analyzeTrack(td);
  const okR = a.minRadius >= 28, okS = a.minSeparation >= a.needSeparation, okG = a.maxSlope <= 0.13;
  console.log(`${def.id.padEnd(9)} ${(a.length / 1000).toFixed(2)} km  minR ${a.minRadius.toFixed(0)}m@${(a.minRadiusAt * 3)} ${okR ? 'ok' : 'TOO TIGHT'}  ` +
    `sep ${a.minSeparation.toFixed(0)}/${a.needSeparation} ${okS ? 'ok' : 'TOO CLOSE @' + a.minSepAt.map((v) => v * 3)}  grade ${(a.maxSlope * 100).toFixed(1)}% ${okG ? 'ok' : 'TOO STEEP'}  climb ${a.climb.toFixed(0)}m`);
  if (!okR || !okS || !okG) bad++;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const b = td.bounds, pad = 60, W = b.maxx - b.minx + pad * 2, H = b.maxz - b.minz + pad * 2;
    let d = '';
    for (let i = 0; i < td.N; i++) d += `${i ? 'L' : 'M'}${(td.px[i] - b.minx + pad).toFixed(1)},${(td.pz[i] - b.minz + pad).toFixed(1)}`;
    const dot = (i, c, r = 12) => `<circle cx="${(td.px[i] - b.minx + pad).toFixed(1)}" cy="${(td.pz[i] - b.minz + pad).toFixed(1)}" r="${r}" fill="${c}"/>`;
    // colour by height
    let hs = '';
    for (let i = 0; i < td.N; i += 4) { const t = (td.py[i] - b.miny) / Math.max(1, b.maxy - b.miny); hs += `<circle cx="${(td.px[i] - b.minx + pad).toFixed(1)}" cy="${(td.pz[i] - b.minz + pad).toFixed(1)}" r="${td.width / 2}" fill="hsl(${200 - t * 170},80%,${35 + t * 25}%)"/>`; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#1d2230"/>` +
      `<path d="${d}Z" fill="none" stroke="#556" stroke-width="${td.width + 2 * td.runoff}" stroke-linejoin="round"/>${hs}` +
      dot(0, '#0f0', 18) + dot(a.minRadiusAt, '#f80') + `<text x="20" y="40" fill="#fff" font-size="34" font-family="sans-serif">${def.name} - ${(a.length / 1000).toFixed(2)} km</text></svg>`;
    fs.writeFileSync(path.join(outDir, def.id + '.svg'), svg);
  }
}
process.exit(bad ? 1 : 0);
