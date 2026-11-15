// Visual effects: persistent skid marks and pooled smoke/dust sprites.
import * as THREE from 'three';
import { glowTexture } from './util.js';

export class SkidMarks {
  constructor(scene, maxQuads = 3000) {
    this.max = maxQuads; this.head = 0;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    const idx = new Uint32Array(maxQuads * 6);
    for (let k = 0; k < maxQuads; k++) idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3], k * 6);
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3); this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0x0a0a0c, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.dirty = false;
  }

  add(ax, az, bx, bz, w = 0.34) {
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz);
    if (l < 0.02 || l > 4) return;
    const px = (-dz / l) * w * 0.5, pz = (dx / l) * w * 0.5;
    const o = this.head * 12, p = this.pos, y = 0.05;
    p[o] = ax + px; p[o + 1] = y; p[o + 2] = az + pz;
    p[o + 3] = ax - px; p[o + 4] = y; p[o + 5] = az - pz;
    p[o + 6] = bx + px; p[o + 7] = y; p[o + 8] = bz + pz;
    p[o + 9] = bx - px; p[o + 10] = y; p[o + 11] = bz - pz;
    this.head = (this.head + 1) % this.max;
    this.dirty = true;
  }

  flush() { if (this.dirty) { this.attr.needsUpdate = true; this.dirty = false; } }

  clear() { this.pos.fill(0); this.head = 0; this.attr.needsUpdate = true; }
}

export class Particles {
  constructor(scene, n = 120) {
    this.tex = glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      this.items.push({ s, m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, op: 1 });
    }
    this.cursor = 0;
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, opacity = 0.5, grow = 2.2) {
    const p = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
    p.s.position.set(x, y, z); p.s.visible = true;
    p.m.color.set(color); p.m.opacity = opacity;
    p.vx = vx; p.vy = vy; p.vz = vz; p.size = size; p.grow = grow; p.life = life; p.max = life; p.op = opacity;
    p.s.scale.setScalar(size);
  }

  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= 0.97; p.vz *= 0.97;
      p.s.scale.setScalar(p.size * (1 + t * p.grow));
      p.m.opacity = p.op * (1 - t) * (1 - t * 0.3);
    }
  }
}
