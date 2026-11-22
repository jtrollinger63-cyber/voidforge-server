// Entry point: routes to the game shell or to a dev/QA viewer.
export {};
declare global { interface Window { __hf: Record<string, unknown>; } }

const params = new URLSearchParams(location.search);
const state: Record<string, unknown> = { ready: false };
window.__hf = state;

async function boot() {
  const viewer = params.get('viewer');
  if (viewer === 'soldier') { (await import('./dev/soldierviewer.ts')).runSoldierViewer(params, state); return; }
  if (viewer === 'atlas') { (await import('./dev/atlasviewer.ts')).runAtlasViewer(state); return; }
  if (viewer === 'map' || !viewer) { (await import('./dev/mapviewer.ts')).runMapViewer(params, state); return; }
}

boot().catch((e) => { state.error = String(e?.stack ?? e); console.error(e); });
