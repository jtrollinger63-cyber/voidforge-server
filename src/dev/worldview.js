// Dev harness: builds a full world + one car, renders from the chase camera at a point along the lap.
import * as THREE from 'three';
import { TRACKS } from '../tracks.js';
import { CAR_BY_ID, deriveSpec } from '../cars.js';
import { buildCar, updateCar } from '../carmodel.js';
import { Vehicle } from '../vehicle.js';
import { buildWorld } from '../world.js';
import { CameraRig } from '../camera.js';
import { Post, PRESETS } from '../post.js';
import { gridSlot } from '../trackmesh.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1280 / 720, 0.3, 6000);
let W = null, veh = null, model = null, rig = null, post = null, time = 0;
window.load = (trackId, carId, q = 'high') => {
  if (W) W.dispose();
  const def = TRACKS.find((t) => t.id === trackId), preset = PRESETS[q];
  const t0 = performance.now();
  W = buildWorld(renderer, def, preset);
  const car = CAR_BY_ID[carId], spec = deriveSpec(car);
  veh = new Vehicle(spec, 0);
  model = buildCar(spec, { paint: car.colors[0], finish: 'metallic', rim: car.rim, rimColor: '#e4e8ee', brake: car.brake });
  W.scene.add(model.root);
  rig = new CameraRig(camera, { td: W.td, terrain: W.terrain });
  post = new Post(renderer, W.scene, camera); post.setGrade(W.env.grade); post.build(preset, { bloom: true, motionBlur: true });
  return JSON.stringify({ ms: Math.round(performance.now() - t0), buildMs: Math.round(W.buildMs), N: W.td.N, calls: renderer.info.render.calls });
};
window.place = (frac, speed = 40, lat = 0, mode = 0, t = 3) => {
  const td = W.td, i = Math.round(frac * td.N) % td.N;
  veh.place(td, i, lat); veh.u = speed; veh.setWorldVelocity(Math.sin(veh.heading) * speed, Math.cos(veh.heading) * speed);
  veh.speed = speed; veh.throttle = 1; veh.rpm = 6500; veh.gear = 4;
  const world = { td, terrain: W.terrain, env: W.env };
  for (let k = 0; k < 40; k++) veh.step(1 / 120, { throttle: 0.5, brake: 0, steer: 0, handbrake: false, boost: false }, world);
  rig.setMode(mode); rig.snap(veh, model);
  time = t;
  frame(0.016);
  return JSON.stringify({ y: veh.y.toFixed(1), lat: veh.lat.toFixed(1), surf: veh.surface.kind });
};
function frame(dt) {
  const td = W.td, tf = td.tunnelF[veh.hint] || 0;
  updateCar(model, veh, { time, near: true, headlights: Math.max(W.env.night ? 1 : 0, tf), cluster: true });
  rig.update(dt, veh, model, { steer: 0 });
  W.update(1, time, camera, { x: veh.x, y: veh.y, z: veh.z }, tf);
  post.speed = Math.min(1, veh.speed / 80); post.render(dt, time);
  renderer.info.reset();
}
window.stats = () => JSON.stringify({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geo: renderer.info.memory.geometries, tex: renderer.info.memory.textures });
window.shot = () => { frame(0.016); };
