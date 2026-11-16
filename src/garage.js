// 3D showroom: turntable, studio lighting, reflections from emissive light panels, car swap animation.
import * as THREE from 'three';
import { CAR_BY_ID, deriveSpec } from './cars.js';
import { buildCar, updateCar } from './carmodel.js';
import { Vehicle } from './vehicle.js';
import { Save } from './save.js';
import { makeCanvas, canvasTexture } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Garage {
  constructor(renderer) {
    this.renderer = renderer; this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.scene.background = new THREE.Color('#06080f'); this.scene.fog = new THREE.Fog('#06080f', 18, 46);
    this.model = null; this.veh = null; this.out = null; this.angle = 0.6; this.vel = 0; this.drag = false; this.auto = true; this.time = 0;
    this.focus = 'car'; this.cam = { az: 0.6, el: 0.14, dist: 8.4, ty: 0.7, tx: 0 }; this.camT = { ...this.cam }; this.swapT = 1; this.build();
  }

  build() {
    const S = this.scene;
    // studio shell: curved backdrop + floor
    const floorC = makeCanvas(512, 512), fg = floorC.getContext('2d'); const gr = fg.createRadialGradient(256, 256, 20, 256, 256, 256); gr.addColorStop(0, '#2a3040'); gr.addColorStop(0.55, '#10131c'); gr.addColorStop(1, '#07090e'); fg.fillStyle = gr; fg.fillRect(0, 0, 512, 512);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: canvasTexture(floorC), roughness: 0.22, metalness: 0.5, envMapIntensity: 0.7 }));
    floor.receiveShadow = true; S.add(floor);
    const wallC = makeCanvas(16, 256), wg = wallC.getContext('2d'); const wgr = wg.createLinearGradient(0, 0, 0, 256); wgr.addColorStop(0, '#05060b'); wgr.addColorStop(0.5, '#10162a'); wgr.addColorStop(1, '#1a2240'); wg.fillStyle = wgr; wg.fillRect(0, 0, 16, 256);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 28, 48, 1, true), new THREE.MeshBasicMaterial({ map: canvasTexture(wallC), side: THREE.BackSide, fog: false })); wall.position.y = 10; S.add(wall);
    // turntable
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.22, metalness: 0.9 })); tt.position.y = 0.0; tt.receiveShadow = true; S.add(tt); this.table = tt;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.045, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x25e6ff, toneMapped: false })); ring.position.y = 0.1; S.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.02, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3d71, toneMapped: false })); ring2.position.y = 0.02; S.add(ring2);
    // light panels (give shaped reflections on the paint)
    const panel = (w, h, x, y, z, ry, rx, c = 6) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(c), side: THREE.DoubleSide, toneMapped: false })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); S.add(m); return m; };
    this.panels = [panel(14, 1.2, 0, 8.5, -2, 0, Math.PI / 2, 2.4), panel(2, 9, -9, 4, 3, Math.PI / 2.4, 0, 1.8), panel(2, 9, 9, 4, 3, -Math.PI / 2.4, 0, 1.8), panel(10, 0.7, 0, 5, 9, Math.PI, 0.2, 1.5)];
    const strip = (x, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 12, 0.12), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); m.position.set(x, 6, z); S.add(m); };
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; strip(Math.cos(a) * 26, Math.sin(a) * 26, i % 2 ? 0x25e6ff : 0xff3d71); }
    // environment for reflections: render the shell once
    const pm = new THREE.PMREMGenerator(this.renderer); S.environment = pm.fromScene(S, 0.02, 0.1, 100).texture; S.environmentIntensity = 0.8; pm.dispose();
    // lights
    S.add(new THREE.HemisphereLight(0x9ab0e0, 0x10121c, 0.85));
    const key = new THREE.SpotLight(0xfff2e0, 520, 40, 0.62, 0.7, 2); key.position.set(-6, 9, 6); key.target.position.set(0, 0.6, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.04; S.add(key, key.target);
    const rim = new THREE.SpotLight(0x6fd8ff, 330, 40, 0.7, 0.8, 2); rim.position.set(7, 5, -6); rim.target.position.set(0, 0.6, 0); S.add(rim, rim.target);
    const fill = new THREE.SpotLight(0xff5fb0, 150, 40, 0.8, 0.9, 2); fill.position.set(0, 4, 9); fill.target.position.set(0, 0.5, 0); S.add(fill, fill.target); this.lights = { key, rim, fill };
    this.dust = null;
  }

  /** show a car (animated swap if one is already on the table) */
  show(carId, immediate = false) {
    this.carId = carId;
    if (this.model) { if (immediate) { this.scene.remove(this.model.root); this.model.dispose(); } else { if (this.out) { this.scene.remove(this.out.root); this.out.dispose(); } this.out = this.model; this.outT = 0; } }
    const car = CAR_BY_ID[carId], setup = Save.setup(carId), spec = deriveSpec(car, setup.upgrades);
    this.spec = spec; this.veh = new Vehicle(spec, 0); this.veh.u = 0;
    this.model = buildCar(spec, { paint: setup.paint, finish: setup.finish, rim: setup.rim, rimColor: setup.rimColor, brake: car.brake }, { detail: true });
    this.model.setShadows(true); this.scene.add(this.model.root);
    this.swapT = immediate ? 1 : 0; this.model.root.position.set(immediate ? 0 : 9, 0.1, 0);
    this.veh.heading = 0; this.veh.throttle = 0; this.veh.rpm = spec.idle; this.model.root.visible = true;
    this.focusOn('car');
  }
  refresh() { this.show(this.carId, true); }
  setPaint(hex, finish) { if (this.model) this.model.setPaint(hex, finish); }
  setRim(style, color) { if (this.model) this.model.setRim(style, color); }
  focusOn(kind) { this.focus = kind; const c = this.camT; if (kind === 'wheels') { c.dist = 4.2; c.ty = 0.42; c.el = 0.07; c.az = 1.15; this.auto = false; } else if (kind === 'interior') { c.dist = 5.5; c.ty = 0.9; c.el = 0.35; c.az = 0.4; this.auto = false; } else { c.dist = 8.4; c.ty = 0.7; c.el = 0.14; this.auto = true; } }
  pointer(dx, dy) { this.camT.az -= dx * 0.008; this.camT.el = clamp(this.camT.el + dy * 0.004, 0.02, 0.8); this.auto = false; this.idleT = 0; }
  zoom(d) { this.camT.dist = clamp(this.camT.dist + d * 0.01, 3.6, 12); }

  resize(w, h) { this.camera.aspect = w / h; if (w > 820) this.camera.setViewOffset(w, h, w * 0.1, 0, w, h); else this.camera.clearViewOffset(); this.camera.updateProjectionMatrix(); }

  update(dt) {
    this.time += dt; if (!this.model) return;
    this.idleT = (this.idleT || 0) + dt; if (this.idleT > 3.5 && this.focus === 'car') this.auto = true;
    if (this.auto) this.camT.az += dt * 0.22;
    const k = 1 - Math.exp(-6 * dt); for (const key of ['az', 'el', 'dist', 'ty']) this.cam[key] += (this.camT[key] - this.cam[key]) * k;
    const c = this.cam, cx = Math.sin(c.az) * Math.cos(c.el) * c.dist, cz = Math.cos(c.az) * Math.cos(c.el) * c.dist;
    this.camera.position.set(cx, Math.sin(c.el) * c.dist + c.ty, cz); this.camera.lookAt(0, c.ty * 0.9, 0);
    // swap animation: new car glides in from the right, old one slides out to the left
    if (this.swapT < 1) { this.swapT = Math.min(1, this.swapT + dt * 1.5); const e = 1 - Math.pow(1 - this.swapT, 3); this.model.root.position.x = 9 * (1 - e); this.model.root.rotation.y = (1 - e) * -0.9; }
    if (this.out) { this.outT += dt * 1.6; const e = Math.min(1, this.outT); this.out.root.position.x = -12 * e * e; this.out.root.rotation.y = e * 0.9; if (this.outT >= 1) { this.scene.remove(this.out.root); this.out.dispose(); this.out = null; } }
    const root = this.model.root; this.veh.x = root.position.x; this.veh.z = 0; this.veh.y = 0.1; this.veh.rpm = this.spec.idle + Math.sin(this.time * 6) * 25 + this.revT * 3000 || this.spec.idle; this.veh.heading = this.swapT < 1 ? root.rotation.y : 0;
    this.veh.steerWheel = Math.sin(this.time * 0.7) * 0.15; this.veh.delta = this.veh.steerWheel * -0.25;
    updateCar(this.model, this.veh, { time: this.time, near: true, headlights: 0.9, baseY: 0.1, cluster: false });
    root.rotation.y = this.swapT < 1 ? root.rotation.y : 0; root.position.y = 0.1;
    this.table.rotation.y += dt * 0.2;
    this.revT = Math.max(0, (this.revT || 0) - dt * 2);
  }
  rev() { this.revT = 1; }
  render(post, renderer, dt) { post.setScene(this.scene); post.setCamera(this.camera); const g = post.grade; post.grade = { sat: 1.1, contrast: 1.06, tint: [1, 1, 1], bloom: 0.16 }; post.bloom && (post.bloom.strength = 0.16); renderer.toneMappingExposure = 0.95; post.render(dt, this.time); post.grade = g; }
  dispose() { this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}
