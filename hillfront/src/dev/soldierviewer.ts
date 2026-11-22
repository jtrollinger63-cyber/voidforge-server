// Soldier QA viewer (?viewer=soldier): deterministic poses for before/after + clipping checks.
//   ?team=0|1  ?weapon=a5|p50|m9|t12|r7|knife  ?state=idle|walk|run|crouch|fire|reload|die|jump|plant
//   ?cam=front|side|back|three|close|top  ?pitch=-0.5..0.5  ?clip=<raw clip name> (bypasses the state machine)
import * as THREE from 'three';
import { createStage } from '../engine/renderer.ts';
import { Soldier, loadSoldierAssets, type SoldierViewState } from '../character/soldier.ts';
import { teamMaterials } from '../character/materials.ts';
import type { WeaponId } from '../gameplay/weapons.ts';

export async function runSoldierViewer(params: URLSearchParams, state: Record<string, unknown>) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stage = createStage(canvas, 'high');
  stage.hills.visible = false;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0x8d8678, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; stage.scene.add(floor);
  (stage.scene.fog as THREE.Fog).near = 40; (stage.scene.fog as THREE.Fog).far = 200;

  const assets = await loadSoldierAssets();
  state.clips = assets.clipNames.length; state.clipNames = assets.clipNames.join(',');
  const team = Number(params.get('team') ?? '0');
  const weapon = (params.get('weapon') ?? 'a5') as WeaponId;
  const st = params.get('state') ?? 'idle';
  const count = Number(params.get('count') ?? '1');
  const raw = params.get('raw') === '1';

  const soldiers: Soldier[] = [];
  for (let i = 0; i < count; i++) {
    const s = new Soldier(assets);
    if (!raw) s.setTeamMaterials(teamMaterials(team as 0 | 1, s.meshes.length), team);
    s.setWeapon(weapon, team);
    s.root.position.x = (i - (count - 1) / 2) * 1.2;
    stage.scene.add(s.root);
    soldiers.push(s);
  }

  const view: SoldierViewState = {
    speed: st === 'run' ? 5.2 : st === 'walk' ? 2.7 : 0, crouching: st === 'crouch', onGround: st !== 'jump', alive: st !== 'die', weapon,
    pitch: Number(params.get('pitch') ?? '0'), firedAt: -9, reloadAt: -9, hurtAt: -9, diedAt: -9, using: st === 'plant' ? 'plant' : 'none', time: 10,
  };
  const dt = 1 / 60;
  const settle = Number(params.get('t') ?? '0.9');
  const steps = Math.round(settle / dt);
  for (let i = 0; i < steps; i++) {
    view.time += dt;
    if (st === 'fire' && i === steps - 6) view.firedAt = view.time;
    if (st === 'reload' && i === Math.max(2, steps - 70)) view.reloadAt = view.time;
    if (st === 'hit' && i === steps - 6) view.hurtAt = view.time;
    for (const s of soldiers) s.update(dt, view);
  }
  const clipOverride = params.get('clip');
  if (clipOverride && soldiers[0]) {
    const a = soldiers[0].mixer.clipAction(assets.clips.get(clipOverride)!);
    soldiers[0].mixer.stopAllAction(); a.reset().play(); soldiers[0].mixer.setTime(Number(params.get('ct') ?? '0.3'));
  }

  const cams: Record<string, [number, number, number, number, number, number]> = {
    front: [0, 1.15, 3.3, 0, 0.95, 0], side: [3.3, 1.15, 0, 0, 0.95, 0], back: [0, 1.25, -3.3, 0, 0.95, 0],
    three: [2.1, 1.35, 2.6, 0, 0.95, 0], close: [0.9, 1.35, 1.5, 0, 1.25, 0], top: [0, 4.2, 0.6, 0, 0.9, 0],
    hands: [0.55, 1.25, 1.0, 0.1, 1.15, 0.15],
  };
  const camParam = params.get('cam') ?? 'three';
  const custom = camParam.includes(',') ? camParam.split(',').map(Number) : null;
  const c = (custom && custom.length === 6 ? custom : cams[camParam] ?? cams.three!) as [number, number, number, number, number, number];
  state.soldiers = soldiers; state.assets = assets;
  stage.camera.position.set(c[0], c[1], c[2]); stage.camera.lookAt(c[3], c[4], c[5]);
  stage.camera.fov = Number(params.get('fov') ?? '38'); stage.camera.updateProjectionMatrix();
  stage.followShadow(0, 0, 0);

  const animate = params.get('anim') === '1';
  let last = performance.now(), frames = 0;
  const loop = () => {
    if (animate) { const n = performance.now(); const d = (n - last) / 1000; last = n; view.time += d; for (const s of soldiers) s.update(d, view); }
    stage.renderer.render(stage.scene, stage.camera);
    frames++; state.frames = frames; state.drawCalls = stage.renderer.info.render.calls; state.renderTris = stage.renderer.info.render.triangles;
    requestAnimationFrame(loop);
  };
  loop();
  state.ready = true;
}
