// Dev harness: renders a car model from arbitrary camera positions (used by scripts/carview.mjs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_BY_ID, deriveSpec } from '../cars.js';
import { buildCar, updateCar } from '../carmodel.js';
import { Vehicle } from '../vehicle.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });
renderer.setSize(1000, 560, false); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa7b8');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.9;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#555a62', roughness: 0.6 })); floor.receiveShadow = true; scene.add(floor);
const sun = new THREE.DirectionalLight('#fff4e0', 2.5); sun.position.set(-6, 9, 5); sun.castShadow = true; sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6; sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
const cam = new THREE.PerspectiveCamera(32, 1000 / 560, 0.1, 100);
let model = null, veh = null;
window.showCar = (id, view, opts = {}) => {
  if (model) { scene.remove(model.root); model = null; }
  const car = CAR_BY_ID[id], spec = deriveSpec(car);
  model = buildCar(spec, { paint: opts.paint || car.colors[0], finish: opts.finish || 'metallic', rim: opts.rim || car.rim, rimColor: opts.rimColor || '#e4e8ee', brake: car.brake });
  scene.add(model.root);
  veh = new Vehicle(spec, 0); veh.u = opts.speed || 0; veh.heading = 0; veh.steerWheel = opts.steer || 0; veh.delta = (opts.steer || 0) * -0.3; veh.throttle = 0; veh.brakeIn = opts.brake || 0;
  updateCar(model, veh, { time: 1, near: true, headlights: opts.lights ?? 0, cluster: true });
  const [az, el, dist, ty] = view;
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  cam.position.set(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist + ty, Math.cos(a) * Math.cos(e) * dist);
  cam.lookAt(0, ty, 0);
  renderer.render(scene, cam);
  return JSON.stringify({ tris: renderer.info.render.triangles, calls: renderer.info.render.calls });
};
