// First-person viewmodel QA viewer (?viewer=viewmodel): renders exactly what the player sees, deterministically.
//   ?weapon=a5|m9|t12|r7|p50|knife  ?team=0|1  ?state=idle|fire|reload|inspect|run|equip  ?k=0..1 (reload progress)  ?t=settle seconds  ?aim=0..1 (aim down sights)
//   ?cam=x,y,z,tx,ty,tz  (viewmodel space; default = the real first-person camera)  ?fov=  ?w=&h= (aspect)
import * as THREE from 'three';
import { createStage } from '../engine/renderer.ts';
import { loadSoldierAssets } from '../character/soldier.ts';
import { Viewmodel, type VmState } from '../weapons/viewmodel.ts';
import { WEAPONS, type WeaponId } from '../gameplay/weapons.ts';

export async function runViewmodelViewer(params: URLSearchParams, state: Record<string, unknown>) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stage = createStage(canvas, 'high');
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x8d8678, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; stage.scene.add(floor);
  stage.camera.position.set(0, 1.6, 0); stage.camera.lookAt(0, 1.45, -10);
  const assets = await loadSoldierAssets();
  Viewmodel.skipFillers = params.get('fillers') === '0';
  const vm = new Viewmodel(assets.weapons);
  const weapon = (params.get('weapon') ?? 'a5') as WeaponId;
  const team = Number(params.get('team') ?? '0') as 0 | 1;
  const st = params.get('state') ?? 'idle';
  const def = WEAPONS[weapon];
  vm.setWeapon(weapon, team, 75);
  const W = innerWidth, H = innerHeight;
  vm.resize(W / H, Number(params.get('fov') ?? '75'));

  const view: VmState = { alive: true, weapon, speed: st === 'run' ? 5.2 : 0, onGround: true, crouching: false, firedAt: -9, reloadAt: -9, reloading: false, reloadT: 0, equipT: 1, time: 10, turnX: 0, turnY: 0, reduceMotion: true, dt: 1 / 60, aim: Number(params.get('aim') ?? '0') };
  const dt = 1 / 60, settle = Number(params.get('t') ?? '1.4'), steps = Math.round(settle / dt);
  const k = Number(params.get('k') ?? '0.3');
  if (st === 'inspect') vm.inspect();
  for (let i = 0; i < steps; i++) {
    view.time += dt;
    if (st === 'fire' && i === steps - 4) view.firedAt = view.time;
    if (st === 'reload') { view.reloading = true; view.reloadT = Math.max(0.01, def.reloadTime * (1 - k)); }
    if (st === 'inspect' && i === 0) vm.inspect();
    vm.update(dt, view);
  }
  if (params.get('hands') === '0') for (const h of [(vm as any).handR, (vm as any).handL]) { h.root.visible = h.forearm.visible = h.cuff.visible = false; h.setKind = () => {}; }
  const cam = params.get('cam');
  if (cam) {
    const c = cam.split(',').map(Number);
    vm.camera.position.set(c[0]!, c[1]!, c[2]!); vm.camera.lookAt(c[3]!, c[4]!, c[5]!); vm.camera.fov = Number(params.get('fov') ?? '40'); vm.camera.updateProjectionMatrix();
  }
  const r = stage.renderer;
  r.autoClear = true;
  state.vm = vm; state.ready = true;
  r.setClearColor(0x7f8c97);
  const draw = () => { r.clear(); r.render(vm.scene, vm.camera); };
  draw();
  requestAnimationFrame(function loop() { draw(); requestAnimationFrame(loop); });
}
