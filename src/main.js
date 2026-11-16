// Voidforge Racing - bootstrap.
import { Game } from './game.js';
import { UI } from './ui.js';
import { Save } from './save.js';
import { TRACKS } from './tracks.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
let game;
try { game = new Game(canvas); } catch (e) {
  document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#04060c;color:#fff;font:700 20px sans-serif;text-align:center;padding:24px;z-index:99">WebGL is not available in this browser.<br>Please enable hardware acceleration or try another browser.</div>');
  throw e;
}
const ui = new UI(game);
const boot = document.createElement('div');
boot.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#04060c;color:#25e6ff;font:900 italic 28px "Trebuchet MS",sans-serif;letter-spacing:.3em;z-index:90;transition:opacity .6s';
boot.textContent = 'LOADING…'; document.body.appendChild(boot);

addEventListener('pointerdown', () => game.audio.init(), { once: true }); addEventListener('keydown', () => game.audio.init(), { once: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

async function start() {
  ui.renderTitle(); game.start();
  const first = params.get('track') && TRACKS.some((t) => t.id === params.get('track')) ? params.get('track') : 'coast';
  await game.showMenuScene(first);
  boot.style.opacity = 0; setTimeout(() => boot.remove(), 700);
  ui.show('title');
  // developer / embedding shortcuts: ?autostart=race|trial|free|drift&track=neon&car=helion&laps=2&autopilot
  const mode = params.get('autostart');
  if (mode) {
    const cfg = { mode, trackId: first, carId: Save.d.owned.includes(params.get('car')) ? params.get('car') : Save.d.selected, laps: +params.get('laps') || 3, aiCount: +params.get('ai') || 5, diff: +params.get('diff') || 1 };
    if (mode === 'trial') cfg.laps = 99; if (mode === 'free') cfg.laps = 0;
    await ui.launch(cfg); ui.screens.intro.classList.remove('on'); game.skipIntro(); if (params.has('autopilot')) game.player.auto = true;
  }
}
start();

// Test / debugging hooks (also used by scripts/smoke.mjs)
window.__vf = {
  game, ui, Save,
  /** advance the physics by `sec` seconds without rendering */
  advance(sec) { const g = game; if (g.state === 'intro') g.skipIntro(); if (g.state === 'countdown') g.cdT = 0.001; if (g.state === 'countdown') { g.state = 'racing'; g.raceTime = 0; for (const e of g.cars) { e.veh.held = false; e.lapStart = 0; } g.hudCountdownDone?.(); } const pin = g.input.update(); for (let i = 0, n = Math.round(sec * 120); i < n; i++) g.physics(1 / 120, pin); g.afterPhysics(0.016); g.updateVisuals(0.016, true); g.rig.update(0.016, g.player.veh, g.player.model, { steer: 0 }); },
  state: () => game.state,
};
