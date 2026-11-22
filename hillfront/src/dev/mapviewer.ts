// Map QA viewer (?viewer=map): fly-through vistas, collider overlay (?debug=1).
import * as THREE from 'three';
import { createStage } from '../engine/renderer.ts';
import { buildHillfront } from '../map/hillfront.ts';
import { buildMapView } from '../map/mapview.ts';
import type { QualityName } from '../engine/quality.ts';

export async function runMapViewer(params: URLSearchParams, state: Record<string, unknown>) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stage = createStage(canvas, (params.get('q') as QualityName) ?? 'medium');
  const map = buildHillfront();
  const view = await buildMapView(map);
  stage.scene.add(view.group);
  if (params.get('debug') === '1') stage.scene.add(view.debugColliders(map));
  state.stats = view.stats;
  state.colliders = map.world.boxes.length;

  const vista = Number(params.get('vista') ?? '-1');
  const cam = (params.get('cam') ?? '').split(',').map(Number);
  if (cam.length === 6) { stage.camera.position.set(cam[0]!, cam[1]!, cam[2]!); stage.camera.lookAt(cam[3]!, cam[4]!, cam[5]!); stage.followShadow(cam[3]!, 0, cam[5]!); }
  else {
    const v = map.vistas[vista >= 0 ? vista : 0]!;
    stage.camera.position.set(...v.pos); stage.camera.lookAt(...v.look); stage.followShadow(v.look[0], 0, v.look[2]);
  }
  stage.camera.fov = Number(params.get('fov') ?? '70'); stage.camera.updateProjectionMatrix();

  let frames = 0;
  const loop = () => {
    stage.renderer.render(stage.scene, stage.camera);
    frames++; state.frames = frames; state.drawCalls = stage.renderer.info.render.calls; state.renderTris = stage.renderer.info.render.triangles;
    requestAnimationFrame(loop);
  };
  loop();
  state.ready = true;
  void THREE;
}
