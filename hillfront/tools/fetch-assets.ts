/** Download the CC0 pack pieces listed in asset-config.ts into assets/cache/pieces (dev-only cache, git-ignored). */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { CDN, KIT_PIECES, WEAPON3P_PIECES } from './asset-config.ts';

const dir = 'assets/cache/pieces';
mkdirSync(dir, { recursive: true });
let ok = 0, failed: string[] = [];
for (const p of [...KIT_PIECES, ...WEAPON3P_PIECES]) {
  const file = `${dir}/${p.id}.glb`;
  if (!existsSync(file) || statSync(file).size < 100) {
    try { execFileSync('curl', ['-sS', '-L', '--fail', '-m', '60', '-o', file, CDN(p.id)], { stdio: 'pipe' }); }
    catch (e) { failed.push(`${p.name} (${p.id}): ${String(e).slice(0, 120)}`); continue; }
  }
  const magic = readFileSync(file).subarray(0, 4).toString('latin1');
  if (magic !== 'glTF') { failed.push(`${p.name} (${p.id}): not a GLB`); continue; }
  ok++;
}
console.log(`fetched/verified ${ok} GLBs; failed: ${failed.length}`);
for (const f of failed) console.log('  FAILED', f);
process.exit(failed.length ? 1 : 0);
