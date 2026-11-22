#!/usr/bin/env node
/**
 * Performance probe. Reports WORK PER FRAME (draw calls, triangles) and MEMORY (GPU textures, JS heap) for each quality preset
 * at three representative positions in a full 5v5 match.
 *
 * IMPORTANT: frame TIMES measured here come from software WebGL on a CPU (no GPU in this container). They are printed only to
 * show relative cost between presets and must NOT be read as Chromebook frame rates.
 * Usage: node tools/perf.cjs [url=http://localhost:5173/]
 */
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173/';
const spots = { spawn: null, mid: [0, 6], 'site A': [-19, 5] };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-precise-memory-info'] });
  const rows = [];
  for (const q of ['low', 'medium', 'high']) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.addInitScript((quality) => { localStorage.setItem('hillfront.settings.v1', JSON.stringify({ quality, dynamicRes: false, resolutionScale: 1 })); }, q);
    const page = await ctx.newPage();
    await page.goto(base + '?practice=1&perTeam=5&difficulty=normal&side=0&seed=21&give=a5', { waitUntil: 'load' });
    await page.waitForFunction('window.__hf && window.__hf.mode === "playing"', null, { timeout: 120000 });
    await page.evaluate(() => { window.__long = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 50) window.__long++; }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ } });
    for (const [name, xz] of Object.entries(spots)) {
      if (xz) await page.evaluate(([x, z]) => { const g = window.__hf.game; const p = g.sim.players.get(g.localId); p.m.x = x; p.m.z = z; p.m.y = 0.1; p.m.vx = p.m.vz = 0; }, xz);
      await page.waitForTimeout(1800);
      const m = await page.evaluate(() => {
        const g = window.__hf.game; const r = g.stage.renderer; const info = r.info;
        const seen = new Set(); let texBytes = 0;
        const addTex = (t) => { if (!t || seen.has(t.uuid)) return; seen.add(t.uuid); const im = t.image; const w = (im && (im.width || im.videoWidth)) || 0, h = (im && (im.height || im.videoHeight)) || 0; texBytes += w * h * 4 * (t.generateMipmaps !== false && t.minFilter >= 1004 ? 1.33 : 1); };
        g.stage.scene.traverse((o) => { const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const mt of mats) for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap']) addTex(mt[k]); });
        const sm = g.stage.sun.shadow.map; const shadowBytes = sm ? sm.width * sm.height * 4 : 0;
        return { calls: info.render.calls, tris: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, texMB: +(texBytes / 1048576).toFixed(1), shadowMB: +(shadowBytes / 1048576).toFixed(1), heapMB: +((performance.memory ? performance.memory.usedJSHeapSize : 0) / 1048576).toFixed(0), shadows: g.stage.quality.shadows, scale: +(g.stage.dynamicScale * g.stage.quality.renderScale).toFixed(2) };
      });
      // frame time over ~2 s of rendering (software GL!)
      const ft = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) res({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) }); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
      rows.push({ quality: q, spot: name, ...m, softwareFps: ft.fps });
    }
    const long = await page.evaluate(() => window.__long); rows.filter((r) => r.quality === q).forEach((r) => (r.longTasks = long));
    await ctx.close();
  }
  console.log('quality | spot   | shadows | scale | calls | tris(k) | texMB | shadowMB | heapMB | longTasks | softwareFps (NOT representative)');
  for (const r of rows) console.log([r.quality.padEnd(7), r.spot.padEnd(6), r.shadows.padEnd(7), String(r.scale).padEnd(5), String(r.calls).padStart(5), (r.tris / 1000).toFixed(0).padStart(7), String(r.texMB).padStart(5), String(r.shadowMB).padStart(8), String(r.heapMB).padStart(6), String(r.longTasks).padStart(9), String(r.softwareFps).padStart(6)].join(' | '));
  require('fs').writeFileSync('release/perf.json', JSON.stringify(rows, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
