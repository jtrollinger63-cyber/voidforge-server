// Shows both team atlases side by side with the cell grid (?viewer=atlas) for texture QA.
import { paintAtlas } from '../character/atlas.ts';

export function runAtlasViewer(state: Record<string, unknown>) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.width = 1100; canvas.height = 560; canvas.style.width = '1100px'; canvas.style.height = '560px';
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 1100, 560);
  for (const team of [0, 1] as const) {
    const c = document.createElement('canvas'); paintAtlas(c, team);
    ctx.drawImage(c, 20 + team * 540, 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(20 + team * 540 + i * 64, 20); ctx.lineTo(20 + team * 540 + i * 64, 532); ctx.stroke(); ctx.beginPath(); ctx.moveTo(20 + team * 540, 20 + i * 64); ctx.lineTo(20 + team * 540 + 512, 20 + i * 64); ctx.stroke(); }
  }
  state.ready = true;
}
