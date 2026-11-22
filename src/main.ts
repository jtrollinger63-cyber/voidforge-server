// Entry point: routes to the game shell or to a dev/QA viewer.
import './ui/style.css';

declare global { interface Window { __hf: Record<string, unknown>; } }

const params = new URLSearchParams(location.search);
const state: Record<string, unknown> = { ready: false };
window.__hf = state;

async function boot() {
  const viewer = params.get('viewer');
  if (viewer === 'soldier') { (await import('./dev/soldierviewer.ts')).runSoldierViewer(params, state); return; }
  if (viewer === 'atlas') { (await import('./dev/atlasviewer.ts')).runAtlasViewer(state); return; }
  if (viewer === 'map') { (await import('./dev/mapviewer.ts')).runMapViewer(params, state); return; }

  const { Game } = await import('./game/game.ts');
  const { createLoading, createMenu } = await import('./ui/menu.ts');
  const { sfx } = await import('./audio/sfx.ts');
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = createLoading();
  const game = await Game.boot(canvas, (p, m) => loading.set(p, m));
  const menu = createMenu(game);
  void menu;
  loading.done();
  window.__hf.game = game;
  state.ready = true;
  state.mode = 'menu';
  // the first user gesture unlocks audio and starts the menu music
  const unlock = () => { sfx.unlock(); if (game.state === 'menu') sfx.startMusic(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);

  // auto-start hooks for automated QA:  ?practice=1&perTeam=3&difficulty=easy&mode=objective&side=0
  if (params.get('practice') === '1') {
    game.startPractice({
      mode: (params.get('mode') as 'objective' | 'elimination') ?? 'objective',
      difficulty: (params.get('difficulty') as 'easy' | 'normal' | 'hard') ?? 'normal',
      side: params.get('side') === '1' ? 1 : params.get('side') === '0' ? 0 : 'random',
      perTeam: Number(params.get('perTeam') ?? '5'),
      seed: params.get('seed') ? Number(params.get('seed')) : undefined,
    });
    state.mode = 'playing';
    const give = params.get('give');
    if (give && game.sim) {
      const p = game.sim.players.get(game.localId)!;
      const { WEAPONS } = await import('./gameplay/weapons.ts');
      const w = WEAPONS[give as keyof typeof WEAPONS];
      if (w) { const slot = w.slot === 'primary' ? 0 : w.slot === 'secondary' ? 1 : 2; p.slots[slot] = w.id; p.ammo[w.id] = { mag: w.mag, reserve: w.reserve }; p.cur = slot; p.equipT = 0; }
    }
  }
}

boot().catch((e) => { state.error = String(e?.stack ?? e); console.error(e); });
