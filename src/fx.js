// Visual effects: pooled GPU particles (2 draw calls), persistent skid marks, camera speed streaks.
import * as THREE from 'three';

const VERT = `attribute float size; attribute vec4 pcolor; uniform float scale; varying vec4 vC;
void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard; float a = (1.0 - r * r); gl_FragColor = vec4(vC.rgb, vC.a * a * a); }`;

class Layer {
  constructor(scene, cap, additive) {
    this.cap = cap; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap); this.grav = new Float32Array(cap); this.drag = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); this.ca = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage); this.sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('pcolor', this.ca); g.setAttribute('size', this.sa);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { scale: { value: 800 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5; scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, a, s0, s1, life, grav = 0, drag = 0.5) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.a0[i] = a; this.s0[i] = s0; this.s1[i] = s1; this.size[i] = s0; this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) this.size[i] = 0; continue; }
      this.life[i] -= dt; if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      const t = 1 - this.life[i] / this.max[i], k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; this.col[i * 4 + 3] = this.a0[i] * (1 - t) * (t < 0.08 ? t / 0.08 : 1);
    }
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, density = 1) { this.soft = new Layer(scene, Math.round(900 * density), false); this.add = new Layer(scene, Math.round(500 * density), true); this.scene = scene; }
  setScale(h, fov) { const s = (h * 0.5) / Math.tan((fov * Math.PI) / 360); this.soft.mat.uniforms.scale.value = s; this.add.mat.uniforms.scale.value = s; }
  smoke(x, y, z, vx, vz, amt, c = [0.9, 0.9, 0.92]) { const r = () => Math.random() - 0.5; this.soft.spawn(x + r() * 0.3, y + 0.15, z + r() * 0.3, vx * 0.12 + r() * 1.4, 0.8 + Math.random() * 1.2, vz * 0.12 + r() * 1.4, c[0], c[1], c[2], 0.36 * amt, 0.5, 2.8 + amt * 1.4, 1.1 + Math.random() * 0.7, -0.2, 0.6); }
  dust(x, y, z, vx, vz, c, amt = 1) { const r = () => Math.random() - 0.5; this.soft.spawn(x + r() * 0.5, y + 0.2, z + r() * 0.5, -vx * 0.08 + r() * 2.2, 0.9 + Math.random(), -vz * 0.08 + r() * 2.2, c[0], c[1], c[2], 0.42 * amt, 0.6, 3.6, 1.3 + Math.random() * 0.8, -0.15, 0.7); }
  spark(x, y, z, vx, vy, vz) { this.add.spawn(x, y, z, vx, vy, vz, 1.0, 0.62 + Math.random() * 0.25, 0.2, 1, 0.13, 0.04, 0.35 + Math.random() * 0.35, 9.5, 0.2); }
  flame(x, y, z, vx, vy, vz, blue) { this.add.spawn(x, y, z, vx, vy, vz, blue ? 0.35 : 1, blue ? 0.7 : 0.55, blue ? 1 : 0.15, 0.9, 0.55, 0.12, 0.28, 0, 1.5); }
  debris(x, y, z, vx, vy, vz) { this.soft.spawn(x, y, z, vx, vy, vz, 0.18, 0.18, 0.2, 0.9, 0.12, 0.08, 1.2, 9.8, 0.4); }
  update(dt) { this.soft.update(dt); this.add.update(dt); }
  dispose() { for (const l of [this.soft, this.add]) { l.points.geometry.dispose(); l.mat.dispose(); this.scene.remove(l.points); } }
}

export class SkidMarks {
  constructor(scene, max = 5000) {
    this.max = max; this.head = 0; this.dirty = false; this.scene = scene;
    this.pos = new Float32Array(max * 12); const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3], k * 6);
    const g = new THREE.BufferGeometry(); this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', this.attr); g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
  }
  add(ax, ay, az, bx, by, bz, w = 0.3) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 0.03 || l > 6) return;
    const px = (-dz / l) * w * 0.5, pz = (dx / l) * w * 0.5, o = this.head * 12, p = this.pos, lift = 0.045;
    p[o] = ax + px; p[o + 1] = ay + lift; p[o + 2] = az + pz; p[o + 3] = ax - px; p[o + 4] = ay + lift; p[o + 5] = az - pz;
    p[o + 6] = bx + px; p[o + 7] = by + lift; p[o + 8] = bz + pz; p[o + 9] = bx - px; p[o + 10] = by + lift; p[o + 11] = bz - pz;
    this.head = (this.head + 1) % this.max; this.dirty = true;
  }
  flush() { if (this.dirty) { this.attr.needsUpdate = true; this.dirty = false; } }
  clear() { this.pos.fill(0); this.head = 0; this.attr.needsUpdate = true; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.scene.remove(this.mesh); }
}

/** Thin additive streaks flying past the camera at very high speed. */
export class SpeedStreaks {
  constructor(camera) {
    this.camera = camera; this.n = 70;
    this.pos = new Float32Array(this.n * 6); this.seed = [];
    for (let i = 0; i < this.n; i++) this.seed.push({ a: Math.random() * 6.28, r: 1.2 + Math.random() * 3.2, z: -2 - Math.random() * 30, s: 0.6 + Math.random() * 0.8 });
    const g = new THREE.BufferGeometry(); this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', this.attr);
    this.mat = new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat); this.lines.frustumCulled = false; this.lines.renderOrder = 20; camera.add(this.lines);
  }
  update(dt, speedN, boost) {
    const amount = Math.max(0, (speedN - 0.62) / 0.38) + boost * 0.7;
    this.mat.opacity = Math.min(0.55, amount * 0.5); this.lines.visible = amount > 0.02;
    if (!this.lines.visible) return;
    const v = (20 + speedN * 120) * dt;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i]; s.z += v * s.s; if (s.z > -1.2) { s.z = -34 - Math.random() * 10; s.a = Math.random() * 6.28; s.r = 1.4 + Math.random() * 3.4; }
      const x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r * 0.62, len = 0.8 + amount * 3.4;
      this.pos[i * 6] = x; this.pos[i * 6 + 1] = y; this.pos[i * 6 + 2] = s.z; this.pos[i * 6 + 3] = x; this.pos[i * 6 + 4] = y; this.pos[i * 6 + 5] = s.z - len;
    }
    this.attr.needsUpdate = true;
  }
  dispose() { this.camera.remove(this.lines); this.lines.geometry.dispose(); this.mat.dispose(); }
}
